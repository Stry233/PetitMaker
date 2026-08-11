import { clamp01 } from '../../../core/model/math';
// src/io/share/glyph/palette.ts — the PetitGlyph luma-first color palette. Classification under
// real-world capture (recompression, mild blur, uneven lighting) is far more reliable on LUMA
// (brightness) than on hue: cameras/JPEG preserve Y much better than Cb/Cr. So rather than
// hue-separated colors at similar brightness, the palette is organized as 4 well-separated LUMA
// BANDS × 4 chroma variants each — luma alone narrows a sample to one of 4 bands before chroma
// has to do any discrimination work at all, so grayscale decoding degrades gracefully.
//
// Layout: index = luma * 4 + chroma, luma ∈ {0,1,2,3} ↔ Y ∈ Y_LEVELS.
//
// Derivation (BT.601, zero-centered Cb/Cr — see rgbToYcc below for the matching forward
// transform): for each luma row's Y and each chroma column's (Cb, Cr) offset scaled by that row's
// entry in the version's CHROMA_SCALES,
//   R = Y + 1.402·Cr
//   G = Y − 0.344136·Cb − 0.714136·Cr
//   B = Y + 1.772·Cb
// each rounded to the nearest integer and clamped to 0..255. The SCALED OFFSETS stay real-valued;
// only the resulting RGB is rounded. Rounding the offsets first would quantize the scale to the
// coarse steps the base offsets allow, and those steps are wider than the differences that matter
// here: every offset at 0.51 and at 0.509 rounds to exactly what 0.5 does, so both of v2's near-0.5
// bands would collapse onto v1's and gain nothing at all. palette.test.ts re-runs this derivation
// from the exported constants against both baked tables, so neither can silently drift.
//
// A PALETTE IS PART OF THE WIRE FORMAT on the WRITING side: an encoder draws with exactly one
// table, so changing what new codes look like is a new HEADER_VERSION. On the READING side it is
// not — see paletteForVersion.
export type RGB = readonly [number, number, number];

/** The 4 luma band centers, dark to light. */
export const Y_LEVELS: readonly number[] = [56, 112, 168, 214];

/** The 4 chroma columns as (Cb, Cr) offsets at scale 1, one per chroma variant. */
export const BASE_CHROMA_OFFSETS: readonly (readonly [number, number])[] = [
  [-48, 38],
  [42, 44],
  [46, -40],
  [-44, -46],
];

// Within a band every entry shares one Y, so chroma alone separates the four variants and a band's
// squared separation under the classifier is 7072 · scale² (7072 is the closest base-offset pair's
// squared chroma distance). The scale a band can afford is capped by clipping: at Y=56 and Y=214
// the full-magnitude offsets drive a channel past 0/255, which would drag the row's actual luma off
// its target. Those ceilings are [0.664, 1.323, 1.073, 0.509].
//
// Band 3's ceiling is the LOWEST, so 0.509 is the most any band can contribute to the worst case
// and every other band only has to clear it. Separation past that point is invisible: the code is
// only as good as its weakest band. Band 0 in particular must not chase its own 0.664 ceiling —
// the entry that pushes both Cb and Cr negative darkens as that scale rises (channel sum
// 168 − 94.47·scale), and findFinders flood-fills anything under a channel sum of 100, so the
// surplus would be paid for out of the margin that keeps a dark data module from merging into an
// adjacent finder square.
/** Per-luma-band chroma scale, keyed by the HEADER_VERSION that draws with it. */
export const CHROMA_SCALES: Readonly<Record<number, readonly number[]>> = {
  // Middles at full magnitude, extremes at half their ceiling: band separations 1767/7032/7032/
  // 1767. Robustness is the weakest band, so the middles hold four times the margin that decides it.
  1: [0.5, 1, 1, 0.5],
  // The middles come down to roughly twice the bottleneck and the extremes take the rest of what
  // band 3's ceiling allows: 1801/3438/3438/1801. Same worst case for every band, none hoarding a
  // surplus the weakest link can never use. Levelling all four onto the bottleneck instead would
  // hold that worst case while raising the TOTAL error rate, since bands that currently almost
  // never misread would start contributing.
  2: [0.51, 0.7, 0.7, 0.509],
};

/** Version 1's table. Reachable forever: codes drawn with it are already in the wild. */
export const PALETTE16_V1: readonly RGB[] = [
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

/** Version 2's table. */
export const PALETTE16_V2: readonly RGB[] = [
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

/** The table a code drawn at header version `version` carries. Null for a version this build does
 *  not know, which is what makes an unrecognized version a clean decode refusal.
 *
 *  THE DECODER NEVER READS THESE COLORS. It learns one centroid per entry off the code's own
 *  calibration swatches (decode.ts), so a resolved table contributes exactly two things to a
 *  decode: its LENGTH, and the null that refuses an unknown version. Compatibility is therefore
 *  structural rather than archival — no edit to a released table can break a code already in the
 *  wild, and a table that had drifted from what its version actually drew would still decode every
 *  code drawn with it. That is a stronger guarantee than keeping the old numbers around, and it
 *  also means no decode can catch such a drift: the guard with teeth on a released table is
 *  palette.test.ts's re-derivation from Y_LEVELS / BASE_CHROMA_OFFSETS / CHROMA_SCALES. */
export function paletteForVersion(version: number): readonly RGB[] | null {
  if (version === 1) return PALETTE16_V1;
  if (version === 2) return PALETTE16_V2;
  return null;
}

/** The table NEW codes are drawn with — HEADER_VERSION's, pinned to it by palette.test.ts. */
export const PALETTE16: readonly RGB[] = PALETTE16_V2;

/** The 8-color subset (denser presets can still use fewer colors): 2 chroma variants from each
 *  of the 4 luma bands, so it keeps full luma coverage. Index layout is luma*4+chroma, so
 *  picking chroma columns {0,2} per band gives [0,2, 4,6, 8,10, 12,14]. Those two columns sit
 *  nearly opposite in the chroma plane (squared distance 14920 at scale 1, against 7072 for the
 *  closest pair), so the subset is the widest-separated pair a band can offer at any scale and
 *  needs no per-version choice of its own. */
export const PALETTE8_INDICES: readonly number[] = [0, 2, 4, 6, 8, 10, 12, 14];

/** 4 grayscale header/marker levels, monotone in luma and far apart (finder/header tiles need
 *  to survive classification even under heavy degradation, so they get maximal luma spacing).
 *  Independent of the color palette, which is what lets the header name the version that then
 *  says how to read the colors. */
export const HEADER_LEVELS: readonly RGB[] = [
  [10, 10, 10],
  [92, 92, 92],
  [176, 176, 176],
  [248, 248, 246],
];

/** Off-white background / quiet-zone fill. */
export const BG: RGB = [0xf0, 0xf0, 0xeb];

/** BT.601 RGB → zero-centered YCbCr (Cb=Cr=0 for gray; matches the inverse used to derive the
 *  palettes above: R = Y+1.402·Cr, G = Y−0.344136·Cb−0.714136·Cr, B = Y+1.772·Cb). */
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
