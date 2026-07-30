// src/tools/generation/style.ts — the ONE naturalness→geometry mapping.
//
// `naturalness` (0..1) is the generator's geometry-style knob: 1 = the organic look (noise-warped
// seams, winding rivers, curved edge cuts — the classic output), 0 = fully rectilinear "lego"
// terrain (axis-aligned zone seams on a coarse lattice, straight dogleg rivers, stacked cliffs up
// to the V-MTN-03 window, Manhattan roads, no edge cuts). Every stage that shapes geometry reads
// its style through geoStyle() so the whole pipeline slides on one dial; nothing else may derive
// style from naturalness independently.
import { makeRng } from '../../core/model/rng';
import type { AutoEdgeCut } from '../../core/model/types';
import { TUNING } from './tuning';

export interface GeoStyle {
  /** Multiplier on the zone-border wobble amplitude (1 = current organic seams, 0 = pure voronoi). */
  wobbleScale: number;
  /** Rectilinear snap lattice: zone assignment is majority-voted per block×block tile (1 = off). */
  block: number;
  /** Terrace max cliff height (1 = wedding cake, up to 3 = stacked slabs; 3 is the V-MTN-03 window). */
  step: number;
  /** Square-cornered (Chebyshev) erosion/dilation for lake rims, channel widening and crown insets
   *  (false = Manhattan, whose diamond ball chamfers corners at 45°). */
  rect: boolean;
  /** River line-walk: extra probability of continuing the current axis (0 = per-step coin flip —
   *  the organic wiggle; 0.5 = never switch until the axis exhausts — clean L-shaped doglegs). */
  axisDrift: number;
  /** Road A* cost added per direction change (0 = current obstacle-driven winding). */
  turnPenalty: number;
  /** Whether generation applies auto edge cuts at all (cuts are the only true diagonals/curves). */
  cuts: boolean;
}

export function geoStyle(naturalness: number): GeoStyle {
  const n = Math.min(1, Math.max(0, naturalness));
  return {
    wobbleScale: n,
    block: 1 + Math.round((1 - n) * (TUNING.styleBlockMax - 1)),
    step: 1 + Math.round((1 - n) * (TUNING.styleStepMax - 1)),
    rect: n < TUNING.styleRectBelow,
    axisDrift: (1 - n) * 0.5,
    turnPenalty: (1 - n) * TUNING.styleTurnPenaltyMax,
    cuts: n >= TUNING.styleCutsBelow,
  };
}

/** The generated map's edge-cut style: seed-picked 'round'/'rect' so silhouette is consistent
 *  within a recipe but varies across them; 'off' below the style's cut threshold (no diagonals).
 *  Shared by the terrain pass (terrain-generator) and the road pass (populate) so both cut alike. */
export function generationCutMode(seed: number, naturalness: number): AutoEdgeCut {
  if (!geoStyle(naturalness).cuts) return 'off';
  return makeRng(seed ^ 0xed6ecc7).float() < 0.5 ? 'round' : 'rect';
}
