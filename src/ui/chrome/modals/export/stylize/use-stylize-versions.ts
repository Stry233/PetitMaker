// A React view of the session's stylize version shelf, plus one imperative accessor for callers
// outside a component (the export/preview capture paths). `versionStore` is a plain module-level
// store (io/stylize/versions.ts), not zustand, so `useSyncExternalStore` is the seam into React.
import { useSyncExternalStore } from 'react';
import { versionStore, type VersionState, type StylizeVersion } from '../../../../../io/stylize';

function findSelected(state: VersionState): StylizeVersion | null {
  return state.selectedId ? (state.versions.find((v) => v.id === state.selectedId) ?? null) : null;
}

export function useStylizeVersions(): { state: VersionState; selected: StylizeVersion | null } {
  const state = useSyncExternalStore(versionStore.subscribe, versionStore.getState, versionStore.getState);
  return { state, selected: findSelected(state) };
}

/** The currently selected version, read imperatively (outside a component). 原图 (no selection)
 *  returns null. */
export function selectedVersion(): StylizeVersion | null {
  return findSelected(versionStore.getState());
}
