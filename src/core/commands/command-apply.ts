import type { KernelEvents } from './events';
import { EventBus } from './event-bus';
import { bumpCellsVersion, bumpObjectsVersion, clearsTerrain, cloneCell, clonePlacedObject, commandGrid, createDefaultTerrainCell, getCell, setCell } from '../model/grid-model';
import { cellSet, type CellSet } from '../grid/grids';
import {
  CommandType,
  type CellSnapshot,
  type Command,
  type GenerationMark,
  type GridState,
  type MacroCoord,
  type PlacedObject,
  type TrimCornersCommand,
} from '../model/types';
import type { TaintDelta } from '../provenance/tracker';
import { PLACEMENT_GRID, TERRAIN_GRID } from '../game/profile';

/**
 * The per-CommandType state mutation half of the executor: how a command (and a
 * history entry's inverse) writes cells and adds/removes/mutates objects. Free
 * functions taking explicit state + eventBus, so the executor stays an
 * orchestrator (validate → apply → record → history → events).
 *
 * Invariants held here (not the executor's concern):
 * - The map shares nothing mutable with a command: it stores copies of a placed object and of
 *   corner arrays, so a command in history or in a replay never changes with the map.
 * - `objects-changed` is emitted at the mutation site.
 * - History bookkeeping (undo/redo stacks, `cells-changed`/`history-*` events)
 *   and provenance taint threading stay in the executor and wrap these calls.
 */
/** The objects one history step took off the map and put on it, each as it stood. An object
 *  edited in place is in both, under one id. */
export interface ObjectOps { removed: PlacedObject[]; added: PlacedObject[] }

export interface HistoryEntry {
  cmd: Command;
  before: CellSnapshot[];
  after: CellSnapshot[];
  /** The step's object effect, which undo and redo replay: set on every entry whose command touched
   *  an object, and on a collapsed group as the net across it. Absent when the step touched none. */
  objectOps?: ObjectOps;
  taint?: TaintDelta;   // provenance delta for this entry; restored in lockstep with cells
  /** The map's generation around this step, when the step changed it. Session-only: saved
   *  histories leave it out. */
  generation?: { before: GenerationMark; after: GenerationMark };
}

export function readGenerationMark(state: GridState): GenerationMark {
  return {
    ...(state.generation ? { record: state.generation } : {}),
    ...(state.generationScope ? { scope: state.generationScope } : {}),
  };
}

export function writeGenerationMark(state: GridState, mark: GenerationMark): void {
  if (mark.record) state.generation = mark.record;
  else delete state.generation;
  if (mark.scope) state.generationScope = mark.scope;
  else delete state.generationScope;
}

/** The cells `cmd` names, on the grid it names them on (`commandGrid`), read before it applies: an
 *  object edit names its anchor and touches no terrain cell. */
export function getAffectedCells(cmd: Command, state: GridState): CellSet[] {
  return [cellSet(commandGrid(cmd), commandCells(cmd, (id) => state.objects.get(id)))];
}

/** The cells a history entry changed, read from its pre-images: its terrain snapshots and the anchor
 *  of each object it put on or took off the map. A collapsed group keeps only its last command, so
 *  the command alone would under-report it. */
export function entryCells(entry: HistoryEntry): CellSet[] {
  const sets: CellSet[] = [];
  if (entry.before.length > 0) sets.push(cellSet(TERRAIN_GRID, entry.before.map((s) => s.coord)));
  if (entry.objectOps) {
    const added = new Set(entry.objectOps.added.map((o) => o.id));
    const anchors = [...entry.objectOps.added, ...entry.objectOps.removed.filter((o) => !added.has(o.id))].map((o) => o.position);
    if (anchors.length > 0) sets.push(cellSet(PLACEMENT_GRID, anchors));
  }
  return sets;
}

function commandCells(cmd: Command, removed: (id: string) => PlacedObject | undefined): MacroCoord[] {
  switch (cmd.type) {
    case CommandType.PaintTerrain:
    case CommandType.EraseTerrain:
      return cmd.cells;
    case CommandType.PlaceObject:
      return [cmd.object.position];
    case CommandType.RemoveObject: {
      const gone = removed(cmd.objectId);
      return gone ? [gone.position] : [];
    }
    case CommandType.TrimCorners:
      return [{ x: cmd.x, y: cmd.y }];
    default:
      return [];
  }
}

/** The id of the object `cmd` places, removes or edits, whose history entry records it before and
 *  after as `objectOps`. */
export function touchedObjectId(cmd: Command): string | undefined {
  switch (cmd.type) {
    case CommandType.PlaceObject: return cmd.object.id;
    case CommandType.RemoveObject: return cmd.objectId;
    case CommandType.TrimCorners: return cmd.objectId;
    default: return undefined;
  }
}

/** One `objects-changed` for a set of removals and additions, or none when both are empty. */
function emitObjectsChanged(eventBus: EventBus<KernelEvents>, removed: string[], added: PlacedObject[]): void {
  if (removed.length === 0 && added.length === 0) return;
  eventBus.emit('objects-changed', { ...(removed.length ? { removed } : {}), ...(added.length ? { added } : {}) });
}

/**
 * How a corner trim lands on the map. The kernel stores corners and patch fields but leaves what a
 * trim does with them (which cut clears a cell, what a patch replaces, when a road is deleted) to
 * the game's terrain domain (`domain/edge-cut/trim-apply.ts:applyTrim`). It writes `state`, bumps
 * the versions it changes and reports an object change through `objectsChanged`.
 */
export type TrimApplier = (
  cmd: TrimCornersCommand, state: GridState, objectsChanged: (change: KernelEvents['objects-changed']) => void,
) => void;

/** Applies `cmd` to `state`; `trims` lands a corner trim, and `cause` tags the events it emits. */
export function applyCommand(cmd: Command, state: GridState, eventBus: EventBus<KernelEvents>, trims: TrimApplier, cause?: string): void {
  const objectsChanged = (change: KernelEvents['objects-changed']): void =>
    eventBus.emit('objects-changed', cause === undefined ? change : { ...change, cause });
  switch (cmd.type) {
    case CommandType.PaintTerrain: {
      for (const coord of cmd.cells) {
        const cell = getCell(state.cells, coord.x, coord.y);
        if (cell) {
          if (cmd.ground !== undefined) { cell.zone = cmd.ground; delete cell.under; }
          if (clearsTerrain(cmd)) {
            cell.terrain = null;
          } else {
            cell.terrain = createDefaultTerrainCell(cmd.terrainType, cmd.elevation);
          }
        }
      }
      if (cmd.cells.length) bumpCellsVersion(state);
      break;
    }
    case CommandType.EraseTerrain: {
      for (const coord of cmd.cells) {
        const cell = getCell(state.cells, coord.x, coord.y);
        if (!cell) continue;
        if (cmd.ground !== undefined) { cell.zone = cmd.ground; delete cell.under; }
        cell.terrain = null;
      }
      if (cmd.cells.length) bumpCellsVersion(state);
      break;
    }
    case CommandType.PlaceObject: {
      const placed = clonePlacedObject(cmd.object);
      state.objects.set(placed.id, placed);
      bumpObjectsVersion(state, { added: [placed] });
      objectsChanged({ added: [placed] });
      break;
    }
    case CommandType.RemoveObject: {
      const gone = state.objects.get(cmd.objectId);
      state.objects.delete(cmd.objectId);
      bumpObjectsVersion(state, gone ? { removed: [gone] } : undefined);
      objectsChanged({ removed: [cmd.objectId] });
      break;
    }
    case CommandType.TrimCorners:
      trims(cmd, state, objectsChanged);
      break;
    default:
      break;
  }
}

/** Replays `ops` onto the map: deletes `take` before restoring `put`, so an object in both (edited
 *  in place) lands as `put` holds it. The map receives copies: history keeps its own objects, which
 *  later in-place edits must not reach. */
function replayObjects(take: PlacedObject[], put: PlacedObject[], state: GridState, eventBus: EventBus<KernelEvents>): void {
  const placed = put.map(clonePlacedObject);
  for (const o of take) state.objects.delete(o.id);
  for (const o of placed) state.objects.set(o.id, o);
  bumpObjectsVersion(state, { removed: take, added: placed });
  emitObjectsChanged(eventBus, take.map((o) => o.id), placed);
}

/**
 * Reverts a single history entry's state: restores its `before` cell snapshots and replays its
 * `objectOps` backwards. Returns the affected cell coords. The caller (executor) owns taint
 * threading and history bookkeeping around this.
 */
export function revertEntryState(entry: HistoryEntry, state: GridState, eventBus: EventBus<KernelEvents>): MacroCoord[] {
  if (entry.generation) writeGenerationMark(state, entry.generation.before);
  const coords: MacroCoord[] = [];
  for (const snap of entry.before) {
    setCell(state.cells, snap.coord.x, snap.coord.y, cloneCell(snap.cell));
    coords.push(snap.coord);
  }
  if (coords.length) bumpCellsVersion(state);
  if (entry.objectOps) replayObjects(entry.objectOps.added, entry.objectOps.removed, state, eventBus);
  return coords;
}

/** Re-applies a single history entry's state: restores its `after` cell snapshots and replays its
 *  `objectOps` forwards. Inverse of revertEntryState. */
export function reapplyEntryState(entry: HistoryEntry, state: GridState, eventBus: EventBus<KernelEvents>): MacroCoord[] {
  if (entry.generation) writeGenerationMark(state, entry.generation.after);
  const coords: MacroCoord[] = [];
  for (const snap of entry.after) {
    setCell(state.cells, snap.coord.x, snap.coord.y, cloneCell(snap.cell));
    coords.push(snap.coord);
  }
  if (coords.length) bumpCellsVersion(state);
  if (entry.objectOps) replayObjects(entry.objectOps.removed, entry.objectOps.added, state, eventBus);
  return coords;
}
