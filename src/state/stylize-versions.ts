// The session's illustration takes, never persisted. A map edit retires every take captured before
// it; React observes the store through useSyncExternalStore, and the illustration studio writes it.
import type { EventBus } from '../core/commands/event-bus';
import type { EditorEvents } from './editing/events';
import { onMapEdited } from '../core/commands/map-edits';
import type { StylizeDirection } from '../pipelines/stylize';
import { createSignal } from '../core/base/signal';

/** What produced a version's pixels. `model` covers provider and on-device neural output and
 *  receives the AI disclosure when composed; `proc` is drawn by a non-neural local procedure. */
export type VersionKind = 'model' | 'proc';

export interface StylizeVersion {
  id: string;
  no: number;
  kind: VersionKind;
  direction: StylizeDirection;
  prompt?: string;
  /** Session-only pixels, never persisted. */
  image: HTMLImageElement | ImageBitmap;
  /** Map-edit counter at capture time. */
  mapEdit: number;
  /** Local-pack variation seed index; absent from provider-backed takes. */
  roll?: number;
}

export interface VersionState {
  versions: StylizeVersion[];
  selectedId: string | null;
  running: boolean;
}

function emptyState(): VersionState {
  return { versions: [], selectedId: null, running: false };
}

// The one page-wide shelf: the takes, the mint count their ids and numbers come from, and the
// map-edit count a take is checked against.
let state: VersionState = emptyState();
let mintCounter = 0;
let mapEdit = 0;
const changed = createSignal();

function setState(next: VersionState): void {
  state = next;
  changed.emit();
}

/** Remove takes captured from an older map state and clear a stale selection. */
function invalidateStale(): void {
  const versions = state.versions.filter((v) => v.mapEdit === mapEdit);
  const selectedId = state.selectedId && versions.some((v) => v.id === state.selectedId) ? state.selectedId : null;
  setState({ ...state, versions, selectedId });
}

/** The picture's address, for an image the shelf can show by URL; null for another source. */
export function versionSrc(version: StylizeVersion): string | null {
  const image = version.image as { src?: unknown };
  return typeof image.src === 'string' ? image.src : null;
}

/** The version `state` has selected, or null while the original map is chosen. */
export function selectedIn(state: VersionState): StylizeVersion | null {
  return state.selectedId ? (state.versions.find((v) => v.id === state.selectedId) ?? null) : null;
}

/** The selected version, read imperatively by the export and review paths. */
export function selectedVersion(): StylizeVersion | null {
  return selectedIn(state);
}

export const versionStore = {
  getState(): VersionState {
    return state;
  },
  subscribe(fn: () => void): () => void {
    return changed.subscribe(fn);
  },
  /** Reject a take if the map changed while it was being generated. */
  mint(v: Omit<StylizeVersion, 'id' | 'no'>): StylizeVersion | null {
    if (v.mapEdit !== mapEdit) return null;
    mintCounter += 1;
    const version: StylizeVersion = { ...v, id: `v${mintCounter}`, no: mintCounter };
    setState({ ...state, versions: [...state.versions, version], selectedId: version.id });
    return version;
  },
  select(id: string | null): void {
    setState({ ...state, selectedId: id });
  },
  retire(id: string): void {
    const versions = state.versions.filter((v) => v.id !== id);
    const selectedId = state.selectedId === id ? null : state.selectedId;
    setState({ ...state, versions, selectedId });
  },
  setRunning(running: boolean): void {
    setState({ ...state, running });
  },
  reset(): void {
    mintCounter = 0;
    mapEdit = 0;
    setState(emptyState());
  },
  currentMapEdit(): number {
    return mapEdit;
  },
  bindMapEvents(bus: EventBus<EditorEvents>): () => void {
    return onMapEdited(bus, () => {
      mapEdit += 1;
      invalidateStale();
    });
  },
};
