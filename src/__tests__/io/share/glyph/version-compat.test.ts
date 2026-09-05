// V1/v2 bands calibrate from their own swatches rather than a baked RGB table.
import { describe, it, expect } from 'vitest';
import { encodeGlyph, encodeGlyphV2, buildHeaderBytes } from '../../../../io/share/glyph/encode';
import { decodeGlyph } from '../../../../io/share/glyph/decode';
import {
  BASE_CHROMA_OFFSETS, HEADER_LEVELS, PALETTE16, PALETTE16_V1, PALETTE16_V2, Y_LEVELS, type RGB,
} from '../../../../io/share/glyph/palette';
import {
  HEADER_NSYM, HEADER_SYMBOL_BITS, HEADER_VERSION, headerModuleAt, type Tier,
} from '../../../../io/share/glyph/geometry';
import { rsEncode } from '../../../../io/share/glyph/rs';
import { bytesToSymbols } from '../../../../io/share/glyph/bitpack';

const payload = (n: number, seed = 5) => {
  const a = new Uint8Array(n);
  let s = seed >>> 0;
  for (let i = 0; i < n; i++) { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; a[i] = s >>> 24; }
  return a;
};
const eq = (a: Uint8Array | null, b: Uint8Array) => !!a && a.length === b.length && a.every((v, i) => v === b[i]);

const key = (c: RGB | Uint8Array | number[]) => (c[0]! << 16) | (c[1]! << 8) | c[2]!;

/** Derive a structurally valid palette outside the fixed decoder tables. */
function deriveTable(scales: readonly number[], columns: readonly number[]): readonly RGB[] {
  const clamp255 = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  const out: RGB[] = [];
  Y_LEVELS.forEach((y, band) => {
    for (const col of columns) {
      const [cb0, cr0] = BASE_CHROMA_OFFSETS[col]!;
      const cb = cb0 * scales[band]!, cr = cr0 * scales[band]!;
      out.push([
        clamp255(y + 1.402 * cr),
        clamp255(y - 0.344136 * cb - 0.714136 * cr),
        clamp255(y + 1.772 * cb),
      ]);
    }
  });
  return out;
}

const UNSEEN = deriveTable([0.6, 0.9, 0.9, 0.5], [1, 2, 3, 0]);

interface Band { rgba: Uint8Array; width: number; height: number; tier: Tier }

/** Recolor a legacy band by palette index and replace its header version. */
function redrawAs(g: Band, mb: number, data: Uint8Array, version: number, to: readonly RGB[]): Band {
  const rgba = new Uint8Array(g.rgba);

  const remap = new Map<number, RGB>();
  PALETTE16.forEach((c, i) => remap.set(key(c), to[i]!));
  for (let p = 0; p < rgba.length; p += 4) {
    const hit = remap.get((rgba[p]! << 16) | (rgba[p + 1]! << 8) | rgba[p + 2]!);
    if (hit) { rgba[p] = hit[0]; rgba[p + 1] = hit[1]; rgba[p + 2] = hit[2]; }
  }

  const headerBytes = buildHeaderBytes(version, g.tier.id, data);
  const symbols = bytesToSymbols(rsEncode(headerBytes, HEADER_NSYM), HEADER_SYMBOL_BITS);
  for (let k = 0; k < symbols.length; k++) {
    const { col, row } = headerModuleAt(k);
    const c = HEADER_LEVELS[symbols[k]!]!;
    for (let y = row * mb; y < (row + 1) * mb; y++) for (let x = col * mb; x < (col + 1) * mb; x++) {
      const i = (y * g.width + x) * 4;
      rgba[i] = c[0]; rgba[i + 1] = c[1]; rgba[i + 2] = c[2]; rgba[i + 3] = 255;
    }
  }
  return { ...g, rgba };
}

describe('glyph palette versioning', () => {
  const mb = 12;

  it('new codes use v3 and round-trip through its profile decoder', () => {
    expect(HEADER_VERSION).toBe(3);
    const data = payload(1100);
    const glyph = encodeGlyph(data, mb)!;
    expect(eq(decodeGlyph(glyph.rgba, glyph.width, glyph.height), data)).toBe(true);
  });

  it('keeps the probe palette outside both fixed decoder tables', () => {
    expect(UNSEEN).not.toEqual(PALETTE16_V1);
    expect(UNSEEN).not.toEqual(PALETTE16_V2);
    expect(new Set(UNSEEN.map(key)).size).toBe(16);
  });

  for (const [n, tid] of [[300, 0], [1100, 1], [4200, 3]] as const) {
    it(`a band at tier T${tid} (${n} B) decodes from its own swatches, not from a table`, () => {
      const data = payload(n);
      const current = encodeGlyphV2(data, mb)!;
      const foreign = redrawAs(current, mb, data, 1, UNSEEN);
      expect(foreign.rgba).not.toEqual(current.rgba);
      expect(eq(decodeGlyph(foreign.rgba, foreign.width, foreign.height), data)).toBe(true);
      expect(eq(decodeGlyph(current.rgba, current.width, current.height), data)).toBe(true);
    });
  }

  it('refuses a version whose palette this build does not have', () => {
    const data = payload(1100);
    const g = encodeGlyphV2(data, mb)!;
    for (const version of [0, 4, 255]) {
      const other = redrawAs(g, mb, data, version, PALETTE16_V2);
      expect(decodeGlyph(other.rgba, other.width, other.height)).toBeNull();
    }
  });
});
