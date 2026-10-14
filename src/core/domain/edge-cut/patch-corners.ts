/* The quadrants a Γ patch's corners stand in and newly raise: the mass the placement rules weigh. */
import { type Corners, type CornerTrim } from '../../model/types';
import { type Rect } from '../../grid/rect';
import { terrainCellRect } from '../../grid/grid-convert';
import { CORNERS } from '../../model/corners';

/** A corner the patch pass draws at the cell's tier: only 'empty' is open air. 'square' draws
 *  too — that is how a patch over a hidden block raises the whole cell to the wrapping tier. */
function drawsAtTier(c: CornerTrim | undefined): boolean {
  return c !== undefined && c !== 'empty';
}

/**
 * The macro-grid rect corner `cornerIdx` of terrain cell (x,y) is drawn in. Terrain sits half a
 * tile up-left of the object grid, so the cell spans [x-0.5, x+0.5]; a corner takes the quadrant
 * nearest it. A patch corner is walled from its tier down to the notch floor inside that quadrant
 * and never past it, so this rect is the whole footprint one adds.
 */
export function cornerQuadrantRect(x: number, y: number, cornerIdx: number): Rect {
  const [vertical, horizontal] = CORNERS[cornerIdx]!.sides;
  const left = horizontal === 'W', top = vertical === 'N';
  const cell = terrainCellRect({ x, y }), half = cell.w / 2;
  return { x: left ? cell.x : cell.x + half, y: top ? cell.y : cell.y + half, w: half, h: half };
}

/**
 * Corner indices a patch trim newly raises to its tier — the quadrants it adds mass in.
 *
 * A corner counts when the cell drew nothing there and the command puts something: a from-empty Γ
 * fillet reports just its own corner, while materialising a patch over a hidden block carries
 * 'square' on the other three and so reports the whole cell, which is exactly the silhouette it
 * raises. Re-shaping within a quadrant already drawn moves no mass, and clearing one adds none.
 *
 * `tierRises` says the patch is being re-seated up, against walls that have since stacked. Nothing
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

