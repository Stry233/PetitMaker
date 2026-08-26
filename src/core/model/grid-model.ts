/**
 * Grid data structure and spatial utilities.
 *
 * Coordinate system: (x, y) where x is column, y is row.
 * cells[y][x] — row-major storage. Out-of-bounds access returns null.
 *
 * The grid is mutable — `setCell` and terrain assignment modify in place.
 * Immutable snapshots are produced via `cloneCell` for undo/redo.
 */

import { CellZone, TerrainType } from './types';
import type { ChunkCoord, Corners, GridState, MacroCell, MacroCoord, MicroCoord, MapTemplate, ObjectsDelta, PlacedObject, Rect, TerrainCell } from './types';
import { CHUNK_SIZE, TILE_SIZE, PLAZA_ID } from './constants';

export const HALF_TILE = TILE_SIZE / 2;

/** Whether a zone can be built/placed/painted on. Grass is the only buildable zone
 *  today — this is the ONE place that fact lives, so adding a buildable zone is a
 *  single edit here rather than hunting every `=== CellZone.Grass` gate. */
export function isBuildableZone(zone: CellZone): boolean {
  return zone === CellZone.Grass;
}

export function createDefaultTerrainCell(type: TerrainType, elevation: number): TerrainCell {
  return { type, elevation };
}

/** Initializes a grid from a template — all cells start with null terrain. The
 *  plaza is a normal immutable PlacedObject over plain Grass cells (see
 *  createPlazaObject), not terrain. */
export function createGrid(template: MapTemplate): MacroCell[][] {
  const { width, height, zones } = template;
  const cells: MacroCell[][] = [];
  for (let y = 0; y < height; y++) {
    const row: MacroCell[] = [];
    for (let x = 0; x < width; x++) {
      let zone = zones[y]?.[x] ?? CellZone.Void;
      if (zone === CellZone.Plaza) zone = CellZone.Grass; // the plaza is a locked object, not a zone
      row.push({ zone, terrain: null });
    }
    cells.push(row);
  }
  return cells;
}

export type { Rect } from './types';

/**
 * A validation error's evidence when its cause is a BODY (an object's footprint, or the overlap of
 * two of them) rather than a grid cell: the exact `rects` the flash paints, plus the whole-cell
 * `cells` every non-drawing consumer reads (the agent's echo, tests), derived from those same rects
 * by floor/ceil expansion. ONE call states the body once, so the drawn shade and the reported cells
 * cannot drift apart.
 *
 * The distinction is not cosmetic: a body on the half grid (the plaza at x.5, a ramp/bridge anchor)
 * covers cells only partially, so its whole-cell list names a region up to half a cell larger on
 * every side — a refusal shade visibly bigger than the thing that refused.
 *
 * An EMPTY rect is dropped from both halves rather than from one: a body with no extent cannot be
 * drawn, and keeping its cells would report evidence the flash then has nothing to show for.
 */
export function bodyEvidence(rects: readonly Rect[]): { cells: MacroCoord[]; rects: Rect[] } {
  const drawable = rects.filter((r) => r.w > 0 && r.h > 0);
  const cells: MacroCoord[] = [];
  const seen = new Set<string>();
  for (const r of drawable) {
    for (let y = Math.floor(r.y); y < Math.ceil(r.y + r.h); y++) {
      for (let x = Math.floor(r.x); x < Math.ceil(r.x + r.w); x++) {
        const k = cellKey(x, y);
        if (seen.has(k)) continue;
        seen.add(k);
        cells.push({ x, y });
      }
    }
  }
  return { cells, rects: drawable };
}

/** Whether the unit cell at macro (x, y) overlaps `rect`. `cellShift` is the
 *  cell's lower-bound offset: terrain renders on the micro-grid (−HALF_TILE), so
 *  its cell spans [x−0.5, x+0.5] → shift −0.5; objects use the macro grid → shift 0.
 *  This single test is what lets a fractional-edge footprint (the plaza) and a
 *  normal integer footprint share the same overlap logic. */
export function cellOverlapsRect(rect: Rect, x: number, y: number, cellShift: number): boolean {
  const cl = x + cellShift, ct = y + cellShift;
  return cl < rect.x + rect.w && cl + 1 > rect.x && ct < rect.y + rect.h && ct + 1 > rect.y;
}

/** AABB overlap of two macro rects. Touching edges (a.x + a.w === b.x) do NOT
 *  count as overlapping — matches the object-to-object "strict <" rule. */
export function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/** The immutable central-plaza object built from the map's plaza config (null if
 *  the map has none). Fractional position + per-map size; locked. Added to the
 *  grid's objects at init/load and excluded from serialization. */
export function createPlazaObject(template: MapTemplate): PlacedObject | null {
  const p = template.plaza;
  if (!p || p.width === 0 || p.height === 0) return null;
  return {
    id: PLAZA_ID, catalogId: PLAZA_ID,
    position: { x: p.x, y: p.y }, width: p.width, height: p.height,
    // Self-description so the plaza renders through the normal object path (no special-case renderer):
    icon: 'plaza', color: p.color,
    rotation: 0, elevation: p.elevation, locked: true,
  };
}

export function isInBounds(x: number, y: number, width: number, height: number): boolean {
  return x >= 0 && x < width && y >= 0 && y < height;
}

/** Whether a coordinate names a cell or a cell boundary — the only two things a placement
 *  may sit on (the boundary is what the halfStep trait grants ramps and bridges). */
export function onHalfGrid(v: number): boolean {
  return Number.isInteger(v * 2);
}

/** The macro cell indices a (possibly half) coordinate straddles: one at a whole
 *  coordinate, the two either side of a half one. */
export function straddledCells(v: number): { lo: number; hi: number } {
  const mv = Math.round(v * 2);
  return mv % 2 === 0 ? { lo: mv / 2, hi: mv / 2 } : { lo: (mv - 1) / 2, hi: (mv + 1) / 2 };
}

/** Returns null for out-of-bounds coordinates. Never throws. */
export function getCell(cells: MacroCell[][], x: number, y: number): MacroCell | null {
  const row = cells[y];
  if (!row) return null;
  return row[x] ?? null;
}

/** No-op for out-of-bounds coordinates. Never throws. */
export function setCell(cells: MacroCell[][], x: number, y: number, cell: MacroCell): void {
  const row = cells[y];
  if (row && x >= 0 && x < row.length) {
    row[x] = cell;
  }
}

export function macroToChunk(x: number, y: number): ChunkCoord {
  return { cx: Math.floor(x / CHUNK_SIZE), cy: Math.floor(y / CHUNK_SIZE) };
}

export function macroToMicro(x: number, y: number): MicroCoord {
  return { x: x * 2, y: y * 2 };
}

/** Deep-copies terrain, including corners and patchOnly. The clone shares no mutable references with the original. */
export function cloneCell(cell: MacroCell): MacroCell {
  const cloned: MacroCell = {
    zone: cell.zone,
    terrain: null,
  };
  if (cell.terrain) {
    cloned.terrain = { type: cell.terrain.type, elevation: cell.terrain.elevation };
    if (cell.terrain.corners) cloned.terrain.corners = [...cell.terrain.corners] as Corners;
    if (cell.terrain.patchOnly !== undefined) cloned.terrain.patchOnly = cell.terrain.patchOnly;
    if (cell.terrain.patchBase !== undefined) cloned.terrain.patchBase = cell.terrain.patchBase;
  }
  return cloned;
}

/**
 * A detached copy of a map: the same template, deep-copied cells and objects, and none of the
 * live bookkeeping.
 *
 * The provenance ledger is dropped rather than copied. An executor writes THROUGH that object
 * (`ProvenanceRecorder` adopts it and then owns it), so a copy that carried the reference would
 * record a throwaway map's edits in the real map's ledger. The version counters go for the same
 * reason: the memoized object index and map stats key off them, and a copy that started at the
 * original's numbers would be answered from the original's caches.
 */
export function cloneGridState(state: GridState): GridState {
  const objects = new Map<string, PlacedObject>();
  for (const [id, obj] of state.objects) {
    objects.set(id, {
      ...obj,
      position: { ...obj.position },
      ...(obj.corners ? { corners: [...obj.corners] as Corners } : {}),
    });
  }
  return {
    template: state.template,
    cells: state.cells.map((row) => row.map(cloneCell)),
    objects,
    lockedLayers: new Set(state.lockedLayers),
  };
}

/**
 * A grid whose cells at `cells` are private copies, sharing every other row and cell with `state` —
 * the map to ask a HYPOTHETICAL question of when the answer depends on the whole grid but the
 * hypothesis touches a handful of cells (the auto-trim ghost, the layer a refused water stroke
 * could stand at).
 *
 * The objects map and the version counters are the live ones: a caller here writes terrain through
 * `applyCommand` and reads rules, so nothing it does reaches them. Writing OUTSIDE `cells` would
 * edit the real map behind the executor's back, with no history and no redraw — clip a hypothesis
 * to the cells the scratch owns.
 */
export function scratchGrid(state: GridState, cells: readonly MacroCoord[]): GridState {
  const rows = new Map<number, MacroCell[]>();
  const scratch: GridState = { ...state, cells: state.cells.slice() };
  for (const { x, y } of cells) {
    const src = getCell(state.cells, x, y);
    if (!src) continue;
    let row = rows.get(y);
    if (!row) {
      row = scratch.cells[y]!.slice();
      scratch.cells[y] = row;
      rows.set(y, row);
    }
    row[x] = {
      ...src,
      terrain: src.terrain
        ? { ...src.terrain, corners: src.terrain.corners ? ([...src.terrain.corners] as Corners) : undefined }
        : null,
    };
  }
  return scratch;
}

export function chunkKey(cx: number, cy: number): string {
  return `${cx},${cy}`;
}

/** Mark a mutation of `state.objects` (add/remove/in-place edit). Consumers that
 *  memoize derived object data (state/object-index) key their freshness on this.
 *
 *  Pass `delta` whenever the caller knows which objects changed: the index then
 *  patches those entries instead of rebuilding from every object. Omitting it is
 *  safe (the index rebuilds), so a new mutation site is never wrong, only slower. */
export function bumpObjectsVersion(
  state: { objectsVersion?: number; objectsDelta?: ObjectsDelta },
  delta?: { removed?: readonly PlacedObject[]; added?: readonly PlacedObject[] },
): void {
  const version = (state.objectsVersion ?? 0) + 1;
  state.objectsVersion = version;
  state.objectsDelta = delta ? { version, removed: delta.removed, added: delta.added } : undefined;
}

/** Mark a mutation of `state.cells` — the sibling of bumpObjectsVersion, read by
 *  state/map-stats. Call once per command, never per cell: a stroke issues dozens
 *  of commands and a fill touches hundreds of cells. */
export function bumpCellsVersion(state: { cellsVersion?: number }): void {
  state.cellsVersion = (state.cellsVersion ?? 0) + 1;
}

/** The four orthogonal neighbour offsets — the one true copy. */
export const NEIGHBORS4: ReadonlyArray<readonly [number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]];
/** The eight neighbour offsets (orthogonal first, then diagonal) — the one true copy. */
export const NEIGHBORS8: ReadonlyArray<readonly [number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

/** Multi-source BFS distance (in cells) from `seeds` over a width×height grid. Deterministic.
 *  Shared by elevation (ridge crest falloff), hydrology (shores), and the placement analysis.
 *  `diag` picks the metric: false = Manhattan (4-neighbour; erosion by its diamond ball chamfers
 *  rectangle corners at 45°), true = Chebyshev (8-neighbour; erosion keeps rectangles rectangular
 *  — the generator's rectilinear style relies on this). */
const DIST_FAR = 30000;
export function distanceField(seeds: number[], width: number, height: number, diag = false): Int16Array {
  const dist = new Int16Array(width * height).fill(DIST_FAR);
  const frontier: number[] = [];
  for (const s of seeds) if (s >= 0 && s < dist.length && dist[s] === DIST_FAR) { dist[s] = 0; frontier.push(s); }
  relaxFrontier(dist, frontier, width, height, diag);
  return dist;
}

/** Incrementally add one source to an existing distanceField result IN PLACE: BFS from `seed`,
 *  relaxing only where it improves. Because a distance field satisfies the grid triangle
 *  inequality, propagation never needs to pass through a non-improved cell — `dist` ends exactly
 *  equal to a fresh multi-source BFS over the old seeds plus this one (same values, no realloc).
 *  Farthest-point sampling uses this to avoid a full-grid BFS per added site. */
export function relaxDistanceFrom(dist: Int16Array, seed: number, width: number, height: number): void {
  if (seed < 0 || seed >= dist.length || dist[seed]! <= 0) return;
  dist[seed] = 0;
  relaxFrontier(dist, [seed], width, height, false);
}

/** The BFS relaxation kernel shared by distanceField and relaxDistanceFrom: propagate
 *  dist+1 improvements outward from `frontier` until no cell improves. */
function relaxFrontier(dist: Int16Array, frontier: number[], width: number, height: number, diag: boolean): void {
  const neighbors = diag ? NEIGHBORS8 : NEIGHBORS4;
  while (frontier.length) {
    const next: number[] = [];
    for (const i of frontier) {
      const x = i % width, y = (i / width) | 0;
      for (const [dx, dy] of neighbors) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const j = flatIndex(nx, ny, width);
        if (dist[j]! > dist[i]! + 1) { dist[j] = (dist[i]! + 1) as number; next.push(j); }
      }
    }
    frontier = next;
  }
}

/** Flat (row-major) index of a cell — the canonical home for the `y*width+x` idiom. */
export const flatIndex = (x: number, y: number, width: number): number => y * width + x;
/** The canonical "x,y" cell key (mirrors chunkKey's style). */
export const cellKey = (x: number, y: number): string => `${x},${y}`;

export function getFootprint(x: number, y: number, w: number, h: number): MacroCoord[] {
  const coords: MacroCoord[] = [];
  for (let dy = 0; dy < h; dy++)
    for (let dx = 0; dx < w; dx++)
      coords.push({ x: x + dx, y: y + dy });
  return coords;
}

