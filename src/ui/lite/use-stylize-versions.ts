import type { StylizeVersion, VersionState } from '../../io/stylize';

const state: VersionState = { versions: [], selectedId: null, running: false };
export function useStylizeVersions(): { state: VersionState; selected: StylizeVersion | null } {
  return { state, selected: null };
}
export function selectedVersion(): StylizeVersion | null { return null; }
