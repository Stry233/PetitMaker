/**
 * Per-corner Γ-patch split — the one derivation both renderers draw from. A
 * patch cell reads each corner independently: a corner wrapped by taller mass
 * is a cosmetic fillet at the cell's (higher) tier; any other cut corner is an
 * Outer bevel on the real base (patchBase). The 2D terrain layer and the 3D
 * bevel path render the same base-pass + fillet-pass, so the split lives here,
 * beside cut-backing, where a policy change reaches both at once.
 */
import { type Corners, type GridState, type TerrainCell } from '../../../core/model/types';
import { EMPTY_CORNERS, mapCorners } from '../../../core/model/corners';
import { cornerWrappedAt } from '../../../core/domain/edge-cut/silhouette';
import { patchSupport } from '../../../core/domain/terrain/terrain-surface';

interface PatchCornerSplit {
  /** The real support tier the base block renders at (0 = no base block). */
  baseTier: number;
  /** The base block's corners: fillet-covered and empty corners read square
   *  (the fillet covers them); only an unwrapped fan/tri is a genuine bevel. */
  baseCorners: Corners;
  /** The fillet pass at the cell's cosmetic tier: unwrapped corners are empty. */
  filletCorners: Corners;
}

export function patchCornerSplit(state: GridState, x: number, y: number, t: TerrainCell): PatchCornerSplit {
  const corners: Corners = t.corners ?? [...EMPTY_CORNERS];
  const baseTier = patchSupport(t);
  const wrapped = corners.map((_, i) => cornerWrappedAt(state, x, y, i, t));
  const baseCorners = mapCorners(corners, (c, i) => (wrapped[i] || c === 'empty' ? 'square' : c));
  const filletCorners = mapCorners(corners, (c, i) => (wrapped[i] ? c : 'empty'));
  return { baseTier, baseCorners, filletCorners };
}
