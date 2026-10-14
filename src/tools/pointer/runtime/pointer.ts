/**
 * The one pointer path: a view gives the map point under a screen point (`screenToPoint`), and the
 * cell a tool acts on is resolved from it on the grid the tool declares (`Tool.grid`), through
 * `core/grid/pointer.ts:cellAtPoint`.
 */
import { cellAtPoint } from '../../../core/grid/pointer';
import type { GridCell, GridId, MapPoint } from '../../../core/grid/grids';
import type { ViewProjection } from './view-seam';
import type { Tool, ToolContext } from './types';

/** The pointer read once: the map point, the grid that resolved it and the cell holding it. */
export interface ResolvedPointer<G extends GridId = GridId> {
  point: MapPoint;
  grid: G;
  cell: GridCell<G>;
}

/**
 * Resolve screen point (sx, sy) for `tool`, and write the pointer facts the tool reads beside its
 * cell into `ctx`: the map point, the rendered label under it and the on-screen size of a cell there.
 * `ctx` is the context the tool is about to be called with.
 */
export function resolvePointer<G extends GridId>(
  view: { projection: ViewProjection }, tool: Tool<G>, ctx: ToolContext, sx: number, sy: number,
): ResolvedPointer<G> {
  const { projection } = view;
  const point = projection.screenToPoint(sx, sy);
  ctx.point = point;
  ctx.annotationLabelHit = projection.pickAnnotationLabel?.(sx, sy);
  ctx.cellPixels = projection.cellToScreen(Math.floor(point.x), Math.floor(point.y)).scale;
  const grid = tool.grid(ctx);
  return { point, grid, cell: cellAtPoint(point, grid) };
}
