/* The cells a footprint covers and rests on, on the placement and terrain grids. */
import { GRIDS, PLACEMENT_GRID, TERRAIN_GRID } from '../game/profile';
import { gridCellRun, gridCellsUnder, gridCellsUnderRect, onGrid, type GridCell } from './grids';
import { cellKey, type Rect } from './rect';
import type { MacroCoord, Rotation } from '../base/coords';

/**
 * A validation error's evidence when its cause is a body (a footprint, or two overlapping) rather
 * than a cell: the exact `rects` the flash paints, plus the whole-cell `cells` other consumers read,
 * expanded from the same rects on the placement grid, so shade and reported cells cannot drift. A
 * half-grid body covers cells only partly, so its cells name a region up to half a cell larger.
 * An empty rect is dropped from both halves, since it cannot be drawn.
 */
export function bodyEvidence(rects: readonly Rect[]): { grid: typeof PLACEMENT_GRID; cells: GridCell<typeof PLACEMENT_GRID>[]; rects: Rect[] } {
  const drawable = rects.filter((r) => r.w > 0 && r.h > 0);
  const cells: MacroCoord[] = [];
  const seen = new Set<string>();
  for (const r of drawable) {
    for (const c of gridCellsUnder(GRIDS[PLACEMENT_GRID], r)) {
      const k = cellKey(c.x, c.y);
      if (seen.has(k)) continue;
      seen.add(k);
      cells.push(c);
    }
  }
  return { cells: onGrid(PLACEMENT_GRID, cells), rects: drawable, grid: PLACEMENT_GRID };
}

/** The terrain cells a footprint span [pos, pos + size) on `axis` rests on, as an inclusive run.
 *  Terrain lies on the terrain grid, offset against the footprint's own, so a span on that grid's
 *  edges rests on exactly `size` cells and a span on whole cells on `size + 1`, part of a cell past
 *  each end. */
export function terrainRun(pos: number, size: number, axis: 'x' | 'y'): { lo: number; hi: number } {
  return gridCellRun(GRIDS[TERRAIN_GRID].offset[axis], pos, size);
}

/** The terrain cells `rect` rests on, as a rect of terrain cells. */
export function footprintTerrain(rect: Rect): Rect {
  return gridCellsUnderRect(GRIDS[TERRAIN_GRID], rect);
}

/** The terrain cells `rect` rests on (`footprintTerrain`), row by row. */
export function terrainCellsUnder(rect: Rect): MacroCoord[] {
  return gridCellsUnder(GRIDS[TERRAIN_GRID], rect);
}

/** The object-grid cells `rect` covers whole; a cell it covers only in part is left out. */
export function wholeCellsOf(rect: Rect): Rect {
  const { offset } = GRIDS[PLACEMENT_GRID];
  const x = Math.ceil(rect.x - offset.x), y = Math.ceil(rect.y - offset.y);
  return {
    x, y,
    w: Math.max(0, Math.floor(rect.x + rect.w - offset.x) - x), h: Math.max(0, Math.floor(rect.y + rect.h - offset.y) - y),
  };
}

/** The w x h unit squares from (x, y), row by row, at the body's own origin: a half-step body's
 *  squares sit on half cells. `footprintCells` names the placement cells such a body covers. */
export function getFootprint(x: number, y: number, w: number, h: number): MacroCoord[] {
  const coords: MacroCoord[] = [];
  for (let dy = 0; dy < h; dy++)
    for (let dx = 0; dx < w; dx++)
      coords.push({ x: x + dx, y: y + dy });
  return coords;
}

/** The placement-grid cell indices along `axis` that the span [pos, pos + size) overlaps, so a
 *  half-integer origin (a halfStep item) names every cell it partly covers. */
export function coveredCells(pos: number, size: number, axis: 'x' | 'y'): number[] {
  const { lo, hi } = gridCellRun(GRIDS[PLACEMENT_GRID].offset[axis], pos, size);
  const cells: number[] = [];
  for (let i = lo; i <= hi; i++) cells.push(i);
  return cells;
}

/** The placement-grid cells an (x, y, w, h) footprint overlaps, row by row: a half-integer origin
 *  names every cell it partly covers instead of a fractional cell key. The trait sweeps, the region
 *  lock and the layer-number mask read an object's footprint through it. */
export function footprintCells(x: number, y: number, w: number, h: number): MacroCoord[] {
  return gridCellsUnder(GRIDS[PLACEMENT_GRID], { x, y, w, h });
}

/** Whether `rotation` turns a footprint across, swapping its width and height. */
export function isQuarterTurn(rotation: number): boolean {
  return rotation === 90 || rotation === 270;
}

export function getRotatedSize(item: { width: number; height: number }, rotation: Rotation): { w: number; h: number } {
  return isQuarterTurn(rotation)
    ? { w: item.height, h: item.width }
    : { w: item.width, h: item.height };
}
