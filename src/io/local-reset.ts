/**
 * Full local-data reset (Settings → "Local data"): wipe EVERYTHING this origin
 * persists — BYOK API keys (localStorage record + the IndexedDB vault key),
 * the autosaved map, locale/zoom/agent preferences — then reload so the app
 * boots brand new (in-memory stores, timers, and transcripts all reset).
 *
 * A full origin wipe rather than a curated key list: a curated list silently
 * drifts the day someone adds a new persisted key, and "brand new startup" is
 * exactly localStorage.clear() semantics.
 */
import { deleteVault } from '../core/runtime/vault';

/** The wipe half, separated from the reload so it is unit-testable. */
export async function wipeLocalData(): Promise<void> {
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

export async function resetAllLocalData(): Promise<void> {
  await wipeLocalData();
  window.location.reload();
}
