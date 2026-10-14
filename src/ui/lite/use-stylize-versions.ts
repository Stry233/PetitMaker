import type { StylizeVersion, VersionState } from '../../state/stylize-versions';

const state: VersionState = { versions: [], selectedId: null, running: false };
export function useStylizeVersions(): { state: VersionState; selected: StylizeVersion | null } {
  return { state, selected: null };
}
