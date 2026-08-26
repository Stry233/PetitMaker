// src/io/share/codec/payload.ts — PetitGlyph payload frame: assembles/parses the byte frame the
// visible glyph code carries. It holds the map coded by codec/map-coder.ts wrapped in a small
// header — template and catalog identity, a binary provenance record, and a SHA-256 content-hash
// gate, so a corrupted or foreign payload is rejected before it reaches the reconstruction path.
import type { CanonicalSave } from '../canonical';
import { canonicalize, canonicalBytes, templateHash, catalogHash, objKey } from '../canonical';
import { getMapTemplate } from '../../../config/maps';
import { sha256 } from '../crypto/sha256';
import { ShareError } from '../errors';
import type { MapProvenanceSummary } from '../../../core/provenance/types';
import { tokensOf, tokensToCells, tokenOf, parseToken } from './grid-io';
import { encodeMap, decodeMap, MODEL_VARIANTS, hasHalfPosition, type MapModelOpts } from './map-coder';
import { RangeEncoder, RangeDecoder } from './bitio';
import type { GenerateConfig, GridState } from '../../../core/model/types';

export interface ShareCodeMeta {
  title?: string;
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
/** The payload wire format. A reader rejects any frame that does not carry this exact version, so
 *  bumping it whenever the object or terrain encoding changes turns a stale code into a named
 *  refusal instead of a content-hash mismatch further down. */
const FRAME_VERSION = 3;
const TITLE_MAX_CHARS = 48;

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

const FLAG_AI = 1, FLAG_PROCEDURAL = 2, FLAG_CREATED_AT = 4, FLAG_TITLE = 8;

function encodeProvenanceRecord(summary: MapProvenanceSummary | null, meta: ShareCodeMeta): Uint8Array {
  const aiUsed = summary?.containsAi ?? false;
  const proceduralUsed = summary?.containsProcedural ?? false;
  const hasCreatedAt = meta.createdAt !== undefined;
  const title = meta.title !== undefined ? meta.title.slice(0, TITLE_MAX_CHARS) : undefined;
  const hasTitle = !!title;

  let flags = 0;
  if (aiUsed) flags |= FLAG_AI;
  if (proceduralUsed) flags |= FLAG_PROCEDURAL;
  if (hasCreatedAt) flags |= FLAG_CREATED_AT;
  if (hasTitle) flags |= FLAG_TITLE;

  const w = new ByteWriter();
  w.u8(flags);
  w.u8(meta.saveVersion);
  w.str8(meta.appVersion);
  if (hasCreatedAt) w.u32(Math.floor(new Date(meta.createdAt!).getTime() / 1000));
  if (hasTitle) w.str8(title!);
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

/** The most a generation note may occupy in the frame. The whole payload must fit the glyph's
 *  densest tier (T5, ~21 KB, map included), so a note is a passenger, never the cargo: one the
 *  size of a painted-region cell list can starve the map it rides with, and past this it is
 *  dropped whole rather than truncated (a cut JSON recipe parses as damage). */
const NOTE_MAX_BYTES = 2048;

/** The generation recipe as note bytes, or nothing where no faithful note can ride. A stencil
 *  recipe never rides: its `stencilPlan` is the source picture in typed arrays, which JSON
 *  mangles into per-element objects (tens of kilobytes that also read back wrong), and the map
 *  itself already carries the picture. */
function noteBytes(generation: GenerateConfig | undefined): Uint8Array {
  if (!generation || generation.stencilPlan) return new Uint8Array(0);
  const bytes = new TextEncoder().encode(JSON.stringify(generation));
  return bytes.length <= NOTE_MAX_BYTES ? bytes : new Uint8Array(0);
}

function buildFrame(
  canonical: CanonicalSave, contentHash: Uint8Array, generation: GenerateConfig | undefined,
  summary: MapProvenanceSummary | null, meta: ShareCodeMeta, variant: number,
): Uint8Array {
  const template = getMapTemplate(canonical.templateId);
  const enc = new RangeEncoder();
  encodeMap(enc, template, tokensOf(canonical.cells).map(parseToken), canonical.objects, MODEL_VARIANTS[variant]!);
  const residual = enc.finish();
  const prov = encodeProvenanceRecord(summary, meta);
  // The recipe rides along as a NOTE: the editor shows it and can regenerate from it. Nothing in
  // the map's reconstruction reads it, so a code stays readable however the generator changes.
  const note = noteBytes(generation);

  const w = new ByteWriter();
  w.u8(MAGIC0);
  w.u8(MAGIC1);
  w.u8(FRAME_VERSION);
  w.u8(variant);
  w.u8(canonical.version);
  w.str8(canonical.templateId);
  w.u32(templateHash(template));
  w.u32(catalogHash());
  w.blob8(prov);
  w.raw(contentHash);
  w.blob16(note);
  w.raw(residual);
  return w.toBytes();
}

/**
 * Build the payload frame. A map has ONE encoding, so this is not a search: the frame is built,
 * then decoded back and hash-checked before it is handed out, which turns a coder bug into a
 * refusal here rather than a wrong map in someone else's editor.
 */
export async function encodeMapPayload(state: GridState, summary: MapProvenanceSummary | null, meta: ShareCodeMeta): Promise<Uint8Array> {
  const canonical = canonicalize(state);
  const want = await sha256(canonicalBytes(canonical));
  // The model has a few shapes (see MapModelOpts) and which one suits a map is a property of the
  // map, not of the format. Coding is cheap, so every APPLICABLE shape is tried and the smallest
  // kept; the frame names the winner, so the reader does no searching. Applicable is not a size
  // question: only a half-capable shape can carry a half-cell anchor, and only it costs anything
  // to say a map has none — so a map without one searches exactly the shapes it always did.
  const half = hasHalfPosition(canonical.objects);
  let frame: Uint8Array | null = null;
  for (let v = 0; v < MODEL_VARIANTS.length; v++) {
    if (MODEL_VARIANTS[v]!.half !== half) continue;
    const f = buildFrame(canonical, want, state.generation, summary, meta, v);
    if (!frame || f.length < frame.length) frame = f;
  }
  await decodeMapPayload(frame!);
  return frame!;
}

export interface DecodedMapPayload {
  canonical: CanonicalSave;
  provenance: ProvenanceInfo;
  generation?: GenerateConfig;
  templateHash: number;
  catalogHash: number;
}

export async function decodeMapPayload(bytes: Uint8Array): Promise<DecodedMapPayload> {
  try {
    const r = new ByteReader(bytes);
    const m0 = r.u8(), m1 = r.u8();
    if (m0 !== MAGIC0 || m1 !== MAGIC1) throw new ShareError('corrupt', 'Not a PetitGlyph v2 payload (bad magic).');

    const version = r.u8();
    if (version > FRAME_VERSION) throw new ShareError('future-version', `Payload version ${version} is newer than this build supports.`);
    if (version !== FRAME_VERSION) throw new ShareError('decode-failed', `Unsupported payload version ${version}.`);

    const variant = r.u8();
    const model: MapModelOpts | undefined = MODEL_VARIANTS[variant];
    // A shape this build does not have is a code from a NEWER build, not a damaged one: the
    // table is append-only, so an index past its end can only have been written later. Saying
    // "corrupt" would send the reader looking for a better photograph of a perfectly good code.
    if (!model) throw new ShareError('future-version', `Model variant ${variant} is newer than this build supports.`);

    const canonicalVersion = r.u8();
    const templateId = r.str8();
    const tHash = r.u32();
    const cHash = r.u32();
    const provBytes = r.blob8();
    const provenance = decodeProvenanceRecord(provBytes);
    const contentHash = r.raw(32);
    const note = r.blob16();
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

    const gotHash = await sha256(canonicalBytes(canonical));
    if (!bytesEqual(gotHash, contentHash)) throw new ShareError('corrupt', 'Content hash mismatch.');

    const result: DecodedMapPayload = { canonical, provenance, templateHash: tHash, catalogHash: cHash };
    if (generation !== undefined) result.generation = generation;
    return result;
  } catch (e) {
    if (e instanceof ShareError) throw e;
    throw new ShareError('decode-failed', e instanceof Error ? e.message : String(e));
  }
}
