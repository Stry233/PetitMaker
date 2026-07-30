/**
 * PER-CORNER Γ-patch split — the one derivation both renderers draw from. A
 * patch cell reads each corner independently: a corner WRAPPED by taller mass
 * is a cosmetic fillet at the cell's (higher) tier; any other cut corner is an
 * OUTER bevel on the real base (patchBase). The 2D terrain layer and the 3D
 * bevel path render the same base-pass + fillet-pass, so the split lives here,
 * beside cut-backing, where a policy change reaches both at once.
 */
import type { Corners, GridState, TerrainCell } from '../model/types';
import { cornerWrappedAt } from './terrain-silhouette';

export interface PatchCornerSplit {
  /** The real support tier the base block renders at (0 = no base block). */
  baseTier: number;
  /** The base block's corners: fillet-covered and empty corners read square
   *  (the fillet covers them); only an unwrapped fan/tri is a genuine bevel. */
  baseCorners: Corners;
  /** The fillet pass at the cell's cosmetic tier: unwrapped corners are empty. */
  filletCorners: Corners;
}

export function patchCornerSplit(state: GridState, x: number, y: number, t: TerrainCell): PatchCornerSplit {
  const corners: Corners = t.corners ?? ['empty', 'empty', 'empty', 'empty'];
  const baseTier = t.patchBase ?? (t.elevation - 1);
  const wrapped = corners.map((_, i) => cornerWrappedAt(state, x, y, i, t.type, t.elevation));
  const baseCorners = corners.map((c, i) => (wrapped[i] || c === 'empty' ? 'square' : c)) as Corners;
  const filletCorners = corners.map((c, i) => (wrapped[i] ? c : 'empty')) as Corners;
  return { baseTier, baseCorners, filletCorners };
}
