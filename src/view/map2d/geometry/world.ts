/**
 * The 2D view's world units and camera bounds: world px per cell, the grid offsets in those px, the
 * zoom range and how much of the map a pan keeps on screen.
 */
import { GRIDS, TERRAIN_GRID } from '../../../core/game/profile';
import type { GridId } from '../../../core/grid/grids';
import { gridSize } from '../../../core/grid/grid-convert';

/** World px per cell. */
export const TILE_SIZE = 64;
/** Half a cell in 2D world px: a terrain cell's corner quadrant, and the pitch of the pointer's
 *  half-cell samples. */
export const QUADRANT_PX = TILE_SIZE / 2;

export const ZOOM_MIN = 0.05;
export const ZOOM_MAX = 4.0;

/** Camera pan bound: at least this many css px of map (or half the map, when it renders smaller)
 *  stay inside the canvas on each axis, so the map can be pushed mostly off-screen but never lost. */
export const PAN_KEEP_PX = 160;

/** `gridOffset` in 2D world px. */
export function gridOffsetPx(grid: GridId): { x: number; y: number } {
  const o = GRIDS[grid].offset;
  return { x: o.x * TILE_SIZE, y: o.y * TILE_SIZE };
}

/** The side of one of `grid`'s cells in 2D world px. */
export function gridCellPx(grid: GridId): number {
  return gridSize(grid) * TILE_SIZE;
}

/** `TERRAIN_GRID_OFFSET` in 2D world px. */
export const TERRAIN_GRID_OFFSET_PX = gridOffsetPx(TERRAIN_GRID);
