// A React view of the session's stylize version shelf. `versionStore` is a plain module-level store
// (state/stylize-versions.ts), not zustand, so `useSyncExternalStore` is the seam into React; the
// export and review paths read `selectedVersion` from there.
import { useSyncExternalStore } from 'react';
import { selectedIn, versionStore, type VersionState, type StylizeVersion } from '../../../../../state/stylize-versions';

export function useStylizeVersions(): { state: VersionState; selected: StylizeVersion | null } {
  const state = useSyncExternalStore(versionStore.subscribe, versionStore.getState, versionStore.getState);
  return { state, selected: selectedIn(state) };
}
