/**
 * What a macro actually changed.
 *
 * Counted by object id rather than by map size: laying a road network sweeps decorations out of a
 * crossing's clearance, so a size delta nets those removals against the roads and can report zero
 * for a run that paved half the planet.
 */
import type { HistoryEntry } from '../../../core/commands/command-apply';
import { cellKey } from '../../../core/grid/rect';
import { getCell, sameTerrain } from '../../../core/model/grid-model';
import type { CellSnapshot, GridState, MacroCoord, TerrainCell } from '../../../core/model/types';

/** Call before the macro body; the returned function counts the objects whose presence differs
 *  since — arrivals plus departures. A run whose only effect was removing objects still leaves an
 *  undo entry on the stack, so counting arrivals alone would report nothing happened to a caller
 *  that has an entry to undo. */
export function objectsChanged(state: GridState): () => number {
  const before = new Set(state.objects.keys());
  return () => {
    let changed = 0;
    for (const id of state.objects.keys()) if (!before.has(id)) changed++;
    for (const id of before) if (!state.objects.has(id)) changed++;
    return changed;
  };
}

/** Whether a cell's terrain counts as unchanged: a complete gesture compares every field, corners
 *  included; a legacy point builder only type, height and patch flag. */
function sameCount(a: TerrainCell | null, b: TerrainCell | null, includeCorners: boolean): boolean {
  if (includeCorners) return sameTerrain(a, b, { patchOnly: 'exact' });
  if (!a || !b) return !a && !b;
  return a.type === b.type && a.elevation === b.elevation && !!a.patchOnly === !!b.patchOnly;
}

/** The terrain cells whose terrain differs from what they held before `entries`, a stroke's history
 *  oldest first, in the order the entries first touch them: each touched cell's first pre-image
 *  against its terrain now. A cell no entry names cannot differ. The terrain macros lay no objects,
 *  so this is what tells a run that raised a hill from one that laid nothing. */
export function terrainChanged(state: GridState, entries: readonly HistoryEntry[], includeCorners = false): MacroCoord[] {
  const first = new Map<string, CellSnapshot>();
  for (const entry of entries) {
    for (const snap of entry.before) {
      const key = cellKey(snap.coord.x, snap.coord.y);
      if (!first.has(key)) first.set(key, snap);
    }
  }
  const changed: MacroCoord[] = [];
  for (const { coord, cell } of first.values()) {
    const now = getCell(state.cells, coord.x, coord.y)?.terrain ?? null;
    if (!sameCount(cell.terrain, now, includeCorners)) changed.push(coord);
  }
  return changed;
}
