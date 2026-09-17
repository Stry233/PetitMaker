import { attributedNotes } from '../../../core/provenance/image-attribution';
// PetitGlyph payload framing: canonical map data, annotations, format identities, provenance, and
// a SHA-256 integrity check around the range-coded map residual.
import type { CanonicalSave } from '../canonical';
import { canonicalize, canonicalBytes, templateHash, catalogHash, objKey } from '../canonical';
import { getMapTemplate } from '../../../config/maps';
import { sha256 } from '../crypto/sha256';
import { ShareError } from '../errors';
import type { MapProvenanceSummary } from '../../../core/provenance/types';
import type { AnnotationsState } from '../../../core/model/annotations';
import { tokensOf, tokensToCells, tokenOf, parseToken } from './grid-io';
import { encodeMap, decodeMap, MODEL_VARIANTS, hasHalfPosition, modelCanRepresent, type MapModelOpts } from './map-coder';
import { RangeEncoder, RangeDecoder } from './bitio';
import type { GenerateConfig, GridState, MapNotes } from '../../../core/model/types';
import { clampNotes } from '../../../core/model/notes';
import { decodeAnnotations } from '../../json-codec';
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
 * after the annotations. A map without notes is still written as frame 4, so older readers keep
 * reading it. */
const EARLIEST_FRAME_VERSION = 3;
const NOTES_FRAME_VERSION = 5;
const FRAME_VERSION = 5;

// ── Minimal little-endian byte writer/reader (frame assembly only — no dependency elsewhere). ──

class ByteWriter {
  private out: number[] = [];
  u8(v: number): void { this.out.push(v & 0xff); }
  u16(v: number): void { this.out.push(v & 0xff, (v >>> 8) & 0xff); }
  u32(v: number): void {
    this.out.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff);
  }
  raw(bytes: Uint8Array): void { for (let i = 0; i < bytes.length; i++) this.out.push(bytes[i]! & 0xff); }
  /** u8 length prefix + utf8 bytes. Throws if the encoded string exceeds 255 bytes. */
  str8(s: string): void {
    const b = new TextEncoder().encode(s);
    if (b.length > 0xff) throw new Error('payload: string exceeds u8 length prefix');
    this.u8(b.length);
    this.raw(b);
  }
  /** u16 length prefix + utf8 bytes. */
  str16(s: string): void { this.blob16(new TextEncoder().encode(s)); }
  /** u8 length prefix + raw bytes. */
  blob8(b: Uint8Array): void {
    if (b.length > 0xff) throw new Error('payload: blob exceeds u8 length prefix');
    this.u8(b.length);
    this.raw(b);
  }
  /** u16 length prefix + raw bytes. */
  blob16(b: Uint8Array): void {
    if (b.length > 0xffff) throw new Error('payload: blob exceeds u16 length prefix');
    this.u16(b.length);
    this.raw(b);
  }
  toBytes(): Uint8Array { return Uint8Array.from(this.out); }
}

class ByteReader {
  private pos = 0;
  constructor(private buf: Uint8Array) {}
  private need(n: number): void {
    if (this.pos + n > this.buf.length) throw new ShareError('decode-failed', 'Payload ends unexpectedly.');
  }
  u8(): number { this.need(1); return this.buf[this.pos++]!; }
  u16(): number {
    this.need(2);
    const v = this.buf[this.pos]! | (this.buf[this.pos + 1]! << 8);
    this.pos += 2;
    return v >>> 0;
  }
  u32(): number {
    this.need(4);
    const v = (this.buf[this.pos]! | (this.buf[this.pos + 1]! << 8) | (this.buf[this.pos + 2]! << 16) | (this.buf[this.pos + 3]! << 24)) >>> 0;
    this.pos += 4;
    return v;
  }
  raw(n: number): Uint8Array { this.need(n); const out = this.buf.slice(this.pos, this.pos + n); this.pos += n; return out; }
  str8(): string { const len = this.u8(); return new TextDecoder().decode(this.raw(len)); }
  str16(): string { return new TextDecoder().decode(this.blob16()); }
  blob8(): Uint8Array { const len = this.u8(); return this.raw(len); }
  blob16(): Uint8Array { const len = this.u16(); return this.raw(len); }
  rest(): Uint8Array { const out = this.buf.slice(this.pos); this.pos = this.buf.length; return out; }
}

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
function noteBytes(generation: GenerateConfig | undefined): Uint8Array {
  if (!generation || generation.stencilPlan) return new Uint8Array(0);
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
    throw new ShareError('decode-failed', 'Annotation data exceeds the PetitGlyph safety limit.');
  }
  const compressed = await deflate(plain, CompressionMethod.Deflate);
  if (compressed.length > 0xffff) {
    throw new ShareError('decode-failed', 'Annotation data exceeds the PetitGlyph frame limit.');
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

/** Unambiguous hash input: length-prefixed map bytes, then annotations, then (frame 5) the notes. */
function contentBytes(canonical: CanonicalSave, annotations: Uint8Array, notes: Uint8Array = new Uint8Array(0)): Uint8Array {
  const map = canonicalBytes(canonical);
  const out = new Uint8Array(8 + map.length + annotations.length + (notes.length ? 4 + notes.length : 0));
  const view = new DataView(out.buffer);
  view.setUint32(0, map.length, true);
  out.set(map, 4);
  view.setUint32(4 + map.length, annotations.length, true);
  out.set(annotations, 8 + map.length);
  if (notes.length) {
    view.setUint32(8 + map.length + annotations.length, notes.length, true);
    out.set(notes, 12 + map.length + annotations.length);
  }
  return out;
}

function buildFrame(
  canonical: CanonicalSave, contentHash: Uint8Array, generation: GenerateConfig | undefined,
  annotations: Uint8Array, notes: Uint8Array, summary: MapProvenanceSummary | null, meta: ShareCodeMeta, variant: number,
): Uint8Array {
  const template = getMapTemplate(canonical.templateId);
  const enc = new RangeEncoder();
  encodeMap(enc, template, tokensOf(canonical.cells).map(parseToken), canonical.objects, MODEL_VARIANTS[variant]!);
  const residual = enc.finish();
  const prov = encodeProvenanceRecord(summary, meta);
  // Generation metadata is optional and is not required to reconstruct the encoded map.
  const note = noteBytes(generation);

  const w = new ByteWriter();
  w.u8(MAGIC0);
  w.u8(MAGIC1);
  w.u8(notes.length ? NOTES_FRAME_VERSION : NOTES_FRAME_VERSION - 1);
  w.u8(variant);
  w.u8(canonical.version);
  w.str8(canonical.templateId);
  w.u32(templateHash(template));
  w.u32(catalogHash());
  w.blob8(prov);
  w.raw(contentHash);
  w.blob16(note);
  w.blob16(annotations);
  if (notes.length) w.blob16(notes);
  w.raw(residual);
  return w.toBytes();
}

/** Build and verify a payload frame before returning it. */
export async function encodeMapPayload(state: GridState, summary: MapProvenanceSummary | null, meta: ShareCodeMeta): Promise<Uint8Array> {
  const canonical = canonicalize(state);
  const template = getMapTemplate(canonical.templateId);
  const cells = tokensOf(canonical.cells).map(parseToken);
  const annotations = await annotationRecord(state.annotations);
  const notes = notesBytes(clampNotes(attributedNotes(state)));
  const want = await sha256(contentBytes(canonical, annotations.plain, notes));
  // Try applicable models and retain the smallest frame; half-cell anchors require half support.
  const half = hasHalfPosition(canonical.objects);
  let frame: Uint8Array | null = null;
  for (let v = 0; v < MODEL_VARIANTS.length; v++) {
    if (MODEL_VARIANTS[v]!.half !== half) continue;
    if (!modelCanRepresent(template, cells, canonical.objects, MODEL_VARIANTS[v]!)) continue;
    const f = buildFrame(canonical, want, state.generation, annotations.compressed, notes, summary, meta, v);
    if (!frame || f.length < frame.length) frame = f;
  }
  await decodeMapPayload(frame!);
  return frame!;
}

export interface DecodedMapPayload {
  canonical: CanonicalSave;
  provenance: ProvenanceInfo;
  generation?: GenerateConfig;
  annotations?: AnnotationsState;
  notes?: MapNotes;
  templateHash: number;
  catalogHash: number;
}

export async function decodeMapPayload(bytes: Uint8Array): Promise<DecodedMapPayload> {
  try {
    const r = new ByteReader(bytes);
    const m0 = r.u8(), m1 = r.u8();
    if (m0 !== MAGIC0 || m1 !== MAGIC1) throw new ShareError('corrupt', 'Not a PetitGlyph payload (bad magic).');

    const version = r.u8();
    if (version > FRAME_VERSION) throw new ShareError('future-version', `Payload version ${version} is newer than this build supports.`);
    if (version < EARLIEST_FRAME_VERSION) throw new ShareError('decode-failed', `Unsupported payload version ${version}.`);

    const variant = r.u8();
    const model: MapModelOpts | undefined = MODEL_VARIANTS[variant];
    // The variant table is append-only, so an unknown index requires a newer reader.
    if (!model) throw new ShareError('future-version', `Model variant ${variant} is newer than this build supports.`);

    const canonicalVersion = r.u8();
    const templateId = r.str8();
    const tHash = r.u32();
    const cHash = r.u32();
    const provBytes = r.blob8();
    const provenance = decodeProvenanceRecord(provBytes);
    const contentHash = r.raw(32);
    const note = r.blob16();
    const annotationBlob = version >= 4 ? r.blob16() : new Uint8Array(0);
    const notesBlob = version >= NOTES_FRAME_VERSION ? r.blob16() : new Uint8Array(0);
    const residual = r.rest();

    const template = getMapTemplate(templateId);

    let generation: GenerateConfig | undefined;
    if (note.length > 0) {
      try {
        generation = JSON.parse(new TextDecoder().decode(note)) as GenerateConfig;
      } catch {
        throw new ShareError('decode-failed', 'Malformed generation note.');
      }
    }

    const annotationBytes = annotationBlob.length > 0
      ? await inflate(annotationBlob, CompressionMethod.Deflate, {
          maxBytes: ANNOTATION_MAX_BYTES,
          maxRatio: ANNOTATION_MAX_INFLATE_RATIO,
        })
      : new Uint8Array(0);

    const { cells, objects } = decodeMap(new RangeDecoder(residual), template, model);
    const canonical: CanonicalSave = {
      version: canonicalVersion,
      templateId,
      cells: tokensToCells(cells.map(tokenOf)),
      // Canonical order is by objKey, not the raster order the object plane decodes in.
      objects: [...objects]
        .sort((a, b) => { const ka = objKey(a), kb = objKey(b); return ka < kb ? -1 : ka > kb ? 1 : 0; })
        .map((o, i) => ({ ...o, id: `o${i}` })),
    };

    const gotHash = await sha256(version >= 4
      ? contentBytes(canonical, annotationBytes, notesBlob)
      : canonicalBytes(canonical));
    if (!bytesEqual(gotHash, contentHash)) throw new ShareError('corrupt', 'Content hash mismatch.');

    const result: DecodedMapPayload = { canonical, provenance, templateHash: tHash, catalogHash: cHash };
    if (generation !== undefined) result.generation = generation;
    if (notesBlob.length > 0) {
      const notes = readNotes(notesBlob);
      if (notes) result.notes = notes;
    }
    if (annotationBytes.length > 0) {
      let raw: unknown;
      try {
        raw = JSON.parse(new TextDecoder().decode(annotationBytes));
      } catch {
        throw new ShareError('decode-failed', 'Malformed annotation record.');
      }
      const annotations = decodeAnnotations(raw);
      if (!annotations) throw new ShareError('decode-failed', 'Malformed annotation record.');
      result.annotations = annotations;
    }
    return result;
  } catch (e) {
    if (e instanceof ShareError) throw e;
    throw new ShareError('decode-failed', e instanceof Error ? e.message : String(e));
  }
}
