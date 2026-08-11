// What actually keeps released share codes readable, and it is not that the old tables are kept.
// The decoder reads the grayscale header first, then learns one centroid per palette entry off the
// code's OWN calibration swatches — so it classifies against the colors the band in front of it
// carries, never against the colors this build thinks that version used. All a released table
// contributes to a decode is its entry count and the refusal of a version nobody has.
//
// So the test that has teeth is this one: a band drawn in a palette this build has never seen
// still decodes byte-identically. It fails the moment a decoder starts reading a table's colors,
// which is the change that would make released codes depend on those numbers being right.
// Synthesising a "v1" band from PALETTE16_V1 and decoding it proves nothing beyond this, since the
// decoder cannot tell the two apart; the genuine v1 evidence is the committed share-map.png
// fixture decoded end to end by readme-share-artifact.test.ts.
import { describe, it, expect } from 'vitest';
import { encodeGlyph, buildHeaderBytes } from '../../../../io/share/glyph/encode';
import { decodeGlyph } from '../../../../io/share/glyph/decode';
import {
  BASE_CHROMA_OFFSETS, HEADER_LEVELS, PALETTE16, PALETTE16_V1, PALETTE16_V2, Y_LEVELS, type RGB,
} from '../../../../io/share/glyph/palette';
import {
  HEADER_NSYM, HEADER_OFFSET, HEADER_SYMBOL_BITS, HEADER_VERSION, headerModuleAt, type Tier,
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

/** The module's own BT.601-inverse derivation at an arbitrary per-band chroma scale row and an
 *  arbitrary chroma-column order, so a well-formed table that is nobody's release can be built
 *  without baking sixteen more literals. */
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

/** Scales between v1's [0.5, 1, 1, 0.5] and v2's [0.51, 0.7, 0.7, 0.509], each inside its band's
 *  clipping ceiling, and the chroma columns rotated one place so an index means a different hue
 *  than it does in either release. The rotation is what gives the test teeth: a decoder that
 *  classified against the resolved table would land on the wrong index for every module and fail
 *  the payload CRC, while one that calibrates off the swatches is unaffected. Columns {0,2} stay
 *  the pair {1,3}, both near-opposite in the chroma plane, so the 8-color tier keeps its margin. */
const UNSEEN = deriveTable([0.6, 0.9, 0.9, 0.5], [1, 2, 3, 0]);

interface Band { rgba: Uint8Array; width: number; height: number; tier: Tier }

/** Re-render a freshly encoded band as some other build would have drawn it: every data/calibration
 *  module recolored from `to`'s table at the same palette INDEX, and the header repainted to carry
 *  `version`. Everything else — geometry, RS, interleave, whitening — is version-independent. */
function redrawAs(g: Band, mb: number, data: Uint8Array, version: number, to: readonly RGB[]): Band {
  const rgba = new Uint8Array(g.rgba);

  const remap = new Map<number, RGB>();
  PALETTE16.forEach((c, i) => remap.set(key(c), to[i]!));
  for (let p = 0; p < rgba.length; p += 4) {
    const hit = remap.get((rgba[p]! << 16) | (rgba[p + 1]! << 8) | rgba[p + 2]!);
    if (hit) { rgba[p] = hit[0]; rgba[p + 1] = hit[1]; rgba[p + 2] = hit[2]; }
  }

  const headerBytes = buildHeaderBytes(g.tier, data);
  headerBytes[HEADER_OFFSET.version] = version;
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

  it('new codes carry the current version and its palette', () => {
    expect(HEADER_VERSION).toBe(2);
    expect(PALETTE16).toBe(PALETTE16_V2);
  });

  it('the probe palette is one no release drew with', () => {
    expect(UNSEEN).not.toEqual(PALETTE16_V1);
    expect(UNSEEN).not.toEqual(PALETTE16_V2);
    expect(new Set(UNSEEN.map(key)).size).toBe(16);
  });

  // T0 is the 8-color tier (PALETTE8_INDICES), T1..T5 the 16-color ones — both index paths.
  for (const [n, tid] of [[300, 0], [1100, 1], [4200, 3]] as const) {
    it(`a band at tier T${tid} (${n} B) decodes from its own swatches, not from a table`, () => {
      const data = payload(n);
      const current = encodeGlyph(data, mb)!;
      const foreign = redrawAs(current, mb, data, 1, UNSEEN);

      // A different picture entirely: the header says version 1, and every colored module carries a
      // value neither released table holds. Nothing this build knows describes it.
      expect(foreign.rgba).not.toEqual(current.rgba);
      expect(eq(decodeGlyph(foreign.rgba, foreign.width, foreign.height), data)).toBe(true);
      expect(eq(decodeGlyph(current.rgba, current.width, current.height), data)).toBe(true);
    });
  }

  it('refuses a version whose palette this build does not have', () => {
    const data = payload(1100);
    const g = encodeGlyph(data, mb)!;
    for (const version of [0, 3, 255]) {
      const other = redrawAs(g, mb, data, version, PALETTE16_V2);
      expect(decodeGlyph(other.rgba, other.width, other.height)).toBeNull();
    }
  });
});
