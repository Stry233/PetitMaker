// Crash-safe autosave: debounced localStorage persistence of the working map,
// restored on the next load. Built on the versioned codec (json-codec →
// io/save/format), so an autosave written by an older build still loads, and one
// written by a newer build is ignored rather than mis-parsed.
import { SUPPORTS_WORKERS } from '../../platform/build/edition';
import { buildSaveFile } from '../save/json-codec';
import { parseSave } from '../save/parse';
import { isInputRefusal } from '../save/import-error';
import { readParsedSaveCamera } from '../save/camera';
import type { LandmarkClearance } from '../../tools/generation/transfer';
import { loadParsedSave } from '../import/open-save';
import { encodeHistory, decodeHistory, type HistorySection } from '../save/history-codec';
import { prefStorageAvailable, readStoredPref, removePref, writePref } from '../../platform/storage/prefs';
import type { HistoryEntry } from '../../core/commands/command-apply';
import type { GridState } from '../../core/model/types';
import type { PersistedCamera, SaveFile } from '../save/format';
import { COMPRESS_RECORD_AT, fitsRecordRestoreLimit, decodeRecord, encodeRecord } from './record-codec';
import { encodeRecordInWorker } from './record-compress';
import { AUTOSAVE_DEBOUNCE_MS, autosaveWorthy } from './facts';

const HISTORY_STEPS = 60;
type AutosaveFile = SaveFile & { autosave: 1; history?: HistorySection };

/** What a write reads at the moment it runs, roughly `AUTOSAVE_DEBOUNCE_MS` after the edit that
 *  owed it, so neither can describe a view or a map that has since moved on. */
export interface AutosaveSources {
  /** The camera of each view opened this session; a view never opened reports nothing. Camera
   *  movement alone never schedules a write: the camera rides along on the next content write. */
  camera(): PersistedCamera | undefined;
  /** The undo entries recorded against `state`, or none when `state` is no longer the live map. */
  history(state: GridState): readonly HistoryEntry[] | undefined;
}

/** The debounced writer of the working map. */
export interface Autosave {
  /** Owe a write of `state`. Initialization must not replace a pending restore with the startup's empty canvas. */
  schedule(state: GridState, reason?: 'initialize' | 'edit'): void;
  /** Write the owed save now. A phone browser discards a hidden tab without another timer tick, so
   *  `visibilitychange` and `pagehide` are the last chance the pending edits get. */
  flush(): void;
  /** Forget the autosave (e.g. a deliberate reset), its history with it. */
  clear(): void;
  /** While suspended, no save is scheduled or serialized: the live map is a scratch canvas, not the user's map. */
  setSuspended(on: boolean): void;
  isSuspended(): boolean;
}

/** A single key replacement stores the map and its matching history together. */
function writeSnapshot(record: string): boolean {
  if (writePref('autosave', record) && removePref('autosaveHistory')) return true;
  // Free the history's space and retry; put the history back if the map still does not fit.
  const prior = readStoredPref('autosaveHistory');
  const priorHistory = prior.available ? prior.raw : null;
  if (removePref('autosaveHistory') && writePref('autosave', record)) return true;
  if (priorHistory !== null) writePref('autosaveHistory', priorHistory);
  return false;
}

export function createAutosave(sources: AutosaveSources): Autosave {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let compression: AbortController | null = null;
  let revision = 0;
  let suspended = false;
  /** The debounced write waiting to happen, kept so backgrounding the tab can still make it. */
  let pending: { state: GridState; revision: number } | null = null;
  let lifecycleBound = false;

  const history = (state: GridState): HistorySection | undefined => {
    const entries = sources.history(state);
    return entries?.length ? encodeHistory([...entries], HISTORY_STEPS) : undefined;
  };

  /** `immediate` gives up the compression worker and encodes on this thread, because a page being
   *  hidden or unloaded may never run another task. */
  const write = (state: GridState, current: number, immediate: boolean): void => {
    if (suspended) return;
    if (!prefStorageAvailable()) return;
    const save: AutosaveFile = { ...buildSaveFile(state, sources.camera()), autosave: 1, history: history(state) };
    let json = JSON.stringify(save);
    if (!fitsRecordRestoreLimit(json)) {
      const { history: _history, ...map } = save;
      json = JSON.stringify(map);
      if (!fitsRecordRestoreLimit(json)) return;
    }
    const store = (record: string) => {
      if (current !== revision) return;
      if (writeSnapshot(record)) return;
      // Preserve the map if storage cannot hold history, then try without provenance as a last resort.
      const { history: _history, ...map } = JSON.parse(json) as AutosaveFile;
      if (writeSnapshot(encodeRecord(JSON.stringify(map)))) return;
      const { provenance: _provenance, ...minimal } = map;
      writeSnapshot(encodeRecord(JSON.stringify(minimal)));
    };
    if (!SUPPORTS_WORKERS || immediate || json.length < COMPRESS_RECORD_AT || typeof Worker === 'undefined') {
      store(encodeRecord(json));
      return;
    }
    const controller = new AbortController();
    compression = controller;
    void encodeRecordInWorker(json, controller.signal).then(store, () => {
      if (!controller.signal.aborted && current === revision) store(encodeRecord(json));
    }).finally(() => { if (compression === controller) compression = null; });
  };

  const flush = (): void => {
    const owed = pending;
    if (!owed) return;
    pending = null;
    if (timer !== null) clearTimeout(timer);
    timer = null;
    write(owed.state, owed.revision, true);
  };

  /** Bound on the first scheduled save, since before that there is nothing owed. */
  const bindLifecycle = (): void => {
    if (lifecycleBound || typeof document === 'undefined') return;
    lifecycleBound = true;
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flush();
    });
    // Safari does not reliably report a hidden state when the page is being replaced or frozen.
    window.addEventListener('pagehide', flush);
  };

  return {
    schedule(state, reason = 'edit') {
      if (suspended || (reason === 'initialize' && !autosaveWorthy(state))) return;
      const current = ++revision;
      compression?.abort();
      compression = null;
      if (timer !== null) clearTimeout(timer);
      bindLifecycle();
      pending = { state, revision: current };
      timer = setTimeout(() => {
        timer = null;
        pending = null;
        write(state, current, false);
      }, AUTOSAVE_DEBOUNCE_MS);
    },
    flush,
    clear() {
      revision++;
      compression?.abort();
      compression = null;
      if (timer !== null) clearTimeout(timer);
      timer = null;
      pending = null;
      removePref('autosave');
      removePref('autosaveHistory');
    },
    setSuspended(on) { suspended = on; },
    isSuspended: () => suspended,
  };
}

/** A restored autosave: the map plus whatever camera(s) and undo steps rode along with it. Each is
 *  independently optional — a save written before that feature, a view never opened this session, a
 *  history that did not fit the quota. */
export interface RestoredAutosave {
  state: GridState;
  camera?: PersistedCamera;
  history?: HistoryEntry[];
  /** What the restore took off the map from under its landmarks. */
  cleared?: LandmarkClearance;
}

/** The saved undo steps, if they are readable and fit the map being restored. Bounds-checked
 *  against that map: undo replays entries straight into the grid with no rule validation, so a
 *  history written for a different template is dropped rather than trusted. */
function readHistory(state: GridState, save: Partial<AutosaveFile>, migrated: Partial<AutosaveFile>): HistoryEntry[] | undefined {
  // A migration that drops the history drops the separately stored one with it.
  if (save.history !== undefined && migrated.history === undefined) return undefined;
  if (save.autosave === 1) {
    return decodeHistory(save.history, state.template, state.objects) ?? undefined;
  }
  if (migrated.version !== save.version) return undefined;
  const stored = readStoredPref('autosaveHistory');
  const json = stored.available ? stored.raw : null;
  if (!json) return undefined;
  try {
    return decodeHistory(JSON.parse(json), state.template, state.objects) ?? undefined;
  } catch (err) {
    if (!isInputRefusal(err)) console.error('[autosave] history restore failed', err);
    return undefined;
  }
}

/**
 * Restore the last autosaved map, resolving its template from the saved id or the embedded planet.
 * Returns null when there's nothing to restore or the save can't be read
 * (corrupt, or saved by a newer build: parseSave refuses it). Never throws; a fault other than a
 * refused input is logged.
 */
export function readAutosave(): RestoredAutosave | null {
  const stored = readStoredPref('autosave');
  const json = stored.available ? stored.raw : null;
  if (!json) return null;
  try {
    const parsed = parseSave(JSON.parse(decodeRecord(json)));
    const { state, cleared } = loadParsedSave(parsed);
    // A save with no `camera` key restores with `camera` undefined, and the camera is left alone.
    // The history is read the same way: absent or unreadable, the map still restores and simply
    // arrives with nothing to undo.
    const save = parsed.raw as Partial<AutosaveFile>;
    return { state, camera: readParsedSaveCamera(save), history: readHistory(state, save, parsed.file as Partial<AutosaveFile>), cleared };
  } catch (err) {
    if (!isInputRefusal(err)) console.error('[autosave] restore failed', err);
    return null;
  }
}

/** An empty edited map is worth restoring when it still carries undo history. */
export function readRestorableAutosave(): RestoredAutosave | null {
  const candidate = readAutosave();
  return candidate && (autosaveWorthy(candidate.state) || candidate.history?.length) ? candidate : null;
}
