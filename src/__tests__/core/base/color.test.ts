import { describe, expect, it } from 'vitest';
import { channelLuma, linearToSrgb, luma709, rgbaOf, srgbToLinear } from '../../../core/base/color';

describe('color transfer and luma', () => {
  it('weighs channels by Rec. 601', () => {
    expect(channelLuma(255, 255, 255)).toBeCloseTo(255, 9);
    expect(channelLuma(100, 0, 0)).toBeCloseTo(29.9, 9);
  });

  it('decodes and encodes sRGB as inverses, linear near black', () => {
    expect(srgbToLinear(0.02)).toBeCloseTo(0.02 / 12.92, 12);
    expect(srgbToLinear(0.5)).toBeCloseTo(0.214041, 6);
    for (const v of [0, 0.01, 0.2, 0.5, 0.9, 1]) expect(linearToSrgb(srgbToLinear(v))).toBeCloseTo(v, 9);
  });
});

describe('rgbaOf and Rec. 709 luma', () => {
  it('writes a hex colour at an exact alpha', () => {
    expect(rgbaOf('#FFFEE3', 0.5)).toBe('rgba(255, 254, 227, 0.5)');
  });

  it('weighs channels by Rec. 709', () => {
    expect(luma709(255, 255, 255)).toBeCloseTo(255, 9);
    expect(luma709(0, 255, 0)).toBeCloseTo(0.7152 * 255, 9);
  });
});
