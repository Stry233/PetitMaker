import { describe, it, expect } from 'vitest';
import { encodeGlyph } from '../../../../io/share/glyph/encode';
import { bandSize, TIERS } from '../../../../io/share/glyph/geometry';
import { PALETTE16 } from '../../../../io/share/glyph/palette';

const payload = (n: number) => Uint8Array.from({ length: n }, (_, i) => (i * 37 + 11) & 0xff);
describe('glyph encoder', () => {
  it('emits the fixed footprint for every tier', () => {
    for (const [n, tid] of [[300, 0], [1100, 1], [2000, 2], [4000, 3]] as const) {
      const g = encodeGlyph(payload(n), 12)!;
      expect(g.tier.id).toBe(tid);
      expect({ width: g.width, height: g.height }).toEqual(bandSize(12));
    }
  });
  it('picks T4/T5 for larger payloads', () => {
    expect(encodeGlyph(payload(9000), 12)!.tier.id).toBe(4);
    expect(encodeGlyph(payload(19000), 12)!.tier.id).toBe(5);
  });
  it('returns null past T5 capacity', () => {
    expect(encodeGlyph(payload(TIERS[5]!.payloadCap + 1), 12)).toBeNull();
  });
  it('draws black finders and the calibration swatches', () => {
    const g = encodeGlyph(payload(200), 12)!;
    const px = (x: number, y: number) => [g.rgba[(y * g.width + x) * 4], g.rgba[(y * g.width + x) * 4 + 1], g.rgba[(y * g.width + x) * 4 + 2]];
    expect(px(18, 18)).toEqual([0, 0, 0]);                       // TL finder centre
    expect(px(g.width - 18, 18)).toEqual([0, 0, 0]);             // TR finder centre
    expect(px(4 * 12 + 6, 12)).toEqual([...PALETTE16[0]!]);      // swatch 0
  });
});
