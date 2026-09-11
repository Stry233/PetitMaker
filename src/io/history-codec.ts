/**
 * Versioned JSON envelope for the executor's undo stack. HistoryEntry
 * is already plain JSON data (commands, cell snapshots, object ops, taint deltas), so encoding
 * is a bounded copy; decoding validates shape + version and fails to null (the importer drops
 * the section with a warning — never a failed map import).
 */

import type { HistoryEntry } from '../core/commands/command-apply';
import { CommandType, type CellSnapshot, type PlacedObject } from '../core/model/types';
import { getCatalogItem } from '../state/catalog';
import { hasHalfStep } from '../state/object-geometry';
import { onHalfGrid } from '../core/model/grid-model';
import { isValidTerrainType, isValidRotation, isValidElevation } from './import-validate';
import { currentCatalogId } from './legacy-catalog';

export const HISTORY_SCHEMA_VERSION = 1;

export interface HistorySection { v: number; totalSteps: number; entries: HistoryEntry[] }

/** Grid dimensions the decoded entries must fit inside. */
export interface HistoryBounds { width: number; height: number }

export function encodeHistory(entries: HistoryEntry[], depth: 'all' | number): HistorySection {
  const kept = depth === 'all' ? entries : entries.slice(Math.max(0, entries.length - depth));
  return { v: HISTORY_SCHEMA_VERSION, totalSteps: entries.length, entries: kept };
}

function inBounds(x: unknown, y: unknown, b: HistoryBounds | undefined, half = false): boolean {
  const onGrid = half ? onHalfGrid : Number.isInteger;
  if (typeof x !== 'number' || typeof y !== 'number' || !onGrid(x) || !onGrid(y)) return false;
  if (!b) return x >= 0 && y >= 0;
  return x >= 0 && y >= 0 && x < b.width && y < b.height;
}

/** An imported object is trusted only as far as the main map decoder would trust it:
 *  known catalogId, finite in-bounds coordinates on the item's OWN grid (a halfStep item —
 *  ramps, bridges — anchors on the half grid, everything else on whole cells, exactly as
 *  json-codec's loader gates it), legal rotation/elevation. Undo replays these straight into
 *  GridState with no rule validation, so this filter is the gate. */
function validObject(o: unknown, b: HistoryBounds | undefined): boolean {
  if (!o || typeof o !== 'object') return false;
  const obj = o as Partial<PlacedObject>;
  if (typeof obj.id !== 'string' || typeof obj.catalogId !== 'string') return false;
  const item = getCatalogItem(obj.catalogId);
  if (!item) return false;
  if (!obj.position || !inBounds(obj.position.x, obj.position.y, b, hasHalfStep(item))) return false;
  if (!isValidRotation(obj.rotation)) return false;
  if (!isValidElevation(obj.elevation)) return false;
  return true;
}

/** Read a retired catalog id (the four plain colour roads) as its replacement, so a section written
 *  before the retirement replays instead of being dropped whole for naming an unknown item. In
 *  place, since `decodeHistory` hands these very objects back for the executor to replay. */
function adoptRetiredId(o: unknown): void {
  if (!o || typeof o !== 'object') return;
  const obj = o as { catalogId?: unknown };
  if (typeof obj.catalogId === 'string') obj.catalogId = currentCatalogId(obj.catalogId);
}

function validSnapshot(s: unknown, b: HistoryBounds | undefined): boolean {
  if (!s || typeof s !== 'object') return false;
  const snap = s as Partial<CellSnapshot>;
  if (!snap.coord || !inBounds(snap.coord.x, snap.coord.y, b)) return false;
  if (!snap.cell || typeof snap.cell !== 'object') return false;
  const t = snap.cell.terrain;
  if (t === null || t === undefined) return true;
  if (!isValidTerrainType(t.type)) return false;
  if (!isValidElevation(t.elevation)) return false;
  if (t.patchBase !== undefined && !isValidElevation(t.patchBase)) return false;
  return true;
}

/** Every object a command could replay into state on undo/redo. */
function commandObjects(cmd: HistoryEntry['cmd']): PlacedObject[] {
  switch (cmd.type) {
    case CommandType.PlaceObject: return [cmd.object];
    case CommandType.RemoveObject: return [cmd.removedObject];
    default: return [];
  }
}

export function decodeHistory(raw: unknown, bounds?: HistoryBounds): HistoryEntry[] | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Partial<HistorySection>;
  if (s.v !== HISTORY_SCHEMA_VERSION || !Array.isArray(s.entries)) return null;
  for (const e of s.entries) {
    if (!e || typeof e !== 'object') return null;
    const entry = e as Partial<HistoryEntry>;
    if (!entry.cmd || !Array.isArray(entry.before) || !Array.isArray(entry.after)) return null;
    if (entry.objectOps !== undefined) {
      if (!entry.objectOps || typeof entry.objectOps !== 'object') return null;
      if (!Array.isArray(entry.objectOps.removed) || !Array.isArray(entry.objectOps.added)) return null;
    }
    // Content validation — undo replays this data verbatim, bypassing every rule, so
    // it gets the same trust bar as the map decoder: one bad value drops the section.
    for (const snap of [...entry.before, ...entry.after]) {
      if (!validSnapshot(snap, bounds)) return null;
    }
    const ops = entry.objectOps ? [...entry.objectOps.removed, ...entry.objectOps.added] : [];
    for (const obj of [...ops, ...commandObjects(entry.cmd as HistoryEntry['cmd'])]) {
      adoptRetiredId(obj);
      if (!validObject(obj, bounds)) return null;
    }
  }
  return s.entries as HistoryEntry[];
}
