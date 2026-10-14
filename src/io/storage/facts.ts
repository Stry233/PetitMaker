// What the autosave promises, read without loading its codec: the debounce, the content worth
// keeping and whether a save is stored.
import { isCustomTemplate } from '../../core/model/planet';
import { holdsTemplateTerrain } from '../../core/model/template';
import { readStoredPref } from '../../platform/storage/prefs';
import type { GridState } from '../../core/model/types';

export const AUTOSAVE_DEBOUNCE_MS = 2000;

/** Visible map content shared by the restore offer and replacement confirmations. */
export function autosaveWorthy(state: GridState): boolean {
  if (isCustomTemplate(state.template)) return true;
  if ((state.annotations?.items.length ?? 0) > 0) return true;
  for (let y = 0; y < state.cells.length; y++) {
    const row = state.cells[y];
    if (!row) continue;
    // A row is a sparse array in a hand-built or partially-decoded grid, so a hole reads as
    // undefined; this walk runs inside the first-launch check, where a throw would take the app down.
    for (let x = 0; x < row.length; x++) {
      const cell = row[x];
      if (cell?.terrain && !holdsTemplateTerrain(state.template, x, y, cell)) return true;
    }
  }
  for (const [, obj] of state.objects) if (!obj.locked) return true;
  return false;
}

/** Whether a restorable autosave exists. */
export function hasAutosave(): boolean {
  const stored = readStoredPref('autosave');
  return stored.available && stored.raw !== null;
}
