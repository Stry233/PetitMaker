/**
 * Waterfall detection utility — shared by water-containment and waterfall-uniformity.
 *
 * A waterfall face exists at a water cell when:
 * 1. A cardinal neighbor has lower elevation (height drop = flow direction)
 * 2. The perpendicular axis is capped by mountains on both ends
 *
 * Key functions:
 * - `traceToMountain(state, x, y, elev, dx, dy)`: walks in direction (dx,dy) through
 *   same-elevation water cells. Returns true if the first non-water cell is mountain
 *   at exactly elev. Returns false if it hits ground, map edge, or different-elevation terrain.
 * - `cellElevation(state, x, y)`: returns -1 for out-of-bounds, 0 for null terrain
 *   (ground), or the terrain's elevation.
 * - `detectWaterfalls(state)`: full grid scan returning WaterfallInfo[] with faces.
 *   Only includes cells that have at least one capped waterfall face.
 */
import { TerrainType, type GridState, type MacroCoord } from './types';
import { getCell, NEIGHBORS4, cellKey } from './grid-model';
import { solidTopOf, surfaceElevation } from '../edge-cut/terrain-silhouette';

export type Direction = 'north' | 'south' | 'east' | 'west';

export interface WaterfallFace {
  x: number;
  y: number;
  flowDirection: Direction;
}

export interface WaterfallInfo {
  cells: MacroCoord[];
  faces: WaterfallFace[];
}

export const DIR_OFFSETS: Record<Direction, { dx: number; dy: number }> = {
  north: { dx: 0, dy: -1 },
  south: { dx: 0, dy: 1 },
  west:  { dx: -1, dy: 0 },
  east:  { dx: 1, dy: 0 },
};

export const PERP_DIRS: Record<Direction, [Direction, Direction]> = {
  north: ['west', 'east'],
  south: ['west', 'east'],
  west:  ['north', 'south'],
  east:  ['north', 'south'],
};

export function cellElevation(state: GridState, x: number, y: number): number {
  const cell = getCell(state.cells, x, y);
  if (!cell) return -1;
  // The STRUCTURAL height: a Γ fillet renders at a higher tier but holds no mass —
  // reading its cosmetic tier here would let a mass-less corner hide a height drop
  // or stand in for real terrain in the cap tests.
  return surfaceElevation(cell.terrain);
}

export function isWaterAtElev(state: GridState, x: number, y: number, elev: number): boolean {
  const cell = getCell(state.cells, x, y);
  if (!cell?.terrain) return false;
  return cell.terrain.type === TerrainType.Water && surfaceElevation(cell.terrain) === elev;
}

export function traceToMountain(
  state: GridState, x: number, y: number, elev: number, dx: number, dy: number,
): boolean {
  let cx = x + dx;
  let cy = y + dy;
  while (true) {
    const cell = getCell(state.cells, cx, cy);
    if (!cell?.terrain) return false;
    // A cap must be real mountain MASS topping out exactly at the water's tier. A
    // mass-less fillet at that tier is not a cap (the water would pour through it
    // in-game); a fillet whose real base reaches the tier is — the base caps.
    if (solidTopOf(cell.terrain, TerrainType.Mountain) === elev) return true;
    if (cell.terrain.type !== TerrainType.Water || surfaceElevation(cell.terrain) !== elev) return false;
    cx += dx;
    cy += dy;
  }
}

/** The capped waterfall faces of ONE water cell (empty when (x,y) isn't elevated
 *  capped water). Single-cell core of detectWaterfalls; also drives the
 *  WATERFALL-FRAME corner lock in core/trim-lock. */
export function waterfallFacesAt(state: GridState, x: number, y: number): WaterfallFace[] {
  const cell = getCell(state.cells, x, y);
  if (!cell?.terrain || cell.terrain.type !== TerrainType.Water) return [];
  const elev = surfaceElevation(cell.terrain);
  const faces: WaterfallFace[] = [];
  for (const dir of ['north', 'south', 'east', 'west'] as Direction[]) {
    const { dx, dy } = DIR_OFFSETS[dir];
    if (cellElevation(state, x + dx, y + dy) >= elev) continue;
    const [perpA, perpB] = PERP_DIRS[dir];
    const { dx: pdxA, dy: pdyA } = DIR_OFFSETS[perpA];
    const { dx: pdxB, dy: pdyB } = DIR_OFFSETS[perpB];
    if (traceToMountain(state, x, y, elev, pdxA, pdyA) && traceToMountain(state, x, y, elev, pdxB, pdyB)) {
      faces.push({ x, y, flowDirection: dir });
    }
  }
  return faces;
}

/**
 * Is (x,y) inside some waterfall face's dependency footprint, judged from the CURRENT state?
 * Every cell a face depends on — the water cell itself, its 4-neighbours (the height-drop
 * elevations), the same-elevation trace cells, and both cap terminators — is water or cardinally
 * adjacent to water in any state where the face exists. So an edit at (x,y) can only create or
 * destroy a face if this is true NOW, or if (x,y) previously carried a face (the erase-a-whole-
 * water-body-in-one-command case) — callers gating a detectWaterfalls recompute must check that
 * second half against the face set they last computed.
 */
export function touchesWaterfallDependency(state: GridState, x: number, y: number): boolean {
  const isWater = (cx: number, cy: number): boolean =>
    getCell(state.cells, cx, cy)?.terrain?.type === TerrainType.Water;
  if (isWater(x, y)) return true;
  for (const [dx, dy] of NEIGHBORS4) if (isWater(x + dx, y + dy)) return true;
  return false;
}

export function detectWaterfalls(state: GridState): WaterfallInfo[] {
  const { width, height } = state.template;
  const results: WaterfallInfo[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const faces = waterfallFacesAt(state, x, y);
      if (faces.length > 0) results.push({ cells: [{ x, y }], faces });
    }
  }
  return results;
}

/** Group every waterfall face by the cell it sits on: `cellKey(x,y)` → the flow directions that
 *  cell emits. Both renderers draw one arrow per direction per cell and rebuilt this identical
 *  grouping by hand; this is the single source (they differ only in the arrow geometry they then
 *  build from it). */
export function waterfallFaceMap(state: GridState): Map<string, Direction[]> {
  const cellFaces = new Map<string, Direction[]>();
  for (const info of detectWaterfalls(state)) {
    for (const face of info.faces) {
      const key = cellKey(face.x, face.y);
      const list = cellFaces.get(key) ?? [];
      list.push(face.flowDirection);
      cellFaces.set(key, list);
    }
  }
  return cellFaces;
}
