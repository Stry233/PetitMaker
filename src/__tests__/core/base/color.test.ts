import { describe, expect, it } from 'vitest';
import { channelLuma, linearToSrgb, srgbToLinear } from '../../../core/base/color';

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
