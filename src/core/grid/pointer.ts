/**
 * The cell a map point lies in, on a named grid: the one resolution the tool manager, the pointer
 * machine's press facts and hover probe, the curve handles and the region brush read, so a probe
 * and the click it predicts never resolve different cells.
 */
import { GRIDS } from '../game/profile';
import { gridCell, gridCellAt, type GridCell, type GridId, type MapPoint } from './grids';
import { snapHalf } from './rect';
import type { MacroCoord } from '../base/coords';

/** What a view answers to place a screen point on the map. */
interface ScreenToPoint {
  screenToPoint(sx: number, sy: number): MapPoint;
}

/** The cell of `grid` holding map point `point`, read at the point's half-cell sample: subtracting
 *  an offset on that lattice from the sample is exact, where subtracting it from the raw point can
 *  round a point just short of a cell edge across it. */
export function cellAtPoint<G extends GridId>(point: MapPoint, grid: G): GridCell<G> {
  return gridCell(grid, gridCellAt(GRIDS[grid], Math.floor(point.x * 2) / 2, Math.floor(point.y * 2) / 2));
}

/** The cell of `grid` under screen point (sx, sy). */
export function cellUnder<G extends GridId>(projection: ScreenToPoint, sx: number, sy: number, grid: G): GridCell<G> {
  return cellAtPoint(projection.screenToPoint(sx, sy), grid);
}

/** The half-cell lattice point nearest `point`, ties toward +∞: where a half-step item's anchor goes. */
export function halfPoint(point: MapPoint): MacroCoord {
  return { x: snapHalf(point.x), y: snapHalf(point.y) };
}
