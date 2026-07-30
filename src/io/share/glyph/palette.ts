import { clamp01 } from '../../../core/model/math';
// src/io/share/glyph/palette.ts — the PetitGlyph v2 luma-first color palette. Classification
// under real-world capture (recompression, mild blur, uneven lighting) is far more reliable on
// LUMA (brightness) than on hue: cameras/JPEG preserve Y much better than Cb/Cr. So rather than
// hue-separated colors at similar brightness, the palette is organized as 4 well-separated LUMA
// BANDS × 4 chroma variants each — luma alone narrows a sample to one of 4 bands before chroma
// has to do any discrimination work at all, so grayscale decoding degrades gracefully.
//
// PALETTE16 layout: index = luma * 4 + chroma, luma ∈ {0,1,2,3} ↔ Y ∈ {56, 112, 168, 214}.
//
// Derivation (BT.601, zero-centered Cb/Cr — see rgbToYcc below for the matching forward
// transform): for each luma row's Y and each chroma column's (Cb, Cr) offset,
//   R = Y + 1.402·Cr
//   G = Y − 0.344136·Cb − 0.714136·Cr
//   B = Y + 1.772·Cb
// each rounded to the nearest integer and clamped to 0..255.
//
// Base chroma-column offsets (Cb, Cr): (−48,+38), (+42,+44), (+46,−40), (−44,−46).
// These are used as-is for the two MIDDLE luma rows (112, 168) — nothing clamps there. The two
// EXTREME rows (56, 214) are close enough to 0/255 that the full-magnitude offsets clamp at
// least one channel (which would distort the row's actual luma away from its target), so those
// two rows use the same four offsets scaled by 0.5 and rounded — small enough that no channel
// clamps, so the inverse math stays exact. See palette.test.ts, which independently re-derives
// every literal below from this exact formula so the table can't silently drift.
export type RGB = readonly [number, number, number];

export const PALETTE16: readonly RGB[] = [
  // luma 0 (Y=56, scaled chroma offsets)
  [83, 51, 13],
  [87, 33, 93],
  [28, 62, 97],
  [24, 80, 17],
  // luma 1 (Y=112, base chroma offsets)
  [165, 101, 27],
  [174, 66, 186],
  [56, 125, 194],
  [48, 160, 34],
  // luma 2 (Y=168, base chroma offsets)
  [221, 157, 83],
  [230, 122, 242],
  [112, 181, 250],
  [104, 216, 90],
  // luma 3 (Y=214, scaled chroma offsets)
  [241, 209, 171],
  [245, 191, 251],
  [186, 220, 255],
  [182, 238, 175],
];

/** The 8-color subset (denser presets can still use fewer colors): 2 chroma variants from each
 *  of the 4 luma bands, so it keeps full luma coverage. Index layout is luma*4+chroma, so
 *  picking chroma columns {0,2} per band gives [0,2, 4,6, 8,10, 12,14]. */
export const PALETTE8_INDICES: readonly number[] = [0, 2, 4, 6, 8, 10, 12, 14];

/** 4 grayscale header/marker levels, monotone in luma and far apart (finder/header tiles need
 *  to survive classification even under heavy degradation, so they get maximal luma spacing). */
export const HEADER_LEVELS: readonly RGB[] = [
  [10, 10, 10],
  [92, 92, 92],
  [176, 176, 176],
  [248, 248, 246],
];

/** Off-white background / quiet-zone fill. */
export const BG: RGB = [0xf0, 0xf0, 0xeb];

/** BT.601 RGB → zero-centered YCbCr (Cb=Cr=0 for gray; matches the inverse used to derive
 *  PALETTE16 above: R = Y+1.402·Cr, G = Y−0.344136·Cb−0.714136·Cr, B = Y+1.772·Cb). */
export function rgbToYcc(r: number, g: number, b: number): [number, number, number] {
  const y = 0.299 * r + 0.587 * g + 0.114 * b;
  const cb = (b - y) / 1.772;
  const cr = (r - y) / 1.402;
  return [y, cb, cr];
}


/** Classify a sampled color against a set of centroid colors. Luma-weighted distance
 *  (d² = 2·ΔY² + ΔCb² + ΔCr²) since Y survives real-world capture far better than chroma, so it
 *  should dominate the match. Confidence blends the margin over the runner-up with an absolute
 *  closeness gate, so a sample that's merely "closest" to a centroid but still far from ALL of
 *  them reads as low-confidence (candidate for an RS erasure upstream). */
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
