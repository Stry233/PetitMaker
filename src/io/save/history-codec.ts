/**
 * Versioned JSON envelope for the executor's undo stack. HistoryEntry
 * is already plain JSON data (commands, cell snapshots, object ops, taint deltas), so encoding
 * is a bounded copy; decoding validates shape + version and fails to null (the importer drops
 * the section with a warning — never a failed map import).
 *
 * The wire keeps the fields older builds read: a removal carries the object it removed
 * (`removedObject`), derived from the entry's `objectOps` on write. Saves written before every
 * object step recorded `objectOps` are read by deriving them from those legacy fields
 * (`removedObject`, a road trim's `beforeCorners` and `beforeRotation`), which decoding then drops.
 */

import type { HistoryEntry } from '../../core/commands/command-apply';
import { CommandType, type CellSnapshot, type Command, type Corners, type MacroCoord, type MapTemplate, type MaterialisePatchCommand, type PlacedObject, type Rotation, type TrimRoadCommand } from '../../core/model/types';
import { copyCorners } from '../../core/model/corners';
import { isCellZone, isGroundZone, isSandZone } from '../../core/game/zones';
import { clonePlacedObject, templateCellZone } from '../../core/model/grid-model';
import { isLandmarkItem } from '../../core/model/landmarks';
import { readTaintDelta } from '../../core/provenance/serialize';
import { admitSaveObject, isValidTerrainType, isValidElevation, isValidObjectId, isValidRotation } from './admission';
import { isValidCorners } from './terrain-token';
import { currentCatalogId } from '../../config/catalog/retired-ids';
import { migrateV1RampHistory } from './format/migrations/001-v1-to-v2';

const HISTORY_SCHEMA_VERSION = 2;

export interface HistorySection { v: number; totalSteps: number; entries: HistoryEntry[] }

/** The fields a command carries on the wire beyond its in-memory shape: written for older readers
 *  (`removedObject`) or read from older saves (all three). */
interface LegacyCommandFields { removedObject?: PlacedObject; beforeCorners?: Corners; beforeRotation?: Rotation }

/** Every field a corner trim may carry on the wire, whichever kind it is. */
type WireTrim = Partial<Pick<MaterialisePatchCommand, 'terrainType' | 'elevation' | 'patchBase'> & Pick<TrimRoadCommand, 'afterRotation'>> & { patchOnly?: unknown };

/** The map the decoded entries replay into: its size bounds every coordinate and its zones are
 *  the only ones a snapshot may hold, since map saves never change a cell's zone. */
export type HistoryTemplate = Pick<MapTemplate, 'width' | 'height' | 'zones'>;

export function encodeHistory(entries: HistoryEntry[], depth: 'all' | number): HistorySection {
  const kept = depth === 'all' ? entries : entries.slice(Math.max(0, entries.length - depth));
  // A step's generation marks are session-only: the save's own generation section is the record.
  const plain = kept.map((e) => {
    const { generation: _session, ...rest } = e;
    const cmd = e.cmd;
    if (cmd.type !== CommandType.RemoveObject) return rest;
    const removedObject = e.objectOps?.removed.find((o) => o.id === cmd.objectId);
    return removedObject ? { ...rest, cmd: { ...cmd, removedObject } } : rest;
  });
  return { v: HISTORY_SCHEMA_VERSION, totalSteps: entries.length, entries: plain };
}

function inBounds(x: unknown, y: unknown, t: HistoryTemplate): boolean {
  if (typeof x !== 'number' || typeof y !== 'number' || !Number.isInteger(x) || !Number.isInteger(y)) return false;
  return x >= 0 && y >= 0 && x < t.width && y < t.height;
}

const isCoord = (c: unknown, t: HistoryTemplate): c is MacroCoord =>
  !!c && typeof c === 'object' && inBounds((c as MacroCoord).x, (c as MacroCoord).y, t);

const optional = <T>(v: unknown, test: (v: unknown) => v is T): boolean => v === undefined || test(v);
const isBoolean = (v: unknown): v is boolean => typeof v === 'boolean';
const isElevation = (v: unknown): v is number => isValidElevation(v);
const isTerrainType = (v: unknown): v is number => isValidTerrainType(v);
const isRotation = (v: unknown): v is number => isValidRotation(v);

/** History restores objects atomically, so malformed geometry rejects the entire section. A
 *  landmark is laid from the template and never replayed, so no step may name one. */
function validObject(o: unknown, t: HistoryTemplate): boolean {
  if (!o || typeof o !== 'object') return false;
  const obj = o as Partial<PlacedObject>;
  if (!isValidObjectId(obj.id) || obj.locked !== undefined || !obj.position || typeof obj.position !== 'object') return false;
  if (!optional(obj.corners, isValidCorners) || !isValidElevation(obj.elevation)) return false;
  // History carries corners as an array, which the wire-shaped admission reads as a suffix.
  return admitSaveObject({ ...obj, corners: undefined, x: obj.position.x, y: obj.position.y }, t) !== null;
}

/** Read a retired catalog id (the four plain colour roads) as its replacement, so a section written
 *  before the retirement replays instead of being dropped whole for naming an unknown item. In
 *  place, since `decodeHistory` hands these very objects back for the executor to replay. */
function adoptRetiredId(o: unknown): void {
  if (!o || typeof o !== 'object') return;
  const obj = o as { catalogId?: unknown };
  if (typeof obj.catalogId === 'string') obj.catalogId = currentCatalogId(obj.catalogId);
}

function validSnapshot(s: unknown, t: HistoryTemplate): boolean {
  if (!s || typeof s !== 'object') return false;
  const snap = s as Partial<CellSnapshot>;
  if (!isCoord(snap.coord, t)) return false;
  if (!snap.cell || typeof snap.cell !== 'object') return false;
  const { zone, under, terrain } = snap.cell;
  if (!isCellZone(zone) || zone !== templateCellZone(t, snap.coord.x, snap.coord.y)) return false;
  if (under !== undefined && !isSandZone(under)) return false;
  if (terrain === null) return true;
  if (!terrain || typeof terrain !== 'object') return false;
  if (!isValidTerrainType(terrain.type) || !isValidElevation(terrain.elevation)) return false;
  return optional(terrain.patchBase, isElevation) && optional(terrain.corners, isValidCorners) && optional(terrain.patchOnly, isBoolean);
}

/** Every field the command's replay reads, by type; an unknown type rejects the section. */
function validCommand(cmd: unknown, t: HistoryTemplate): boolean {
  if (!cmd || typeof cmd !== 'object') return false;
  const c = cmd as Command;
  switch (c.type) {
    case CommandType.PaintTerrain:
      return Array.isArray(c.cells) && c.cells.every((p) => isCoord(p, t))
        && isValidTerrainType(c.terrainType) && isValidElevation(c.elevation) && (c.ground === undefined || isGroundZone(c.ground));
    case CommandType.EraseTerrain:
      return Array.isArray(c.cells) && c.cells.every((p) => isCoord(p, t)) && (c.ground === undefined || isGroundZone(c.ground));
    case CommandType.PlaceObject:
      return validObject(c.object, t);
    case CommandType.RemoveObject: {
      const removed = (c as LegacyCommandFields).removedObject;
      return isValidObjectId(c.objectId) && !isLandmarkItem(c.objectId)
        && (removed === undefined || (validObject(removed, t) && c.objectId === removed.id));
    }
    case CommandType.TrimCorners: {
      const legacy = c as LegacyCommandFields;
      const wire = c as WireTrim;
      return inBounds(c.x, c.y, t) && (c.layer === 'terrain' || c.layer === 'road')
        && (c.objectId === undefined || (isValidObjectId(c.objectId) && !isLandmarkItem(c.objectId)))
        && optional(legacy.beforeCorners, isValidCorners) && isValidCorners(c.afterCorners)
        && optional(wire.patchOnly, isBoolean) && optional(wire.terrainType, isTerrainType)
        && optional(wire.elevation, isElevation) && optional(wire.patchBase, isElevation)
        && optional(legacy.beforeRotation, isRotation) && optional(wire.afterRotation, isRotation);
    }
    default:
      return false;
  }
}

/** Every object a command could replay into state on undo/redo. */
function commandObjects(cmd: Command): unknown[] {
  switch (cmd.type) {
    case CommandType.PlaceObject: return [cmd.object];
    case CommandType.RemoveObject: return [(cmd as LegacyCommandFields).removedObject].filter((o) => o !== undefined);
    default: return [];
  }
}

/**
 * Saves written before every object step recorded `objectOps` hold placements, removals and road
 * corner trims without them. A placement adds its object and a removal takes back the object it
 * carries. Walking the steps back from `objects`, the map the history ends at, gives each such
 * trim its road after the step and, from the trim's own before-state, the road before it. The
 * legacy fields are dropped once read: in memory a command carries no undo data.
 */
function recordLegacyObjectOps(entries: HistoryEntry[], objects: ReadonlyMap<string, PlacedObject>): void {
  const live = new Map([...objects].map(([id, o]) => [id, clonePlacedObject(o)]));
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i]!;
    const c = entry.cmd;
    const legacy = c as LegacyCommandFields;
    if (!entry.objectOps) {
      if (c.type === CommandType.PlaceObject) entry.objectOps = { removed: [], added: [clonePlacedObject(c.object)] };
      else if (c.type === CommandType.RemoveObject && legacy.removedObject) entry.objectOps = { removed: [clonePlacedObject(legacy.removedObject)], added: [] };
      else if (c.type === CommandType.TrimCorners && c.objectId) {
        const after = live.get(c.objectId);
        if (after) {
          const { corners: _corners, ...rest } = after;
          const before: PlacedObject = {
            ...rest, rotation: legacy.beforeRotation ?? after.rotation, ...(legacy.beforeCorners ? { corners: copyCorners(legacy.beforeCorners) } : {})
          };
          entry.objectOps = { removed: [before], added: [clonePlacedObject(after)] };
        }
      }
    }
    delete legacy.removedObject;
    delete legacy.beforeCorners;
    delete legacy.beforeRotation;
    if (entry.objectOps) {
      for (const o of entry.objectOps.added) live.delete(o.id);
      for (const o of entry.objectOps.removed) live.set(o.id, clonePlacedObject(o));
    }
  }
}

/** The saved undo steps for a map on `template` whose objects are `objects`, or null when any value
 *  in them fails its check. Undo replays this data verbatim, bypassing every rule, so it gets the
 *  same trust bar as the map decoder: one bad value drops the section. Taint deltas are replaced by
 *  their sanitized reading. */
export function decodeHistory(raw: unknown, template: HistoryTemplate, objects: ReadonlyMap<string, PlacedObject> = new Map()): HistoryEntry[] | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = migrateV1RampHistory(raw) as Partial<HistorySection>;
  if (s.v !== HISTORY_SCHEMA_VERSION || !Array.isArray(s.entries)) return null;
  for (const e of s.entries) {
    if (!e || typeof e !== 'object') return null;
    const entry = e as Partial<HistoryEntry>;
    if (!entry.cmd || typeof entry.cmd !== 'object' || !Array.isArray(entry.before) || !Array.isArray(entry.after)) return null;
    // Older saves stamp each command with a time nothing reads; it is dropped so a re-save leaves it out.
    delete (entry.cmd as { timestamp?: unknown }).timestamp;
    // Generation marks are never saved, and undo would write one into the map unchecked.
    delete entry.generation;
    if (entry.objectOps !== undefined) {
      if (!entry.objectOps || typeof entry.objectOps !== 'object') return null;
      if (!Array.isArray(entry.objectOps.removed) || !Array.isArray(entry.objectOps.added)) return null;
    }
    for (const snap of [...entry.before, ...entry.after]) {
      if (!validSnapshot(snap, template)) return null;
    }
    const ops = entry.objectOps ? [...entry.objectOps.removed, ...entry.objectOps.added] : [];
    for (const obj of [...ops, ...commandObjects(entry.cmd)]) adoptRetiredId(obj);
    if (!ops.every((obj) => validObject(obj, template)) || !validCommand(entry.cmd, template)) return null;
    if (entry.taint !== undefined) {
      const taint = readTaintDelta(entry.taint, template.width, template.height);
      if (!taint) return null;
      entry.taint = taint;
    }
  }
  recordLegacyObjectOps(s.entries as HistoryEntry[], objects);
  return s.entries as HistoryEntry[];
}
