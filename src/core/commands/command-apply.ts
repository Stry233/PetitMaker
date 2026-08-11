import { EventBus } from './event-bus';
import { bumpCellsVersion, bumpObjectsVersion, cloneCell, createDefaultTerrainCell, getCell, setCell } from '../model/grid-model';
import {
  CommandType,
  TerrainType,
  type CellSnapshot,
  type Command,
  type EditorEvents,
  type GridState,
  type MacroCoord,
  type PlacedObject,
} from '../model/types';
import type { TaintDelta } from '../provenance/tracker';

/**
 * The per-CommandType STATE MUTATION half of the executor: how a command (and a
 * history entry's inverse) writes cells and adds/removes/mutates objects. Pure
 * code motion out of CommandExecutor — free functions taking explicit state +
 * eventBus so the executor stays an orchestrator (validate → apply → record →
 * history → events).
 *
 * Invariants held here (NOT the executor's concern):
 * - `objects-changed` emissions live at the mutation site, exactly as before.
 * - History bookkeeping (undo/redo stacks, `cells-changed`/`history-*` events)
 *   and provenance taint threading stay in the executor and wrap these calls.
 */
export interface HistoryEntry {
  cmd: Command;
  before: CellSnapshot[];
  after: CellSnapshot[];
  /**
   * Set only on COLLAPSED (grouped) entries: the net object add/removes across
   * the whole group, so undo/redo of a batch (e.g. Clear / Generate that wipes
   * tiles + placements) restores every object — not just the single
   * representative `cmd`. Absent on ordinary single-command entries (which use
   * the per-command switch in revert/reapply).
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

export function applyCommand(cmd: Command, state: GridState, eventBus: EventBus<EditorEvents>): void {
  switch (cmd.type) {
    case CommandType.PaintTerrain: {
      for (const coord of cmd.cells) {
        const cell = getCell(state.cells, coord.x, coord.y);
        if (cell) {
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
        if (cell) cell.terrain = null;
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
      const isAllSquare = cmd.afterCorners.every(c => c === 'square');
      const isAllEmpty = cmd.afterCorners.every(c => c === 'empty');
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
            cell.terrain = null; // a GROUND island-cut cycled back to square → plain ground again
          } else {
            cell.terrain.corners = normalized;
            if (cmd.patchOnly !== undefined) cell.terrain.patchOnly = cmd.patchOnly;
            if (cmd.patchBase !== undefined) cell.terrain.patchBase = cmd.patchBase;
          }
        } else if (cell && !isAllSquare && !isAllEmpty) {
          // a GROUND cell gains an island-cut → materialise a `type: None` cell to carry the corners; it
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
  // Collapsed (grouped) entry: replay the net object ops in reverse. Delete
  // the added set BEFORE restoring the removed set so an in-place modify (same
  // id in both, e.g. rotate) lands on the original instead of being wiped.
  if (entry.objectOps) {
    for (const o of entry.objectOps.added) state.objects.delete(o.id);
    for (const o of entry.objectOps.removed) state.objects.set(o.id, o);
    bumpObjectsVersion(state, { removed: entry.objectOps.added, added: entry.objectOps.removed });
    if (entry.objectOps.added.length) eventBus.emit('objects-changed', { removed: entry.objectOps.added.map(o => o.id) });
    if (entry.objectOps.removed.length) eventBus.emit('objects-changed', { added: entry.objectOps.removed });
    return coords;
  }
  const cmd = entry.cmd;
  switch (cmd.type) {
    case CommandType.PlaceObject:
      state.objects.delete(cmd.object.id);
      bumpObjectsVersion(state, { removed: [cmd.object] });
      eventBus.emit('objects-changed', { removed: [cmd.object.id] });
      break;
    case CommandType.RemoveObject:
      state.objects.set(cmd.removedObject.id, cmd.removedObject);
      bumpObjectsVersion(state, { added: [cmd.removedObject] });
      eventBus.emit('objects-changed', { added: [cmd.removedObject] });
      break;
    case CommandType.TrimCorners:
      if (cmd.layer === 'road' && cmd.objectId) {
        const obj = state.objects.get(cmd.objectId);
        if (obj) {
          obj.corners = cmd.beforeCorners;
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
  // Collapsed (grouped) entry: replay the net object ops forward.
  if (entry.objectOps) {
    for (const o of entry.objectOps.removed) state.objects.delete(o.id);
    for (const o of entry.objectOps.added) state.objects.set(o.id, o);
    bumpObjectsVersion(state, { removed: entry.objectOps.removed, added: entry.objectOps.added });
    if (entry.objectOps.removed.length) eventBus.emit('objects-changed', { removed: entry.objectOps.removed.map(o => o.id) });
    if (entry.objectOps.added.length) eventBus.emit('objects-changed', { added: entry.objectOps.added });
    return coords;
  }
  const cmd = entry.cmd;
  switch (cmd.type) {
    case CommandType.PlaceObject:
      state.objects.set(cmd.object.id, cmd.object);
      bumpObjectsVersion(state, { added: [cmd.object] });
      eventBus.emit('objects-changed', { added: [cmd.object] });
      break;
    case CommandType.RemoveObject:
      state.objects.delete(cmd.objectId);
      bumpObjectsVersion(state, { removed: [cmd.removedObject] });
      eventBus.emit('objects-changed', { removed: [cmd.objectId] });
      break;
    case CommandType.TrimCorners:
      if (cmd.layer === 'road' && cmd.objectId) {
        const obj = state.objects.get(cmd.objectId);
        if (obj) {
          obj.corners = cmd.afterCorners.every(c => c === 'square') ? undefined : cmd.afterCorners;
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
