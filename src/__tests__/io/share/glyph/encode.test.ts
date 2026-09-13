import { describe, it, expect } from 'vitest';
import { encodeGlyph, encodeGlyphV2 } from '../../../../io/share/glyph/encode';
import { currentBandSize, CURRENT_TOP_ROWS, nBlocks, RS_N } from '../../../../io/share/glyph/geometry';
import { PRODUCT_INK, PRODUCT_PAPER } from '../../../../io/share/glyph/palette';

const payload = (n: number) => Uint8Array.from({ length: n }, (_, i) => (i * 37 + 11) & 0xff);
describe('glyph encoder', () => {
  it('emits the fixed footprint across transport densities', () => {
    for (const [n, div] of [[300, 1], [1100, 2], [2000, 3], [6880, 4]] as const) {
      const g = encodeGlyph(payload(n), 12)!;
      expect(g.profile.div).toBe(div);
      expect({ width: g.width, height: g.height }).toEqual(currentBandSize(12));
    }
  });
  it('uses four luminance tones at every density', () => {
    for (const n of [91, 4200, 6800, 12000]) expect(encodeGlyph(payload(n), 12)!.profile.colors).toBe(4);
  });
  it('keeps a small payload compact within the full visual ribbon', () => {
    const current = encodeGlyph(payload(91), 12)!;
    const legacy = encodeGlyphV2(payload(91), 12)!;
    const currentShare = current.plan.symbolCount / current.plan.moduleCount;
    const legacySymbols = Math.ceil((nBlocks(legacy.tier) * RS_N * 8) / legacy.tier.bits);
    const legacyShare = legacySymbols / (legacy.tier.dataCols * legacy.tier.dataRows);
    expect(legacyShare).toBeGreaterThan(0.8);
    expect(currentShare).toBeLessThan(0.45);
    expect(currentShare).toBeLessThan(legacyShare * 0.55);
  });
  it.each([82, 300, 1100, 6880, 12000])('fills the entire data area for a %i-byte payload while retaining the calibration gap', n => {
    const g = encodeGlyph(payload(n), 12)!;
    const size = 12 / g.profile.div;
    const colorAt = (x: number, y: number) => Array.from(g.rgba.subarray((y * g.width + x) * 4, (y * g.width + x) * 4 + 3));
    const tones = new Set(g.profile.palette.map(color => color.join(',')));
    for (let row = 0; row < g.plan.dataRows; row++) {
      for (let col = 0; col < g.profile.dataCols; col++) {
        const x = Math.floor((col + 0.5) * size);
        const y = Math.floor(CURRENT_TOP_ROWS * 12 + (row + 0.5) * size);
        expect(tones.has(colorAt(x, y).join(','))).toBe(true);
      }
    }
    expect(colorAt(80 * 12, 12)).toEqual([...PRODUCT_PAPER]);
    for (let x = 6; x < g.width; x += 12) expect(colorAt(x, CURRENT_TOP_ROWS * 12 - 6)).toEqual([...PRODUCT_PAPER]);
  });
  it('returns null past the current profile capacity', () => {
    expect(encodeGlyph(payload(12_000), 12)).not.toBeNull();
    expect(encodeGlyph(payload(12_001), 12)).toBeNull();
  });
  it('draws product finders and calibrated swatches', () => {
    const g = encodeGlyph(payload(200), 12)!;
    const px = (x: number, y: number) => [g.rgba[(y * g.width + x) * 4], g.rgba[(y * g.width + x) * 4 + 1], g.rgba[(y * g.width + x) * 4 + 2]];
    expect(px(18, 18)).toEqual([...PRODUCT_INK]);
    expect(px(g.width - 18, 18)).toEqual([...PRODUCT_INK]);
    expect(px(5 * 12, 12)).toEqual([...g.profile.palette[0]!]);
    expect(px(1380, 13)).toEqual([...PRODUCT_PAPER]);
  });
});
