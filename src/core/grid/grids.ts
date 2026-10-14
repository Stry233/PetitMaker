/**
 * The grid concept: a lattice of unit cells lying at an offset against the map's own lattice, where
 * cell (x, y) covers [x + offset.x, x + offset.x + 1) × [y + offset.y, y + offset.y + 1). Which grids
 * a map has, and where each lies, is game data (`game/profile.ts:GRIDS`); the conversions here take
 * a `GridSpec` and know no grid by name. Positions and sizes are in cells.
 */
import type { GRIDS } from '../game/profile';
import type { Brand, MacroCoord } from '../base/coords';
import type { Rect } from './rect';

/** Where one grid's cells lie against the map's lattice, in cells per axis. */
export interface GridSpec {
  readonly offset: { readonly x: number; readonly y: number };
}

/** A grid named by its key in the profile's grid table. */
export type GridId = keyof typeof GRIDS;

/** A continuous map position in cells, on no grid: what a view reads under the pointer. */
export type MapPoint = Brand<MacroCoord, 'map-point'>;

/** An integer cell of grid `G`. A cell of one grid is not a cell of another, and a bare `{ x, y }`
 *  is a cell of none until something that knows the grid says so (`onGrid`, `gridCell`,
 *  `core/grid/pointer.ts:cellAtPoint`). */
export type GridCell<G extends GridId = GridId> = Brand<MacroCoord, { readonly grid: G }>;

/** Cells of one named grid; `CellSet` alone is a set of any grid, its cells on the grid it names. */
export type CellSet<G extends GridId = GridId> = G extends GridId ? { grid: G; cells: readonly GridCell<G>[] } : never;

/** A cell naming the grid it lies on. It carries its grid as data, so it needs no brand. */
export type GridCellRef = MacroCoord & { grid: GridId };

/** Cells of grid `G`, each unless it names a grid of its own (`GridCellRef`): one macro run changes
 *  terrain and objects at once, and its preview carries both. */
export type MixedCellSet<G extends GridId = GridId> = G extends GridId ? { grid: G; cells: readonly (GridCell<G> | GridCellRef)[] } : never;

/** The grid `c` names for itself, else `fallback`. */
export function cellGrid(c: MacroCoord | GridCellRef, fallback: GridId): GridId {
  return 'grid' in c ? c.grid : fallback;
}

/** `p`, a position read off the map, as a map point. */
export function mapPoint(p: MacroCoord): MapPoint {
  return p as MapPoint;
}

/** `c` as a cell of `grid`: the caller knows the grid it was computed on. */
export function gridCell<G extends GridId>(_grid: G, c: MacroCoord): GridCell<G> {
  return c as GridCell<G>;
}

/** `cells` as cells of `grid`: the caller knows the grid they were computed on. */
export function onGrid<G extends GridId>(_grid: G, cells: readonly MacroCoord[]): GridCell<G>[] {
  return cells as GridCell<G>[];
}

/** `cells` as a set on `grid`. */
export function cellSet<G extends GridId>(grid: G, cells: readonly MacroCoord[]): CellSet<G> {
  return { grid, cells } as unknown as CellSet<G>;
}

/** `cells` as a set on `grid`, where a cell naming its own grid keeps it. */
export function mixedCellSet<G extends GridId>(grid: G, cells: readonly (MacroCoord | GridCellRef)[]): MixedCellSet<G> {
  return { grid, cells } as unknown as MixedCellSet<G>;
}

/** A validation error's evidence: `cells` on `grid`, both fields at once so the two cannot part. */
export function evidenceOn<G extends GridId>(grid: G, cells: readonly MacroCoord[]): G extends GridId ? { grid: G; cells: GridCell<G>[] } : never {
  return { cells, grid } as never;
}

/** The cell of `spec` holding point (x, y). */
export function gridCellAt(spec: GridSpec, x: number, y: number): MacroCoord {
  return { x: Math.floor(x - spec.offset.x), y: Math.floor(y - spec.offset.y) };
}

/** The area cell `c` of `spec` covers. */
export function gridCellRect(spec: GridSpec, c: MacroCoord): Rect {
  return { x: c.x + spec.offset.x, y: c.y + spec.offset.y, w: 1, h: 1 };
}

/** The centre of cell `c` of `spec`. */
export function gridCellCentre(spec: GridSpec, c: MacroCoord): { x: number; y: number } {
  return { x: c.x + spec.offset.x + 0.5, y: c.y + spec.offset.y + 0.5 };
}

/** The cells along one axis that overlap the span [pos, pos + size), as an inclusive run. `offset`
 *  is the grid's offset on that axis. */
export function gridCellRun(offset: number, pos: number, size: number): { lo: number; hi: number } {
  return { lo: Math.floor(pos - offset), hi: Math.ceil(pos + size - (offset + 1)) };
}

/** The cells of `spec` that overlap `rect`, as a rect of cells (`gridCellRun` per axis). */
export function gridCellsUnderRect(spec: GridSpec, rect: Rect): Rect {
  const xs = gridCellRun(spec.offset.x, rect.x, rect.w), ys = gridCellRun(spec.offset.y, rect.y, rect.h);
  return { x: xs.lo, y: ys.lo, w: Math.max(0, xs.hi - xs.lo + 1), h: Math.max(0, ys.hi - ys.lo + 1) };
}

/** `gridCellsUnderRect`'s cells, row by row. */
export function gridCellsUnder(spec: GridSpec, rect: Rect): MacroCoord[] {
  const r = gridCellsUnderRect(spec, rect);
  const cells: MacroCoord[] = [];
  for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) cells.push({ x, y });
  return cells;
}
