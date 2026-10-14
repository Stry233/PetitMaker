/*
 * Test-side claims about coordinate spaces. A test that drives a tool or an overlay by hand names
 * the space its literal coordinates are in; the grid is the one the receiving parameter asks for.
 */
import { mapPoint, type GridCell, type GridId, type MapPoint } from '../../core/grid/grids';
import type { MacroCoord } from '../../core/model/types';

/** `c` as a cell of whichever grid the receiving parameter names. */
export function cell<G extends GridId>(c: MacroCoord): GridCell<G> {
  return c as GridCell<G>;
}

/** `cs` as cells of whichever grid the receiving parameter names. */
export function cells<G extends GridId>(cs: readonly MacroCoord[]): GridCell<G>[] {
  return cs as GridCell<G>[];
}

/** `p` as a map point. */
export function point(p: MacroCoord): MapPoint {
  return mapPoint(p);
}
