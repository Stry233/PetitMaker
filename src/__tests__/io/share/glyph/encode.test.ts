import { describe, it, expect } from 'vitest';
import { encodeGlyph, encodeGlyphV2 } from '../../../../io/share/glyph/encode';
import { currentBandSize, nBlocks, RS_N } from '../../../../io/share/glyph/geometry';
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
  it('removes the legacy padding field from a small payload', () => {
    const current = encodeGlyph(payload(91), 12)!;
    const legacy = encodeGlyphV2(payload(91), 12)!;
    const currentShare = current.plan.symbolCount / current.plan.moduleCount;
    const legacySymbols = Math.ceil((nBlocks(legacy.tier) * RS_N * 8) / legacy.tier.bits);
    const legacyShare = legacySymbols / (legacy.tier.dataCols * legacy.tier.dataRows);
    expect(legacyShare).toBeGreaterThan(0.8);
    expect(currentShare).toBeLessThan(0.45);
    expect(currentShare).toBeLessThan(legacyShare * 0.55);
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
