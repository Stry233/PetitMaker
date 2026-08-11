// Crash-safe autosave: debounced localStorage persistence of the working map,
// restored on the next load. Built on the versioned codec (json-codec →
// io/save-format), so an autosave written by an older build still loads, and one
// written by a newer build is ignored rather than mis-parsed.
import { serialize, deserialize, readSaveCamera } from './json-codec';
import { encodeHistory, decodeHistory } from './history-codec';
import { getMapTemplate } from '../config/maps';
import { host } from '../kit/host';
import { useEditorStore } from '../state/store';
import { PREFS } from '../core/runtime/prefs';
import type { HistoryEntry } from '../core/commands/command-apply';
import type { GridState } from '../core/model/types';
import type { PersistedCamera } from './save-format';

const DEBOUNCE_MS = 2000;

/**
 * How many undo steps ride along with the map.
 *
 * An entry carries a cell snapshot per cell it touched, so a stroke over a large area is not small
 * and the whole stack is unbounded. This is the tail worth keeping: enough that resuming a session
 * can walk back through the last stretch of work, few enough that the history cannot be what pushes
 * the map out of the quota.
 */
const HISTORY_STEPS = 60;

let timer: ReturnType<typeof setTimeout> | null = null;

/** The camera(s) to persist alongside the map, read live from whichever view(s) have ever been
 *  active — NOT hooked to camera movement itself (a pan/orbit fires continuously; hammering
 *  localStorage on every frame would be the bug). It only rides along on the NEXT
 *  content-triggered write, and because it's read HERE (at write time, ~DEBOUNCE_MS after the
 *  triggering edit) rather than captured back when that edit happened, it can never be more stale
 *  than "whatever the user is looking at right now" — there is no drift window to bound. Each view
 *  is independent: a view never opened this session simply reports undefined and is omitted. */
function currentCamera(): PersistedCamera | undefined {
  const view2d = host.camera.get2d();
  const view3d = host.camera.get3d();
  if (!view2d && !view3d) return undefined;
  return { ...(view2d ? { view2d } : {}), ...(view3d ? { view3d } : {}) };
}

/**
 * The undo stack's tail, read LIVE at write time for the same reason the camera is: the debounce
 * fires ~DEBOUNCE_MS after the edit that triggered it, and `getUndoEntries` returns a copy, so a
 * list captured back then would describe a map that has since moved on.
 */
function currentHistory(): string | null {
  const executor = useEditorStore.getState().commandExecutor;
  if (!executor) return null;
  const entries = executor.getUndoEntries();
  if (entries.length === 0) return null;
  return JSON.stringify(encodeHistory(entries, HISTORY_STEPS));
}

/** Write the history beside the map, or make sure none is left standing. The two are written in one
 *  tick so the pair always describes the same edit; a history that will not fit is dropped rather
 *  than kept, since a stack that does not match its map would undo into a state nobody was in. */
function writeHistory(json: string | null): void {
  try {
    if (json === null) localStorage.removeItem(PREFS.autosaveHistory.key);
    else localStorage.setItem(PREFS.autosaveHistory.key, json);
  } catch {
    try { localStorage.removeItem(PREFS.autosaveHistory.key); } catch { /* storage is gone */ }
  }
}

/** Debounced: persist the working map ~DEBOUNCE_MS after the last edit. Safe to
 *  call on every mutation — only the trailing call writes. */
export function scheduleAutosave(state: GridState): void {
  if (timer !== null) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    // The content gate runs at write time: what matters is whether the map has
    // content when the save actually lands, and the check is a grid walk that
    // must not run once per command.
    if (!autosaveWorthy(state)) return;
    const camera = currentCamera();
    const history = currentHistory();
    let saved = false;
    try {
      localStorage.setItem(PREFS.autosave.key, serialize(state, camera));
      saved = true;
    } catch {
      // Quota exceeded. The provenance section dominates the payload on generated
      // maps (per-cell taint + the operation ledger); the map itself is what the
      // restore bubble protects, so save it without provenance before giving up.
      try {
        const { provenance: _dropped, ...rest } = state;
        localStorage.setItem(PREFS.autosave.key, serialize(rest as GridState, camera));
        saved = true;
      } catch {
        // Still failing (storage unavailable / truly full) — drop this autosave;
        // the next edit tries again.
      }
    }
    // Only ever beside a map that landed: a history left over from an older map would be paired
    // with it on the next resume.
    writeHistory(saved ? history : null);
  }, DEBOUNCE_MS);
}

/** A map worth persisting: any terrain, or any object beyond the built-in plaza.
 *  A fresh empty map must never clobber a real save. Exported as the ONE definition of empty,
 *  shared with the startup restore offer and the drag-drop import confirm. */
export function autosaveWorthy(state: GridState): boolean {
  for (const row of state.cells) {
    // A row is a sparse array in a hand-built or partially-decoded grid, so a hole reads as
    // undefined; this walk runs inside the first-launch check, where a throw would take the app down.
    for (const cell of row) if (cell?.terrain) return true;
  }
  for (const [, obj] of state.objects) if (!obj.locked) return true;
  return false;
}

/** A restored autosave: the map plus whatever camera(s) and undo steps rode along with it. Each is
 *  independently optional — a save written before that feature, a view never opened this session, a
 *  history that did not fit the quota. */
export interface RestoredAutosave {
  state: GridState;
  camera?: PersistedCamera;
  history?: HistoryEntry[];
}

/** The saved undo steps, if they are readable and fit the map being restored. Bounds-checked
 *  against that map: undo replays entries straight into the grid with no rule validation, so a
 *  history written for a different template is dropped rather than trusted. */
function readHistory(state: GridState): HistoryEntry[] | undefined {
  let json: string | null = null;
  try {
    json = localStorage.getItem(PREFS.autosaveHistory.key);
  } catch {
    return undefined;
  }
  if (!json) return undefined;
  try {
    const { width, height } = state.template;
    return decodeHistory(JSON.parse(json), { width, height }) ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * Restore the last autosaved map, resolving its template from the saved id.
 * Returns null when there's nothing to restore or the save can't be read
 * (corrupt, or saved by a newer build — the version guard lives in deserialize →
 * migrateToCurrent). Never throws.
 */
export function readAutosave(): RestoredAutosave | null {
  let json: string | null = null;
  try {
    json = localStorage.getItem(PREFS.autosave.key);
  } catch {
    return null; // localStorage unavailable (private mode / SSR)
  }
  if (!json) return null;
  try {
    const { templateId } = JSON.parse(json) as { templateId?: string };
    const state = deserialize(json, getMapTemplate(templateId));
    // A pre-camera autosave simply has no `camera` key — readSaveCamera reads undefined and the
    // restore leaves the camera alone (App.tsx only applies it when present). The history is read
    // the same way: absent or unreadable, the map still restores and simply arrives with nothing
    // to undo.
    return { state, camera: readSaveCamera(json), history: readHistory(state) };
  } catch {
    return null;
  }
}

/** Forget the autosave (e.g. a deliberate reset), its history with it. */
export function clearAutosave(): void {
  try {
    localStorage.removeItem(PREFS.autosave.key);
    localStorage.removeItem(PREFS.autosaveHistory.key);
  } catch {
    // ignore
  }
}

/** Whether a restorable autosave exists. */
export function hasAutosave(): boolean {
  try {
    return localStorage.getItem(PREFS.autosave.key) !== null;
  } catch {
    return false;
  }
}

/** The autosave this browser holds if it is worth restoring: present, readable, and
 *  `autosaveWorthy` (not just the auto-recreated, locked plaza), else null. Returns the save rather
 *  than a boolean because the two questions asked at startup — offer a restore, and has this
 *  browser used the editor before (the first-launch tour's test) — are the same question, and a
 *  full JSON.parse + deserialize of a 169x140 map is not something to do twice on a cold start. */
export function readRestorableAutosave(): RestoredAutosave | null {
  const candidate = readAutosave();
  return candidate && autosaveWorthy(candidate.state) ? candidate : null;
}
