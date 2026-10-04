import { EventBus } from './event-bus';
import { bumpCellsVersion, bumpObjectsVersion, cloneCell, clonePlacedObject, createDefaultTerrainCell, getCell, setCell } from '../model/grid-model';
import {
  CommandType,
  TerrainType,
  type CellSnapshot,
  type Command,
  type Corners,
  type EditorEvents,
  type GridState,
  type MacroCoord,
  type PlacedObject,
} from '../model/types';
import type { TaintDelta } from '../provenance/tracker';
import { isSquareCorners, isEmptyCorners } from '../edge-cut/corner-index';

/**
 * The per-CommandType STATE MUTATION half of the executor: how a command (and a
 * history entry's inverse) writes cells and adds/removes/mutates objects. Free
 * functions taking explicit state + eventBus, so the executor stays an
 * orchestrator (validate → apply → record → history → events).
 *
 * Invariants held here (NOT the executor's concern):
 * - `objects-changed` is emitted at the mutation site.
 * - History bookkeeping (undo/redo stacks, `cells-changed`/`history-*` events)
 *   and provenance taint threading stay in the executor and wrap these calls.
 */
export interface HistoryEntry {
  cmd: Command;
  before: CellSnapshot[];
  after: CellSnapshot[];
  /**
   * The object add/removes revert and reapply replay instead of the per-command switch. Set on
   * collapsed (grouped) entries, as the net across the group, so undo/redo of a batch (Clear,
   * Generate) restores every object rather than only the representative `cmd`; and on a single
   * command whose own fields cannot reverse its object effect (`unrecoverableObjectOps`: a road
   * trimmed to all-empty, which the command names only by id). Absent otherwise.
   */
  objectOps?: { removed: PlacedObject[]; added: PlacedObject[] };
  taint?: TaintDelta;   // provenance delta for this entry; restored in lockstep with cells
}

export function getAffectedCells(cmd: Command): MacroCoord[] {
  switch (cmd.type) {
    case CommandType.PaintTerrain:
    case CommandType.EraseTerrain:
      return cmd.cells;
    case CommandType.PlaceObject:
      return [cmd.object.position];
    case CommandType.RemoveObject:
      return [cmd.removedObject.position];
    case CommandType.TrimCorners:
      return [{ x: cmd.x, y: cmd.y }];
    default:
      return [];
  }
}

/** A copy of `cmd` sharing nothing mutable with the map it ran on. A placement command carries the
 *  object itself and a corner edit carries arrays assigned straight into a cell or road, and later
 *  edits write those in place, so a history entry or a replay holding the command as it stands
 *  would change with the map. */
export function detachCommand(cmd: Command): Command {
  switch (cmd.type) {
    case CommandType.PlaceObject:
      return { ...cmd, object: clonePlacedObject(cmd.object) };
    case CommandType.RemoveObject:
      return { ...cmd, removedObject: clonePlacedObject(cmd.removedObject) };
    case CommandType.TrimCorners:
      return {
        ...cmd,
        ...(cmd.beforeCorners ? { beforeCorners: [...cmd.beforeCorners] as Corners } : {}),
        afterCorners: [...cmd.afterCorners] as Corners,
      };
    default:
      return cmd;
  }
}

const copyCorners = (corners: Corners | undefined): Corners | undefined => (corners ? [...corners] as Corners : undefined);

/**
 * Object effects a command's own fields cannot reverse, as history `objectOps`. A road corner trim
 * to all-empty deletes the road, and the command carries only its id, so the entry keeps a copy of
 * the road as it stood. Read before `applyCommand`.
 */
export function unrecoverableObjectOps(cmd: Command, state: GridState): HistoryEntry['objectOps'] {
  if (cmd.type !== CommandType.TrimCorners || cmd.layer !== 'road' || !cmd.objectId) return undefined;
  if (!isEmptyCorners(cmd.afterCorners)) return undefined;
  const road = state.objects.get(cmd.objectId);
  if (!road) return undefined;
  return { removed: [clonePlacedObject(road)], added: [] };
}

export function applyCommand(cmd: Command, state: GridState, eventBus: EventBus<EditorEvents>): void {
  switch (cmd.type) {
    case CommandType.PaintTerrain: {
      for (const coord of cmd.cells) {
        const cell = getCell(state.cells, coord.x, coord.y);
        if (cell) {
          if (cmd.ground !== undefined) { cell.zone = cmd.ground; delete cell.under; }
          if (cmd.terrainType === TerrainType.Mountain && cmd.elevation === 0) {
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
      state.objects.set(cmd.object.id, cmd.object);
      bumpObjectsVersion(state, { added: [cmd.object] });
      eventBus.emit('objects-changed', { added: [cmd.object] });
      break;
    }
    case CommandType.RemoveObject: {
      const gone = state.objects.get(cmd.objectId);
      state.objects.delete(cmd.objectId);
      bumpObjectsVersion(state, gone ? { removed: [gone] } : undefined);
      eventBus.emit('objects-changed', { removed: [cmd.objectId] });
      break;
    }
    case CommandType.TrimCorners: {
      const isAllSquare = isSquareCorners(cmd.afterCorners);
      const isAllEmpty = isEmptyCorners(cmd.afterCorners);
      const normalized = isAllSquare ? undefined : cmd.afterCorners;
      if (cmd.layer === 'terrain') {
        const cell = getCell(state.cells, cmd.x, cmd.y);
        if (cell && isAllEmpty) {
          cell.terrain = null; // cycled fully off → cleared (the gamma's real base, if any, is restored by the tool via PaintTerrain)
        } else if (cell && cmd.patchOnly && cmd.terrainType !== undefined && cmd.elevation !== undefined) {
          // MATERIALISE a cosmetic Γ patch: the fillet renders at `elevation`, but its real support is
          // `patchBase` (0 = a from-empty gamma, no base column painted; N-1 = it rounds a real block).
          // Replaces whatever was here (empty, or the real lower block this fillet rounds) — an edge cut sets
          // only corners + this cosmetic overlay; structuralTop comes from patchBase, never invented.
          cell.terrain = { type: cmd.terrainType, elevation: cmd.elevation, patchOnly: true, corners: cmd.afterCorners, ...(cmd.patchBase !== undefined ? { patchBase: cmd.patchBase } : {}) };
        } else if (cell?.terrain) {
          if (isAllSquare && cell.terrain.type === TerrainType.None) {
            cell.terrain = null; // a GROUND islet cut cycled back to square → plain ground again
          } else {
            cell.terrain.corners = normalized;
            if (cmd.patchOnly !== undefined) cell.terrain.patchOnly = cmd.patchOnly;
            if (cmd.patchBase !== undefined) cell.terrain.patchBase = cmd.patchBase;
          }
        } else if (cell && !isAllSquare && !isAllEmpty) {
          // a GROUND cell gains an islet cut → materialise a `type: None` cell to carry the corners; it
          // reads as ground (realSurface null) but renders grass rounded + the water it sits in behind.
          cell.terrain = { type: TerrainType.None, elevation: 0, corners: cmd.afterCorners };
        }
        if (cell) bumpCellsVersion(state);
        // cells-changed is emitted by execute() after applyCommand returns; no duplicate emit needed here.
      } else if (cmd.layer === 'road' && cmd.objectId) {
        const obj = state.objects.get(cmd.objectId);
        if (isAllEmpty) {
          state.objects.delete(cmd.objectId);
          bumpObjectsVersion(state, obj ? { removed: [obj] } : undefined);
          eventBus.emit('objects-changed', { removed: [cmd.objectId] });
        } else if (obj) {
          obj.corners = normalized;
          if (cmd.patchOnly !== undefined) obj.patchOnly = cmd.patchOnly;
          if (cmd.afterRotation !== undefined) obj.rotation = cmd.afterRotation;
          // Edited in place: re-index it so the entry's rect/coating match the new rotation.
          bumpObjectsVersion(state, { added: [obj] });
          eventBus.emit('objects-changed', { removed: [cmd.objectId] });
          eventBus.emit('objects-changed', { added: [obj] });
        }
      }
      break;
    }
    default:
      break;
  }
}

/**
 * Reverts a single history entry's STATE: restores its `before` cell snapshots and undoes the
 * command's object-layer effect (Place→delete, Remove→re-add, road TrimCorners→restore
 * corners+rotation). Returns the affected cell coords. The caller (executor) owns taint
 * threading and history bookkeeping around this.
 */
export function revertEntryState(entry: HistoryEntry, state: GridState, eventBus: EventBus<EditorEvents>): MacroCoord[] {
  const coords: MacroCoord[] = [];
  for (const snap of entry.before) {
    setCell(state.cells, snap.coord.x, snap.coord.y, cloneCell(snap.cell));
    coords.push(snap.coord);
  }
  if (coords.length) bumpCellsVersion(state);
  // Recorded object ops (a collapsed group's net, or an effect the command cannot reverse):
  // replay them in reverse. Delete
  // the added set BEFORE restoring the removed set so an in-place modify (same
  // id in both, e.g. rotate) lands on the original instead of being wiped.
  // The map receives copies: history keeps its own objects, which later in-place edits must not reach.
  if (entry.objectOps) {
    const restored = entry.objectOps.removed.map(clonePlacedObject);
    for (const o of entry.objectOps.added) state.objects.delete(o.id);
    for (const o of restored) state.objects.set(o.id, o);
    bumpObjectsVersion(state, { removed: entry.objectOps.added, added: restored });
    if (entry.objectOps.added.length) eventBus.emit('objects-changed', { removed: entry.objectOps.added.map(o => o.id) });
    if (restored.length) eventBus.emit('objects-changed', { added: restored });
    return coords;
  }
  const cmd = entry.cmd;
  switch (cmd.type) {
    case CommandType.PlaceObject:
      state.objects.delete(cmd.object.id);
      bumpObjectsVersion(state, { removed: [cmd.object] });
      eventBus.emit('objects-changed', { removed: [cmd.object.id] });
      break;
    case CommandType.RemoveObject: {
      const restored = clonePlacedObject(cmd.removedObject);
      state.objects.set(restored.id, restored);
      bumpObjectsVersion(state, { added: [restored] });
      eventBus.emit('objects-changed', { added: [restored] });
      break;
    }
    case CommandType.TrimCorners:
      if (cmd.layer === 'road' && cmd.objectId) {
        const obj = state.objects.get(cmd.objectId);
        if (obj) {
          obj.corners = copyCorners(cmd.beforeCorners);
          if (cmd.beforeRotation !== undefined) obj.rotation = cmd.beforeRotation;
          bumpObjectsVersion(state, { added: [obj] });
          eventBus.emit('objects-changed', { removed: [cmd.objectId] });
          eventBus.emit('objects-changed', { added: [obj] });
        }
      }
      break;
    default:
      break;
  }
  return coords;
}

/**
 * Re-applies a single history entry's STATE: restores its `after` cell snapshots and re-applies the
 * command's object-layer effect. Inverse of revertEntryState. Taint + history bookkeeping stay
 * with the caller.
 */
export function reapplyEntryState(entry: HistoryEntry, state: GridState, eventBus: EventBus<EditorEvents>): MacroCoord[] {
  const coords: MacroCoord[] = [];
  for (const snap of entry.after) {
    setCell(state.cells, snap.coord.x, snap.coord.y, cloneCell(snap.cell));
    coords.push(snap.coord);
  }
  if (coords.length) bumpCellsVersion(state);
  // Recorded object ops (a collapsed group's net, or an effect the command cannot reverse):
  // replay them forward.
  if (entry.objectOps) {
    const placed = entry.objectOps.added.map(clonePlacedObject);
    for (const o of entry.objectOps.removed) state.objects.delete(o.id);
    for (const o of placed) state.objects.set(o.id, o);
    bumpObjectsVersion(state, { removed: entry.objectOps.removed, added: placed });
    if (entry.objectOps.removed.length) eventBus.emit('objects-changed', { removed: entry.objectOps.removed.map(o => o.id) });
    if (placed.length) eventBus.emit('objects-changed', { added: placed });
    return coords;
  }
  const cmd = entry.cmd;
  switch (cmd.type) {
    case CommandType.PlaceObject: {
      const placed = clonePlacedObject(cmd.object);
      state.objects.set(placed.id, placed);
      bumpObjectsVersion(state, { added: [placed] });
      eventBus.emit('objects-changed', { added: [placed] });
      break;
    }
    case CommandType.RemoveObject:
      state.objects.delete(cmd.objectId);
      bumpObjectsVersion(state, { removed: [cmd.removedObject] });
      eventBus.emit('objects-changed', { removed: [cmd.objectId] });
      break;
    case CommandType.TrimCorners:
      if (cmd.layer === 'road' && cmd.objectId) {
        const obj = state.objects.get(cmd.objectId);
        if (obj) {
          obj.corners = isSquareCorners(cmd.afterCorners) ? undefined : copyCorners(cmd.afterCorners);
          if (cmd.afterRotation !== undefined) obj.rotation = cmd.afterRotation;
          bumpObjectsVersion(state, { added: [obj] });
          eventBus.emit('objects-changed', { removed: [cmd.objectId] });
          eventBus.emit('objects-changed', { added: [obj] });
        }
      }
      break;
    default:
      break;
  }
  return coords;
}
