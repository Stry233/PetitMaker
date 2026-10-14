/** PetitGlyph payload framing: canonical map data, annotations, format identities, provenance, and
 *  a SHA-256 integrity check around the range-coded map residual. */
import { attributedNotes } from '../../../state/notes-attribution';
import type { CanonicalSave } from '../../save/canonical';
import { canonicalize, canonicalBytes, templateHash, catalogHash, objKey } from '../../save/canonical';
import { getMapTemplate } from '../../../config/maps';
import { resolveTemplate, UnknownTemplateError } from '../../../config/maps/resolve';
import { isCustomTemplate } from '../../../core/model/planet';
import { ByteWriter, ByteReader } from './bytes';
import { encodeTemplateRecord, decodeTemplateRecord } from './template-record';
import { sha256 } from '../../../core/base/sha256';
import { ShareTooLargeError } from '../errors';
import { ImportError } from '../../save/import-error';
import type { MapProvenanceSummary } from '../../../core/provenance/types';
import type { AnnotationsState } from '../../../core/model/annotations';
import { tokensOf, tokensToCells, tokenOf, parseToken } from './grid-io';
import { encodeMap, decodeMap, MODEL_VARIANTS, hasHalfPosition, modelCanRepresent, type MapModelOpts } from './map-coder';
import { RangeEncoder, RangeDecoder } from './bitio';
import type { GridState, MapNotes, MapTemplate } from '../../../core/model/types';
import type { RecordedRecipe } from '../../../tools/generation/recipe';
import { clampNotes } from '../../../core/model/notes';
import { decodeAnnotations } from '../../save/annotations-codec';
import { isGenerationConfig } from '../../save/generation-record';
import { CompressionMethod, deflate, inflate } from '../raster/zlib';

export interface ShareCodeMeta {
  appVersion: string;
  saveVersion: number;
  createdAt?: string;
}

export interface ProvenanceInfo {
  aiUsed: boolean;
  proceduralUsed: boolean;
  appVersion: string;
  saveVersion: number;
  createdAt?: string;
  title?: string;
}

const MAGIC0 = 0x50; // 'P'
const MAGIC1 = 0x32; // '2'
/** Supported frame range. Frame 3 has no annotations; frame 4 adds a length-prefixed annotation
 * record between the generation note and map residual; frame 5 adds the title and description
 * after the annotations; frame 6 adds the custom planet after the notes, whose record it always
 * writes. A map without notes is still written as frame 4 and a built-in map never as frame 6,
 * so older readers keep reading them. */
const EARLIEST_FRAME_VERSION = 3;
const ANNOTATIONS_FRAME_VERSION = 4;
const NOTES_FRAME_VERSION = 5;
const TEMPLATE_FRAME_VERSION = 6;
const FRAME_VERSION = 6;

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

// ── Provenance record (binary) ──────────────────────────────────────────────────────────────

const FLAG_AI = 1, FLAG_PROCEDURAL = 2, FLAG_CREATED_AT = 4;
// The title bit remains reserved for reading older provenance records.
const FLAG_TITLE = 8;

function encodeProvenanceRecord(summary: MapProvenanceSummary | null, meta: ShareCodeMeta): Uint8Array {
  const aiUsed = summary?.containsAi ?? false;
  const proceduralUsed = summary?.containsProcedural ?? false;
  const hasCreatedAt = meta.createdAt !== undefined;

  let flags = 0;
  if (aiUsed) flags |= FLAG_AI;
  if (proceduralUsed) flags |= FLAG_PROCEDURAL;
  if (hasCreatedAt) flags |= FLAG_CREATED_AT;

  const w = new ByteWriter();
  w.u8(flags);
  w.u8(meta.saveVersion);
  w.str8(meta.appVersion);
  if (hasCreatedAt) w.u32(Math.floor(new Date(meta.createdAt!).getTime() / 1000));
  return w.toBytes();
}

function decodeProvenanceRecord(bytes: Uint8Array): ProvenanceInfo {
  const r = new ByteReader(bytes);
  const flags = r.u8();
  const saveVersion = r.u8();
  const appVersion = r.str8();
  const info: ProvenanceInfo = {
    aiUsed: (flags & FLAG_AI) !== 0,
    proceduralUsed: (flags & FLAG_PROCEDURAL) !== 0,
    appVersion,
    saveVersion,
  };
  if (flags & FLAG_CREATED_AT) info.createdAt = new Date(r.u32() * 1000).toISOString();
  if (flags & FLAG_TITLE) info.title = r.str8();
  return info;
}

// ── frame assembly ──────────────────────────────────────────────────────────────────────────

/** Maximum generation-note size within the approximately 21 KB densest glyph tier. */
const NOTE_MAX_BYTES = 2048;

/** Encode generation metadata when it is compact and JSON-safe. Stencil source arrays are omitted. */
function noteBytes(generation: RecordedRecipe | undefined): Uint8Array {
  if (!generation || (generation as { stencilPlan?: unknown }).stencilPlan) return new Uint8Array(0);
  const bytes = new TextEncoder().encode(JSON.stringify(generation));
  return bytes.length <= NOTE_MAX_BYTES ? bytes : new Uint8Array(0);
}

const ANNOTATION_MAX_BYTES = 4 * 1024 * 1024;
const ANNOTATION_MAX_INFLATE_RATIO = 256;

interface AnnotationRecord {
  plain: Uint8Array;
  compressed: Uint8Array;
}

/** Serialize the validated annotation layer independently from the canonical map. */
async function annotationRecord(raw: unknown): Promise<AnnotationRecord> {
  const annotations = decodeAnnotations(raw);
  if (!annotations) return { plain: new Uint8Array(0), compressed: new Uint8Array(0) };
  const plain = new TextEncoder().encode(JSON.stringify(annotations));
  if (plain.length > ANNOTATION_MAX_BYTES) {
    throw new ShareTooLargeError('Annotation data exceeds the PetitGlyph safety limit.');
  }
  const compressed = await deflate(plain, CompressionMethod.Deflate);
  if (compressed.length > 0xffff) {
    throw new ShareTooLargeError('Annotation data exceeds the PetitGlyph frame limit.');
  }
  return { plain, compressed };
}

/** The notes record: title then description, each u16-length-prefixed UTF-8; empty when there are none. */
function notesBytes(notes: MapNotes | undefined): Uint8Array {
  if (!notes) return new Uint8Array(0);
  const w = new ByteWriter();
  w.str16(notes.title ?? '');
  w.str16(notes.description ?? '');
  return w.toBytes();
}

function readNotes(bytes: Uint8Array): MapNotes | undefined {
  const r = new ByteReader(bytes);
  return clampNotes({ title: r.str16(), description: r.str16() });
}

/** Unambiguous hash input: length-prefixed map bytes, then annotations, then (frame 5) the notes,
 *  then (frame 6) the planet record. A planet record always follows a notes length, even zero. */
function contentBytes(
  canonical: CanonicalSave, annotations: Uint8Array, notes: Uint8Array = new Uint8Array(0), template: Uint8Array = new Uint8Array(0),
): Uint8Array {
  const parts = [canonicalBytes(canonical), annotations];
  if (notes.length || template.length) parts.push(notes);
  if (template.length) parts.push(template);
  const out = new Uint8Array(parts.reduce((n, b) => n + 4 + b.length, 0));
  const view = new DataView(out.buffer);
  let at = 0;
  for (const b of parts) {
    view.setUint32(at, b.length, true);
    out.set(b, at + 4);
    at += 4 + b.length;
  }
  return out;
}

/** Everything a payload frame carries besides the model variant that encodes its cells. */
interface FrameParts {
  canonical: CanonicalSave;
  template: MapTemplate;
  templateRecord: Uint8Array;
  contentHash: Uint8Array;
  generation: RecordedRecipe | undefined;
  annotations: Uint8Array;
  notes: Uint8Array;
  summary: MapProvenanceSummary | null;
  meta: ShareCodeMeta;
}

function buildFrame(parts: FrameParts, variant: number): Uint8Array {
  const { canonical, template, templateRecord, contentHash, generation, annotations, notes, summary, meta } = parts;
  const enc = new RangeEncoder();
  encodeMap(enc, template, tokensOf(canonical.cells).map(parseToken), canonical.objects, MODEL_VARIANTS[variant]!);
  const residual = enc.finish();
  const prov = encodeProvenanceRecord(summary, meta);
  // Generation metadata is optional and is not required to reconstruct the encoded map.
  const note = noteBytes(generation);

  const w = new ByteWriter();
  w.u8(MAGIC0);
  w.u8(MAGIC1);
  w.u8(templateRecord.length ? TEMPLATE_FRAME_VERSION : notes.length ? NOTES_FRAME_VERSION : ANNOTATIONS_FRAME_VERSION);
  w.u8(variant);
  w.u8(canonical.version);
  w.str8(canonical.templateId);
  w.u32(templateHash(template));
  w.u32(catalogHash());
  w.blob8(prov);
  w.raw(contentHash);
  w.blob16(note);
  w.blob16(annotations);
  if (notes.length || templateRecord.length) w.blob16(notes);
  if (templateRecord.length) w.blob16(templateRecord);
  w.raw(residual);
  return w.toBytes();
}

/** Build and verify a payload frame before returning it. */
export async function encodeMapPayload(state: GridState, summary: MapProvenanceSummary | null, meta: ShareCodeMeta): Promise<Uint8Array> {
  const canonical = canonicalize(state);
  const custom = isCustomTemplate(state.template);
  const template = custom ? state.template : getMapTemplate(canonical.templateId);
  const templateRecord = custom ? encodeTemplateRecord(template) : new Uint8Array(0);
  const cells = tokensOf(canonical.cells).map(parseToken);
  const annotations = await annotationRecord(state.annotations);
  const notes = notesBytes(clampNotes(attributedNotes(state)));
  const want = await sha256(contentBytes(canonical, annotations.plain, notes, templateRecord));
  // Try applicable models and retain the smallest frame; half-cell anchors require half support.
  const half = hasHalfPosition(canonical.objects);
  let frame: Uint8Array | null = null;
  const parts: FrameParts = {
    canonical, template, templateRecord, contentHash: want,
    generation: isGenerationConfig(state.generation) ? state.generation : undefined,
    annotations: annotations.compressed, notes, summary, meta,
  };
  for (let v = 0; v < MODEL_VARIANTS.length; v++) {
    if (MODEL_VARIANTS[v]!.half !== half) continue;
    if (!modelCanRepresent(template, cells, canonical.objects, MODEL_VARIANTS[v]!)) continue;
    const f = buildFrame(parts, v);
    if (!frame || f.length < frame.length) frame = f;
  }
  await decodeMapPayload(frame!);
  return frame!;
}

export interface DecodedMapPayload {
  canonical: CanonicalSave;
  provenance: ProvenanceInfo;
  generation?: RecordedRecipe;
  annotations?: AnnotationsState;
  notes?: MapNotes;
  /** The custom planet a frame-6 payload carries, validated and matching `canonical.templateId`. */
  template?: MapTemplate;
  templateHash: number;
  catalogHash: number;
}

export async function decodeMapPayload(bytes: Uint8Array): Promise<DecodedMapPayload> {
  const r = new ByteReader(bytes);
  const m0 = r.u8(), m1 = r.u8();
  if (m0 !== MAGIC0 || m1 !== MAGIC1) throw new ImportError('corrupt', 'Not a PetitGlyph payload (bad magic).');

  const version = r.u8();
  if (version > FRAME_VERSION) throw new ImportError('future-version', `Payload version ${version} is newer than this build supports.`);
  if (version < EARLIEST_FRAME_VERSION) throw new ImportError('decode-failed', `Unsupported payload version ${version}.`);

  const variant = r.u8();
  const model: MapModelOpts | undefined = MODEL_VARIANTS[variant];
  // The variant table is append-only, so an unknown index requires a newer reader.
  if (!model) throw new ImportError('future-version', `Model variant ${variant} is newer than this build supports.`);

  const canonicalVersion = r.u8();
  const templateId = r.str8();
  const tHash = r.u32();
  const cHash = r.u32();
  const provBytes = r.blob8();
  const provenance = decodeProvenanceRecord(provBytes);
  const contentHash = r.raw(32);
  const note = r.blob16();
  const annotationBlob = version >= ANNOTATIONS_FRAME_VERSION ? r.blob16() : new Uint8Array(0);
  const notesBlob = version >= NOTES_FRAME_VERSION ? r.blob16() : new Uint8Array(0);
  const templateBlob = version >= TEMPLATE_FRAME_VERSION ? r.blob16() : new Uint8Array(0);
  const residual = r.rest();

  if (version >= TEMPLATE_FRAME_VERSION && templateBlob.length === 0) throw new ImportError('corrupt', 'Planet frame without a planet record.');
  const embedded = templateBlob.length > 0 ? decodeTemplateRecord(templateBlob) : undefined;
  if (embedded && embedded.id !== templateId) throw new ImportError('corrupt', 'Planet record does not match the map.');
  let template: MapTemplate;
  try {
    template = resolveTemplate(templateId, embedded);
  } catch (e) {
    if (e instanceof UnknownTemplateError) throw new ImportError('incompatible-template', e.message);
    throw e;
  }

  let generation: RecordedRecipe | undefined;
  if (note.length > 0) {
    try {
      generation = JSON.parse(new TextDecoder().decode(note)) as RecordedRecipe;
    } catch {
      throw new ImportError('decode-failed', 'Malformed generation note.');
    }
  }

  const annotationBytes = annotationBlob.length > 0
    ? await inflate(annotationBlob, CompressionMethod.Deflate, {
        maxBytes: ANNOTATION_MAX_BYTES,
        maxRatio: ANNOTATION_MAX_INFLATE_RATIO,
      })
    : new Uint8Array(0);

  let decoded: ReturnType<typeof decodeMap>;
  try {
    decoded = decodeMap(new RangeDecoder(residual), template, model);
  } catch (e) {
    // The map stream is read before the content hash can vouch for it; a stream it refuses is damage.
    throw new ImportError('corrupt', `Malformed map stream: ${e instanceof Error ? e.message : String(e)}`);
  }
  const { cells, objects } = decoded;
  const canonical: CanonicalSave = {
    version: canonicalVersion,
    templateId,
    cells: tokensToCells(cells.map(tokenOf)),
    // Canonical order is by objKey, not the raster order the object plane decodes in.
    objects: [...objects]
      .sort((a, b) => { const ka = objKey(a), kb = objKey(b); return ka < kb ? -1 : ka > kb ? 1 : 0; })
      .map((o, i) => ({ ...o, id: `o${i}` })),
  };

  const gotHash = await sha256(version >= ANNOTATIONS_FRAME_VERSION
    ? contentBytes(canonical, annotationBytes, notesBlob, templateBlob)
    : canonicalBytes(canonical));
  if (!bytesEqual(gotHash, contentHash)) throw new ImportError('corrupt', 'Content hash mismatch.');

  const result: DecodedMapPayload = { canonical, provenance, templateHash: tHash, catalogHash: cHash };
  if (generation !== undefined) result.generation = generation;
  if (embedded) result.template = embedded;
  if (notesBlob.length > 0) {
    const notes = readNotes(notesBlob);
    if (notes) result.notes = notes;
  }
  if (annotationBytes.length > 0) {
    let raw: unknown;
    try {
      raw = JSON.parse(new TextDecoder().decode(annotationBytes));
    } catch {
      throw new ImportError('decode-failed', 'Malformed annotation record.');
    }
    const annotations = decodeAnnotations(raw);
    if (!annotations) throw new ImportError('decode-failed', 'Malformed annotation record.');
    result.annotations = annotations;
  }
  return result;
}
