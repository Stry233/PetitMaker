import * as PIXI from 'pixi.js-legacy';
import { TILE_SIZE, gridCellPx, gridOffsetPx } from '../../geometry/world';
import type { GridId } from '../../../../core/grid/grids';
import type { ErrorFlashRect } from '../../../shared/overlay/error-flash';
import type { CellSpan } from '../../../../core/grid/cell-spans';

export interface WorldRect { x: number; y: number; w: number; h: number }
/** A grid's offset in world px. */
export type Shift = { x: number; y: number };

/** Draw one cell-sized rect on `g`, on `grid`. */
export function cellRect(g: PIXI.Graphics, x: number, y: number, grid: GridId): void {
  const shift = gridOffsetPx(grid), px = gridCellPx(grid);
  g.drawRect(x * px + shift.x, y * px + shift.y, px, px);
}

/** Draw one merged row span (see core/grid/cell-spans.ts) on its grid. */
export function spanRect(g: PIXI.Graphics, sp: CellSpan): void {
  const shift = gridOffsetPx(sp.grid), px = gridCellPx(sp.grid);
  g.drawRect(sp.x * px + shift.x, sp.y * px + shift.y, sp.w * px, px);
}

/** Draw one flashed body on its grid: the rect exactly as the thing it accuses is drawn, origin
 *  and size included (both are fractional for a half-grid footprint). */
export function bodyRect(g: PIXI.Graphics, r: ErrorFlashRect): void {
  const shift = gridOffsetPx(r.grid);
  g.drawRect(r.x * TILE_SIZE + shift.x, r.y * TILE_SIZE + shift.y, r.w * TILE_SIZE, r.h * TILE_SIZE);
}
