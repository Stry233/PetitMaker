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
import type { ChunkCoord, Corners, GridState, MacroCell, MacroCoord, MicroCoord, MapTemplate, ObjectsDelta, PlacedObject, PlazaConfig, Rect, TerrainCell } from './types';
import { TILE_SIZE, PLAZA_ID } from './constants';
import { PLANET_PROFILE, CHUNK_SIZE } from './game-profile';

export const HALF_TILE = TILE_SIZE / 2;

/** Whether a zone can be built/placed/painted on. Grass is the only buildable zone
 *  today — this is the ONE place that fact lives, so adding a buildable zone is a
 *  single edit here rather than hunting every `=== CellZone.Grass` gate. */
export function isBuildableZone(zone: CellZone | undefined): boolean {
  return zone === CellZone.Grass;
}

/** Open sea, or a shore rim read from a zone alone, where the ground under it is unknown. A cell's
 *  own ground is `groundZone`. */
export function isSeaZone(zone: CellZone): boolean {
  return zone === CellZone.Void || zone === CellZone.Boundary;
}

/** Grass or sand: the land layer 0 edits turn to and from sea. */
export function isLandZone(zone: CellZone): boolean {
  return zone === CellZone.Grass || zone === CellZone.Beach;
}

/** Grass, the plaza's own cells included: the ground a building stands on and the shore rims. */
export function isGrassZone(zone: CellZone): boolean {
  return zone === CellZone.Grass || zone === CellZone.Plaza;
}

/** The ground a cell stands on: a shore rim cell's own sand or sea, any other cell's zone. Layer 0
 *  edits read this, so a rim cell behaves as the ground under it. */
export function groundZone(cell: MacroCell): CellZone {
  return cell.zone === CellZone.Boundary ? cell.under ?? CellZone.Void : cell.zone;
}

/** Whether `v` names a zone. */
export function isCellZone(v: unknown): v is CellZone {
  return typeof v === 'number' && CellZone[v] !== undefined;
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

/** `v` rounded to the nearest half cell. */
export function snapHalf(v: number): number {
  return Math.round(v * 2) / 2;
}

/** Whether point (x, y) lies in `r`; the far edges are exclusive. */
export function rectContains(r: Rect, x: number, y: number): boolean {
  return x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
}

/** The bounding box of `cells`, or null when there are none. */
export function cellsBounds(cells: readonly { x: number; y: number }[]): Rect | null {
  if (cells.length === 0) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const c of cells) {
    if (c.x < x0) x0 = c.x;
    if (c.y < y0) y0 = c.y;
    if (c.x > x1) x1 = c.x;
    if (c.y > y1) y1 = c.y;
  }
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** The bounding box of flat cell indices on a grid `W` cells wide; none answers a zero rect. */
export function indexBounds(cells: readonly number[], W: number): Rect {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const i of cells) {
    const x = i % W, y = (i / W) | 0;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  if (!Number.isFinite(x0)) return { x: 0, y: 0, w: 0, h: 0 };
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** AABB overlap of two macro rects. Touching edges (a.x + a.w === b.x) do NOT
 *  count as overlapping — matches the object-to-object "strict <" rule. */
export function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/** Whether a plaza config or object lays a footprint; a zero width or height, or none at all,
 *  stands for no plaza. */
export function hasLandmark<T extends { width?: number; height?: number }>(p: T | null | undefined): p is T & { width: number; height: number } {
  return !!p && (p.width ?? 0) > 0 && (p.height ?? 0) > 0;
}

/** The template landmark: the one object a map seeds from `template.plaza` (the central plaza). */
export function templateLandmark(state: Pick<GridState, 'objects'>): PlacedObject | undefined {
  return state.objects.get(PLAZA_ID);
}

/** Whether `catalogId` is the template landmark's item. */
export function isLandmarkItem(catalogId: string): boolean {
  return catalogId === PLAZA_ID;
}

/** Whether `id` names the template landmark object. */
export function isLandmarkId(id: string): boolean {
  return id === PLAZA_ID;
}

/** The landmark object `p` lays. Self-described (icon, size, colour), so the plaza renders through
 *  the normal object path with no special-case renderer. */
export function landmarkObject(p: PlazaConfig, locked: boolean): PlacedObject {
  return {
    id: PLAZA_ID, catalogId: PLAZA_ID,
    position: { x: p.x, y: p.y }, width: p.width, height: p.height,
    icon: PLANET_PROFILE.landmarkIcon, ...(p.color !== undefined ? { color: p.color } : {}),
    rotation: p.rotation ?? 0, elevation: p.elevation, locked,
  };
}

/** The immutable central-plaza object built from the map's plaza config (null if
 *  the map has none). Fractional position + per-map size; locked. Added to the
 *  grid's objects at init/load and excluded from serialization. */
export function createPlazaObject(template: MapTemplate): PlacedObject | null {
  const p = template.plaza;
  return hasLandmark(p) ? landmarkObject(p, true) : null;
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

/** Zero-aligned storage bucket for rendering and spatial indexing, independent of map reference regions. */
export function macroToChunk(x: number, y: number): ChunkCoord {
  return { cx: Math.floor(x / CHUNK_SIZE), cy: Math.floor(y / CHUNK_SIZE) };
}

export function macroToMicro(x: number, y: number): MicroCoord {
  return { x: x * 2, y: y * 2 };
}

/** Terrain cell containing a half-cell pointer sample; terrain spans [cell - 0.5, cell + 0.5). */
export function microToTerrain(x: number, y: number): MacroCoord {
  return { x: Math.floor((x + 1) / 2), y: Math.floor((y + 1) / 2) };
}

/** Deep-copies the cell: zone, the ground under a rim, and terrain including corners and patchOnly. The clone shares no mutable references with the original. */
export function cloneCell(cell: MacroCell): MacroCell {
  const cloned: MacroCell = {
    zone: cell.zone,
    terrain: null,
  };
  if (cell.under !== undefined) cloned.under = cell.under;
  if (cell.terrain) {
    cloned.terrain = { type: cell.terrain.type, elevation: cell.terrain.elevation };
    if (cell.terrain.corners) cloned.terrain.corners = [...cell.terrain.corners] as Corners;
    if (cell.terrain.patchOnly !== undefined) cloned.terrain.patchOnly = cell.terrain.patchOnly;
    if (cell.terrain.patchBase !== undefined) cloned.terrain.patchBase = cell.terrain.patchBase;
  }
  return cloned;
}

/** A copy of a placed object sharing no mutable part with it: corner edits and rotations write objects in place. */
export function clonePlacedObject(obj: PlacedObject): PlacedObject {
  return {
    ...obj,
    position: { ...obj.position },
    ...(obj.corners ? { corners: [...obj.corners] as Corners } : {}),
  };
}

/** Detached editing copy with independent cells, objects and attribution. Mutable provenance and cache versions belong to the original executor and are omitted. */
export function cloneGridState(state: GridState): GridState {
  const objects = new Map<string, PlacedObject>();
  for (const [id, obj] of state.objects) objects.set(id, clonePlacedObject(obj));
  return {
    template: state.template,
    cells: state.cells.map((row) => row.map(cloneCell)),
    objects,
    lockedLayers: new Set(state.lockedLayers),
    ignoreChunkLoad: state.ignoreChunkLoad,
    ...(state.imageAttribution ? { imageAttribution: { ...state.imageAttribution, notes: { ...state.imageAttribution.notes }, units: [...state.imageAttribution.units] } } : {}),
  };
}

/** Copies only the requested cells for hypothetical validation. Objects and untouched cells remain shared and must not be mutated. */
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

/** Cache identity for content, layer locks and placement policy. */
export function mapVersionKey(state: Pick<GridState, 'cellsVersion' | 'objectsVersion' | 'lockedLayers' | 'ignoreChunkLoad'>): string {
  return `${state.cellsVersion ?? 0}|${state.objectsVersion ?? 0}|${[...state.lockedLayers].sort().join(',')}|${state.ignoreChunkLoad ? 1 : 0}`;
}

/** Mark a mutation of `state.cells` — the sibling of bumpObjectsVersion, read by
 *  state/map-stats. Call once per command, never per cell: a stroke issues dozens
 *  of commands and a fill touches hundreds of cells. */
export function bumpCellsVersion(state: { cellsVersion?: number }): void {
  state.cellsVersion = (state.cellsVersion ?? 0) + 1;
}

/** The four orthogonal neighbour offsets — the one true copy. */
export const NEIGHBORS4: ReadonlyArray<readonly [number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]];
/** The four edge neighbours clockwise from north. */
export const NEIGHBORS4_NESW: ReadonlyArray<readonly [number, number]> = [[0, -1], [1, 0], [0, 1], [-1, 0]];
/** The four edge neighbours clockwise from east. */
export const NEIGHBORS4_ESWN: ReadonlyArray<readonly [number, number]> = [[1, 0], [0, 1], [-1, 0], [0, -1]];
/** The eight neighbour offsets (orthogonal first, then diagonal) — the one true copy. */
export const NEIGHBORS8: ReadonlyArray<readonly [number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

/** A cell's four edges as compass sides; y grows south. */
export const SIDES = ['N', 'E', 'S', 'W'] as const;
export type Side = typeof SIDES[number];
/** The unit step to the cell across each side. */
export const SIDE_DELTA: Readonly<Record<Side, readonly [number, number]>> = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] };
export const OPPOSITE_SIDE: Readonly<Record<Side, Side>> = { N: 'S', E: 'W', S: 'N', W: 'E' };

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

/** The BFS relaxation kernel of distanceField: propagate
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
