/**
 * PER-CORNER Γ-patch split — the one derivation both renderers draw from. A
 * patch cell reads each corner independently: a corner WRAPPED by taller mass
 * is a cosmetic fillet at the cell's (higher) tier; any other cut corner is an
 * OUTER bevel on the real base (patchBase). The 2D terrain layer and the 3D
 * bevel path render the same base-pass + fillet-pass, so the split lives here,
 * beside cut-backing, where a policy change reaches both at once.
 */
import type { Corners, CornerTrim, GridState, Rect, TerrainCell } from '../model/types';
import { cornerWrappedAt } from './terrain-silhouette';

/** A corner the patch pass DRAWS at the cell's tier: only 'empty' is open air. 'square' draws
 *  too — that is how a patch over a hidden block raises the whole cell to the wrapping tier. */
function drawsAtTier(c: CornerTrim | undefined): boolean {
  return c !== undefined && c !== 'empty';
}

/**
 * The macro-grid rect corner `cornerIdx` of terrain cell (x,y) is drawn in. Terrain sits half a
 * tile up-left of the object grid, so the cell spans [x-0.5, x+0.5]; a corner takes the quadrant
 * nearest it. A patch corner is walled from its tier down to the notch floor INSIDE that quadrant
 * and never past it, so this rect is the whole footprint one adds.
 */
export function cornerQuadrantRect(x: number, y: number, cornerIdx: number): Rect {
  const left = cornerIdx === 0 || cornerIdx === 2;  // TL, BL
  const top = cornerIdx === 0 || cornerIdx === 1;   // TL, TR
  return { x: left ? x - 0.5 : x, y: top ? y - 0.5 : y, w: 0.5, h: 0.5 };
}

/**
 * Corner indices a patch trim newly raises to its tier — the quadrants it adds mass in.
 *
 * A corner counts when the cell drew nothing there and the command puts something: a from-empty Γ
 * fillet reports just its own corner, while materialising a patch over a hidden block carries
 * 'square' on the other three and so reports the whole cell, which is exactly the silhouette it
 * raises. Re-shaping within a quadrant already drawn moves no mass, and clearing one adds none.
 *
 * `tierRises` says the patch is being re-seated UP, against walls that have since stacked. Nothing
 * moves horizontally there, but every quadrant the patch draws grows a taller column, so on a rise
 * they all count whatever they held before.
 */
export function addedPatchCorners(
  before: Corners | undefined, after: Corners, tierRises: boolean,
): number[] {
  const out: number[] = [];
  for (let i = 0; i < 4; i++) {
    if (!drawsAtTier(after[i])) continue;
    if (tierRises || !drawsAtTier(before?.[i])) out.push(i);
  }
  return out;
}

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
