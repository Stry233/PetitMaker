/**
 * Full local-data reset (Settings → "Local data"): wipe everything this origin
 * persists — BYOK API keys (localStorage record + the IndexedDB vault key),
 * the autosaved map, locale/zoom/agent preferences — then reload so the app
 * boots brand new (in-memory stores, timers, and transcripts all reset).
 *
 * A full origin wipe rather than a curated key list: a curated list silently
 * drifts the day someone adds a new persisted key, and "brand new startup" is
 * exactly localStorage.clear() semantics.
 */
import { deleteVault } from '../../platform/storage/vault';
import type { Autosave } from './autosave';

/** The wipe half, separated from the reload so it is unit-testable. The owed autosave (its debounce,
 *  an in-flight compression) is cancelled and autosave suspended first, so neither the timer nor the
 *  reload's pagehide flush writes the map back. */
export async function wipeLocalData(autosave: Autosave): Promise<void> {
  autosave.clear();
  autosave.setSuspended(true);
  try {
    localStorage.clear();
  } catch {
    /* storage disabled — nothing persisted anyway */
  }
  try {
    sessionStorage.clear();
  } catch {
    /* ditto */
  }
  await deleteVault().catch(() => {});
}

export async function resetAllLocalData(autosave: Autosave): Promise<void> {
  await wipeLocalData(autosave);
  window.location.reload();
}
