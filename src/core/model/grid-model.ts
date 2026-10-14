/**
 * Grid data structure and spatial utilities.
 *
 * Coordinate system: (x, y) where x is column, y is row.
 * cells[y][x] — row-major storage. Out-of-bounds access returns null.
 *
 * The grid is mutable — `setCell` and terrain assignment modify in place.
 * Immutable snapshots are produced via `cloneCell` for undo/redo.
 */

import { CommandType, TerrainType, type Command } from './types';
import { copyCorners, sameCorners } from './corners';
import { OFF_MAP_ZONE, type CellZone } from '../game/zones';
import type { GridState, MacroCell, MacroCoord, MapTemplate, ObjectsDelta, PlacedObject, TerrainCell } from './types';
import { TERRAIN_GRID, PLACEMENT_GRID } from '../game/profile';
import type { GridId } from '../grid/grids';

export function createDefaultTerrainCell(type: TerrainType, elevation: number): TerrainCell {
  return { type, elevation };
}

/** The zone a fresh grid built from `template` gives cell (x, y); open sea off the template. */
export function templateCellZone(template: Pick<MapTemplate, 'zones'>, x: number, y: number): CellZone {
  return template.zones[y]?.[x] ?? OFF_MAP_ZONE;
}

/** Initializes a grid from a template: all cells start with null terrain. The landmarks are
 *  immutable PlacedObjects over plain cells (see templateLandmarkObjects), not terrain. */
export function createGrid(template: MapTemplate): MacroCell[][] {
  const { width, height } = template;
  const cells: MacroCell[][] = [];
  for (let y = 0; y < height; y++) {
    const row: MacroCell[] = [];
    for (let x = 0; x < width; x++) {
      row.push({ zone: templateCellZone(template, x, y), terrain: null });
    }
    cells.push(row);
  }
  return cells;
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

/** A copy of a terrain cell sharing no mutable part with it; an absent field stays absent. */
export function cloneTerrain(t: TerrainCell): TerrainCell {
  const cloned: TerrainCell = { type: t.type, elevation: t.elevation };
  if (t.corners) cloned.corners = copyCorners(t.corners);
  if (t.patchOnly !== undefined) cloned.patchOnly = t.patchOnly;
  if (t.patchBase !== undefined) cloned.patchBase = t.patchBase;
  return cloned;
}

/**
 * Whether two terrain cells hold the same content: type, elevation, patch flag and base, and corners
 * (a cell with no corners matches only another with none). `patchOnly: 'exact'` tells an absent patch
 * flag from `false`, as a recorded snapshot does; `'flag'` reads it as a boolean, as a restore does.
 * Two empty cells are the same only when both are null or both undefined.
 */
export function sameTerrain(
  a: TerrainCell | null | undefined, b: TerrainCell | null | undefined, opts: { patchOnly: 'exact' | 'flag' },
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.type !== b.type || a.elevation !== b.elevation || a.patchBase !== b.patchBase) return false;
  if (opts.patchOnly === 'exact' ? a.patchOnly !== b.patchOnly : !!a.patchOnly !== !!b.patchOnly) return false;
  const ca = a.corners, cb = b.corners;
  if (!ca || !cb) return ca === cb;
  return sameCorners(ca, cb);
}

/** Deep-copies the cell: zone, the ground under a rim, and terrain. The clone shares no mutable references with the original. */
export function cloneCell(cell: MacroCell): MacroCell {
  const cloned: MacroCell = { zone: cell.zone, terrain: cell.terrain ? cloneTerrain(cell.terrain) : null };
  if (cell.under !== undefined) cloned.under = cell.under;
  return cloned;
}

/** A copy of a placed object sharing no mutable part with it: corner edits and rotations write objects in place. */
export function clonePlacedObject(obj: PlacedObject): PlacedObject {
  return {
    ...obj,
    position: { ...obj.position },
    ...(obj.corners ? { corners: copyCorners(obj.corners) } : {}),
  };
}

/** Detached editing copy with independent cells, objects and attribution. It leaves out provenance,
 *  the annotations, notes and generation record, and starts its cache versions at 0: the
 *  original's belong to the original's executor. */
export function cloneGridState(state: GridState): GridState {
  const objects = new Map<string, PlacedObject>();
  for (const [id, obj] of state.objects) objects.set(id, clonePlacedObject(obj));
  return {
    template: state.template,
    cells: state.cells.map((row) => row.map(cloneCell)),
    objects,
    objectsVersion: 0,
    cellsVersion: 0,
    lockedLayers: new Set(state.lockedLayers),
    ignoreChunkLoad: state.ignoreChunkLoad,
    ...(state.imageAttribution ? {
      imageAttribution: { ...state.imageAttribution, notes: { ...state.imageAttribution.notes }, units: [...state.imageAttribution.units] },
    } : {}),
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
    row[x] = cloneCell(src);
  }
  return scratch;
}

/** Mark a mutation of `state.objects` (add/remove/in-place edit). Consumers that
 *  memoize derived object data (state/object-index) key their freshness on this.
 *
 *  Pass `delta` whenever the caller knows which objects changed: the index then
 *  patches those entries instead of rebuilding from every object. Omitting it is
 *  safe (the index rebuilds), so a new mutation site is never wrong, only slower. */
export function bumpObjectsVersion(
  state: { objectsVersion: number; objectsDelta?: ObjectsDelta },
  delta?: { removed?: readonly PlacedObject[]; added?: readonly PlacedObject[] },
): void {
  const version = state.objectsVersion + 1;
  state.objectsVersion = version;
  state.objectsDelta = delta ? { version, removed: delta.removed, added: delta.added } : undefined;
}

/** Cache identity for content, layer locks and placement policy. */
export function mapVersionKey(state: Pick<GridState, 'cellsVersion' | 'objectsVersion' | 'lockedLayers' | 'ignoreChunkLoad'>): string {
  return `${state.cellsVersion}|${state.objectsVersion}|${[...state.lockedLayers].sort().join(',')}|${state.ignoreChunkLoad ? 1 : 0}`;
}

/** Mark a mutation of `state.cells` — the sibling of bumpObjectsVersion, read by
 *  state/map-stats. Call once per command, never per cell: a stroke issues dozens
 *  of commands and a fill touches hundreds of cells. */
export function bumpCellsVersion(state: { cellsVersion: number }): void {
  state.cellsVersion = state.cellsVersion + 1;
}

/** The elevation a mountain paint clears its cells at, back to bare ground. */
export const CLEARING_ELEVATION = 0;

/** Whether `cmd` leaves its cells without terrain: an erase, or a mountain paint at
 *  `CLEARING_ELEVATION`. */
export function clearsTerrain(cmd: Command): boolean {
  return cmd.type === CommandType.EraseTerrain
    || (cmd.type === CommandType.PaintTerrain && cmd.terrainType === TerrainType.Mountain && cmd.elevation === CLEARING_ELEVATION);
}

/** The grid a command's cells lie on: terrain paints, erases and terrain corner cuts name terrain
 *  cells, every other command placement cells. */
export function commandGrid(cmd: Command): GridId {
  switch (cmd.type) {
    case CommandType.PaintTerrain:
    case CommandType.EraseTerrain:
      return TERRAIN_GRID;
    case CommandType.TrimCorners:
      return cmd.layer === 'terrain' ? TERRAIN_GRID : PLACEMENT_GRID;
    default:
      return PLACEMENT_GRID;
  }
}
