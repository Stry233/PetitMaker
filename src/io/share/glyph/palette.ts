import { clamp01 } from '../../../core/base/math';

/**
 * PetitGlyph color tables use four BT.601 luma bands with four chroma offsets per band.
 * Index layout is `luma * 4 + chroma`. The baked legacy tables are derived with
 * `R = Y + 1.402Cr`, `G = Y - 0.344136Cb - 0.714136Cr`, and `B = Y + 1.772Cb`.
 * Decoding measures the actual colors from each glyph's calibration swatches.
 */
export type RGB = readonly [number, number, number];

/** Fixed version 1 decoder palette. */
const PALETTE16_V1: readonly RGB[] = [
  // luma 0 (Y=56, chroma ×0.5)
  [83, 51, 13],
  [87, 33, 93],
  [28, 62, 97],
  [24, 80, 17],
  // luma 1 (Y=112, chroma ×1)
  [165, 101, 27],
  [174, 66, 186],
  [56, 125, 194],
  [48, 160, 34],
  // luma 2 (Y=168, chroma ×1)
  [221, 157, 83],
  [230, 122, 242],
  [112, 181, 250],
  [104, 216, 90],
  // luma 3 (Y=214, chroma ×0.5)
  [241, 209, 171],
  [245, 191, 251],
  [186, 220, 255],
  [182, 238, 175],
];

/** Fixed version 2 decoder palette. */
const PALETTE16_V2: readonly RGB[] = [
  // luma 0 (Y=56, chroma ×0.51)
  [83, 51, 13],
  [87, 33, 94],
  [27, 62, 98],
  [23, 80, 16],
  // luma 1 (Y=112, chroma ×0.7)
  [149, 105, 52],
  [155, 80, 164],
  [73, 121, 169],
  [67, 146, 57],
  // luma 2 (Y=168, chroma ×0.7)
  [205, 161, 108],
  [211, 136, 220],
  [129, 177, 225],
  [123, 202, 113],
  // luma 3 (Y=214, chroma ×0.509)
  [241, 209, 171],
  [245, 191, 252],
  [185, 220, 255],
  [181, 238, 174],
];

/** Legacy palette shape for a recognized header version. Actual centroids come from the glyph. */
export function paletteForVersion(version: number): readonly RGB[] | null {
  if (version === 1) return PALETTE16_V1;
  if (version === 2) return PALETTE16_V2;
  return null;
}

/** Four sage tones carry information through luminance alone. */
export const PRODUCT_FOUR: readonly RGB[] = [
  [38, 48, 32], [103, 116, 92], [170, 184, 154], [237, 250, 219],
];

export const PRODUCT_INK: RGB = [0x18, 0x16, 0x12];
export const PRODUCT_PAPER: RGB = [0xf7, 0xf3, 0xe8];

/** Legacy eight-color subset with both chroma poles at each luma level. */
export const PALETTE8_INDICES: readonly number[] = [0, 2, 4, 6, 8, 10, 12, 14];

/** Legacy header levels, independent of the data palette. */
export const HEADER_LEVELS: readonly RGB[] = [
  [10, 10, 10],
  [92, 92, 92],
  [176, 176, 176],
  [248, 248, 246],
];

/** Warm header levels with the same normalized luma positions as HEADER_LEVELS. */
export const PRODUCT_HEADER_LEVELS: readonly RGB[] = HEADER_LEVELS.map((level) => {
  const t = rgbToYcc(level[0], level[1], level[2])[0] / 255;
  return [0, 1, 2].map((channel) => Math.round(
    PRODUCT_INK[channel]! + (PRODUCT_PAPER[channel]! - PRODUCT_INK[channel]!) * t,
  )) as unknown as RGB;
});

/** BT.601 RGB to zero-centered YCbCr. */
export function rgbToYcc(r: number, g: number, b: number): [number, number, number] {
  const y = 0.299 * r + 0.587 * g + 0.114 * b;
  const cb = (b - y) / 1.772;
  const cr = (r - y) / 1.402;
  return [y, cb, cr];
}


/** Classify by `2ΔY² + ΔCb² + ΔCr²`; confidence combines separation and absolute distance. */
export function classify(sample: RGB, centroids: readonly RGB[]): { idx: number; confidence: number } {
  const [y, cb, cr] = rgbToYcc(sample[0], sample[1], sample[2]);
  let bestIdx = 0;
  let d1 = Infinity;
  let d2 = Infinity;
  for (let i = 0; i < centroids.length; i++) {
    const c = centroids[i]!;
    const [cy, ccb, ccr] = rgbToYcc(c[0], c[1], c[2]);
    const dy = y - cy;
    const dcb = cb - ccb;
    const dcr = cr - ccr;
    const d = 2 * dy * dy + dcb * dcb + dcr * dcr;
    if (d < d1) {
      d2 = d1;
      d1 = d;
      bestIdx = i;
    } else if (d < d2) {
      d2 = d;
    }
  }
  const confidence = clamp01((d2 - d1) / (d2 + 1e-6)) * clamp01(1 - d1 / 9000);
  return { idx: bestIdx, confidence };
}
