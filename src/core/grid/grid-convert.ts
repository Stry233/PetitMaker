/**
 * The profile's grids (`game/profile.ts:GRIDS`) put to work: offsets in cells, the placement and
 * terrain grids' cell conversions, and reading named cell sets on one grid. A view scales cells by
 * its own cell size.
 */
import { GRIDS, PLACEMENT_GRID, TERRAIN_GRID } from '../game/profile';
import { gridCellAt, gridCellCentre, gridCellSize, gridCellRect, gridCellsUnder, type CellSet, type GridId } from './grids';
import type { MacroCoord } from '../base/coords';
import type { Rect } from './rect';

/** Where the terrain grid lies against the object grid, in cells per axis. */
export const TERRAIN_GRID_OFFSET = GRIDS[TERRAIN_GRID].offset;

/** The offset of `grid`'s cells, in cells per axis. */
export function gridOffset(grid: GridId): { readonly x: number; readonly y: number } {
  return GRIDS[grid].offset;
}

/** The side of `grid`'s cells, in map cells. */
export function gridSize(grid: GridId): number {
  return gridCellSize(GRIDS[grid]);
}

/** The area terrain cell `c` covers, in object-grid cells. */
export function terrainCellRect(c: MacroCoord): Rect {
  return gridCellRect(GRIDS[TERRAIN_GRID], c);
}

/** The centre of placement-grid cell `c`. */
export function cellCentre(c: MacroCoord): { x: number; y: number } {
  return gridCellCentre(GRIDS[PLACEMENT_GRID], c);
}

/** The terrain cell holding point (x, y), in object-grid cells. */
export function terrainCellAt(x: number, y: number): MacroCoord {
  return gridCellAt(GRIDS[TERRAIN_GRID], x, y);
}


/** The cells of `sets` that lie on `grid`. */
export function cellsOn(sets: readonly CellSet[], grid: GridId): MacroCoord[] {
  const out: MacroCoord[] = [];
  for (const set of sets) if (set.grid === grid) out.push(...set.cells);
  return out;
}

/** Every cell of `grid` that a cell of `sets` overlaps: a set on `grid` as it stands, a set on
 *  another grid through the cells under each of its cells. May repeat a cell. */
export function cellsCovering(sets: readonly CellSet[], grid: GridId): MacroCoord[] {
  const out: MacroCoord[] = [];
  for (const set of sets) {
    if (set.grid === grid) { out.push(...set.cells); continue; }
    for (const c of set.cells) out.push(...gridCellsUnder(GRIDS[grid], gridCellRect(GRIDS[set.grid], c)));
  }
  return out;
}
