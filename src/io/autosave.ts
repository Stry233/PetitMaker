// Crash-safe autosave: debounced localStorage persistence of the working map,
// restored on the next load. Built on the versioned codec (json-codec →
// io/save-format), so an autosave written by an older build still loads, and one
// written by a newer build is ignored rather than mis-parsed.
import { SUPPORTS_WORKERS } from '../core/runtime/edition';
import { buildSaveFile, deserializeParsed, persistedCamera, readParsedSaveCamera, templateOfSave } from './json-codec';
import { encodeHistory, decodeHistory, type HistorySection } from './history-codec';
import { isCustomTemplate } from '../core/model/planet';
import { host } from '../kit/host';
import { useEditorStore } from '../state/store';
import { prefStorageAvailable, readStoredPref, removePref, writePref } from '../core/runtime/prefs';
import type { HistoryEntry } from '../core/commands/command-apply';
import type { GridState } from '../core/model/types';
import type { PersistedCamera, SaveFile } from './save-format';
import { COMPRESS_AUTOSAVE_AT, fitsAutosaveRestoreLimit, decodeAutosave, encodeAutosave, encodeAutosaveInWorker } from './autosave-codec';

export const AUTOSAVE_DEBOUNCE_MS = 2000;

const HISTORY_STEPS = 60;
let timer: ReturnType<typeof setTimeout> | null = null;
let compression: AbortController | null = null;
let revision = 0;
/** While set, no save is scheduled or serialized: the live map is a scratch canvas, not the user's map. */
let suspended = false;
type AutosaveFile = SaveFile & { autosave: 1; history?: HistorySection };

/** The camera(s) to persist alongside the map, read live from whichever view(s) have ever been
 *  active — NOT hooked to camera movement itself (a pan/orbit fires continuously; hammering
 *  localStorage on every frame would be the bug). It only rides along on the NEXT
 *  content-triggered write, and because it's read HERE (at write time, ~AUTOSAVE_DEBOUNCE_MS after the
 *  triggering edit) rather than captured back when that edit happened, it can never be more stale
 *  than "whatever the user is looking at right now" — there is no drift window to bound. Each view
 *  is independent: a view never opened this session simply reports undefined and is omitted. */
function currentCamera(): PersistedCamera | undefined {
  return persistedCamera(host.camera.get2d(), host.camera.get3d());
}

/**
 * The undo stack's tail, read LIVE at write time for the same reason the camera is: the debounce
 * fires ~AUTOSAVE_DEBOUNCE_MS after the edit that triggered it, and `getUndoEntries` returns a copy, so a
 * list captured back then would describe a map that has since moved on.
 */
function currentHistory(state: GridState): HistorySection | undefined {
  const { commandExecutor: executor, gridState } = useEditorStore.getState();
  if (!executor || (gridState && gridState !== state)) return undefined;
  const entries = executor.getUndoEntries();
  return entries.length ? encodeHistory(entries, HISTORY_STEPS) : undefined;
}

/** A single key replacement commits the map and its matching history together. */
function writeSnapshot(record: string): boolean {
  if (writePref('autosave', record) && removePref('autosaveHistory')) return true;
  // Free the history's space and retry; put the history back if the map still does not fit.
  const prior = readStoredPref('autosaveHistory');
  const priorHistory = prior.available ? prior.raw : null;
  if (removePref('autosaveHistory') && writePref('autosave', record)) return true;
  if (priorHistory !== null) writePref('autosaveHistory', priorHistory);
  return false;
}

/**
 * Serialize and store the map. `immediate` gives up the compression worker and encodes on this
 * thread, because a page being hidden or unloaded may never run another task.
 */
function writeAutosave(state: GridState, current: number, immediate: boolean): void {
  if (suspended) return;
  if (!prefStorageAvailable() || !autosaveWorthy(state)) return;
  const save: AutosaveFile = { ...buildSaveFile(state, currentCamera()), autosave: 1, history: currentHistory(state) };
  let json = JSON.stringify(save);
  if (!fitsAutosaveRestoreLimit(json)) {
    const { history: _history, ...map } = save;
    json = JSON.stringify(map);
    if (!fitsAutosaveRestoreLimit(json)) return;
  }
  const write = (record: string) => {
    if (current !== revision) return;
    if (writeSnapshot(record)) return;
    // Preserve the map if storage cannot hold history, then try without provenance as a last resort.
    const { history: _history, ...map } = JSON.parse(json) as AutosaveFile;
    if (writeSnapshot(encodeAutosave(JSON.stringify(map)))) return;
    const { provenance: _provenance, ...minimal } = map;
    writeSnapshot(encodeAutosave(JSON.stringify(minimal)));
  };
  if (!SUPPORTS_WORKERS || immediate || json.length < COMPRESS_AUTOSAVE_AT || typeof Worker === 'undefined') {
    write(encodeAutosave(json));
    return;
  }
  const controller = new AbortController();
  compression = controller;
  void encodeAutosaveInWorker(json, controller.signal).then(write, () => {
    if (!controller.signal.aborted && current === revision) write(encodeAutosave(json));
  }).finally(() => { if (compression === controller) compression = null; });
}

/** The debounced write waiting to happen, kept so backgrounding the tab can still make it. */
let pending: { state: GridState; revision: number } | null = null;

/**
 * Write the debounced save now. A phone browser discards a hidden tab without another timer tick,
 * so `visibilitychange` and `pagehide` are the last chance the pending edits get.
 */
export function flushAutosave(): void {
  const owed = pending;
  if (!owed) return;
  pending = null;
  if (timer !== null) clearTimeout(timer);
  timer = null;
  writeAutosave(owed.state, owed.revision, true);
}

let lifecycleBound = false;

/** Bound on the first scheduled save, since before that there is nothing owed. */
function bindLifecycle(): void {
  if (lifecycleBound || typeof document === 'undefined') return;
  lifecycleBound = true;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushAutosave();
  });
  // Safari does not reliably report a hidden state when the page is being replaced or frozen.
  window.addEventListener('pagehide', flushAutosave);
}

export function setAutosaveSuspended(on: boolean): void { suspended = on; }

export function isAutosaveSuspended(): boolean { return suspended; }

export function scheduleAutosave(state: GridState): void {
  if (suspended) return;
  const current = ++revision;
  compression?.abort();
  compression = null;
  if (timer !== null) clearTimeout(timer);
  bindLifecycle();
  pending = { state, revision: current };
  timer = setTimeout(() => {
    timer = null;
    pending = null;
    writeAutosave(state, current, false);
  }, AUTOSAVE_DEBOUNCE_MS);
}

/** A map worth persisting: any terrain, any object beyond the built-in plaza, or any plan-notes
 *  ink — a planet still being ANNOTATED is a session too. A fresh empty map must never clobber a
 *  real save. Exported as the ONE definition of empty, shared with the startup restore offer and
 *  the drag-drop import confirm. */
export function autosaveWorthy(state: GridState): boolean {
  if (isCustomTemplate(state.template)) return true;
  if ((state.annotations?.items.length ?? 0) > 0) return true;
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
function readHistory(state: GridState, save: Partial<AutosaveFile>): HistoryEntry[] | undefined {
  if (save.autosave === 1) {
    return decodeHistory(save.history, state.template) ?? undefined;
  }
  const stored = readStoredPref('autosaveHistory');
  const json = stored.available ? stored.raw : null;
  if (!json) return undefined;
  try {
    const { width, height } = state.template;
    return decodeHistory(JSON.parse(json), { width, height }) ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * Restore the last autosaved map, resolving its template from the saved id or the embedded planet.
 * Returns null when there's nothing to restore or the save can't be read
 * (corrupt, or saved by a newer build — the version guard lives in deserialize →
 * migrateToCurrent). Never throws.
 */
export function readAutosave(): RestoredAutosave | null {
  const stored = readStoredPref('autosave');
  const json = stored.available ? stored.raw : null;
  if (!json) return null;
  try {
    const parsed = JSON.parse(decodeAutosave(json)) as Partial<AutosaveFile>;
    const state = deserializeParsed(parsed, templateOfSave(parsed));
    // A save with no `camera` key restores with `camera` undefined, and the camera is left alone.
    // The history is read the same way: absent or unreadable, the map still restores and simply
    // arrives with nothing to undo.
    return { state, camera: readParsedSaveCamera(parsed), history: readHistory(state, parsed) };
  } catch {
    return null;
  }
}

/** Forget the autosave (e.g. a deliberate reset), its history with it. */
export function clearAutosave(): void {
  revision++;
  compression?.abort();
  compression = null;
  if (timer !== null) clearTimeout(timer);
  timer = null;
  pending = null;
  removePref('autosave');
  removePref('autosaveHistory');
}

/** Whether a restorable autosave exists. */
export function hasAutosave(): boolean {
  const stored = readStoredPref('autosave');
  return stored.available && stored.raw !== null;
}

/** The autosave this browser holds if it is worth restoring: present, readable, and
 *  `autosaveWorthy` (not just the auto-recreated, locked plaza), else null. Returns the save rather
 *  than a boolean because the two questions asked at startup — offer a restore, and has this
 *  browser used the editor before (the first-launch tour's test) — are the same question, and a
 *  full JSON.parse + deserialize of a large map is not something to do twice on a cold start. */
export function readRestorableAutosave(): RestoredAutosave | null {
  const candidate = readAutosave();
  return candidate && autosaveWorthy(candidate.state) ? candidate : null;
}
