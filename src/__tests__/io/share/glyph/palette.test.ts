import { describe, it, expect } from 'vitest';
import { PALETTE16, PALETTE8_INDICES, HEADER_LEVELS, rgbToYcc, classify } from '../../../../io/share/glyph/palette';

describe('luma-first palette', () => {
  it('has 4 distinct luma bands ≥ 40 Y apart, 4 colors each', () => {
    const ys = PALETTE16.map((c) => rgbToYcc(c[0], c[1], c[2])[0]).sort((a, b) => a - b);
    const bands = [ys.slice(0, 4), ys.slice(4, 8), ys.slice(8, 12), ys.slice(12)];
    for (const band of bands) expect(Math.max(...band) - Math.min(...band)).toBeLessThan(14);
    for (let i = 0; i < 3; i++) expect(bands[i + 1]![0]! - bands[i]![3]!).toBeGreaterThan(28);
  });
  it('classify is exact on clean palette colors with high confidence', () => {
    for (let i = 0; i < 16; i++) {
      const r = classify(PALETTE16[i]!, PALETTE16 as never);
      expect(r.idx).toBe(i);
      expect(r.confidence).toBeGreaterThan(0.5);
    }
  });
  it('8-subset uses all 4 luma bands', () => {
    expect(new Set(PALETTE8_INDICES.map((i) => i >> 2)).size).toBe(4); // index layout: luma*4+chroma
  });
  it('header levels are 4 monotone grays', () => {
    const ys = HEADER_LEVELS.map((c) => rgbToYcc(c[0], c[1], c[2])[0]);
    for (let i = 1; i < 4; i++) expect(ys[i]! - ys[i - 1]!).toBeGreaterThan(50);
  });

  // Re-derivation guard: PALETTE16 is baked as literal RGB triplets (see palette.ts) so the
  // 16-entry table reads as plain data at the call sites. This test independently re-runs the
  // SAME BT.601-inverse formula (Y ∈ {56,112,168,214}; per-chroma-column (Cb,Cr) offsets) and
  // checks the literals match exactly, so the table can't silently drift from its derivation.
  //
  // The two extreme luma rows (56, 214) clamp at least one channel with the full-magnitude
  // offsets from the brief ({(-48,+38),(+42,+44),(+46,-40),(-44,-46)}), which would distort
  // their actual luma. Per the brief's guidance ("adjust the offsets or Y levels slightly"),
  // those two rows use the same four offsets scaled by 0.5 (rounded to the nearest integer)
  // instead — small enough that no channel clamps, so the inverse math for those rows is exact
  // too. The middle rows (112, 168) use the offsets unscaled.
  it('PALETTE16 literals match their BT.601-inverse derivation exactly', () => {
    const Y_LEVELS = [56, 112, 168, 214];
    const BASE_CHROMA_OFFSETS: [number, number][] = [
      [-48, 38],
      [42, 44],
      [46, -40],
      [-44, -46],
    ];
    const scale = (s: number): [number, number][] =>
      BASE_CHROMA_OFFSETS.map(([cb, cr]) => [Math.round(cb * s), Math.round(cr * s)] as [number, number]);
    const OFFSETS_BY_ROW: Record<number, [number, number][]> = {
      56: scale(0.5),
      112: BASE_CHROMA_OFFSETS,
      168: BASE_CHROMA_OFFSETS,
      214: scale(0.5),
    };
    const clamp255 = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
    const derived: [number, number, number][] = [];
    for (const y of Y_LEVELS) {
      for (const [cb, cr] of OFFSETS_BY_ROW[y]!) {
        const r = clamp255(y + 1.402 * cr);
        const g = clamp255(y - 0.344136 * cb - 0.714136 * cr);
        const b = clamp255(y + 1.772 * cb);
        derived.push([r, g, b]);
      }
    }
    expect(derived).toEqual(PALETTE16.map((c) => [c[0], c[1], c[2]]));
  });
});
