// Session-only illustration takes. Map edits invalidate them; React observes the store through
// useSyncExternalStore while the generation engine writes to it directly.
import type { EventBus } from '../../core/commands/event-bus';
import type { EditorEvents } from '../../core/model/types';
import type { DirectionId } from './presets';
import type { ProcPackId } from './proc/packs/manifest';

/** What produced a version's pixels. `model` covers provider and on-device neural output and
 *  receives the AI disclosure when composed; `proc` is drawn by a non-neural local procedure. */
export type VersionKind = 'model' | 'proc';

/** Everything a version can be drawn in: a provider direction, the user's own prompt, or a
 *  procedural pack drawn on this machine. */
export type StylizeDirection = DirectionId | ProcPackId;

export interface StylizeVersion {
  id: string;
  no: number;
  kind: VersionKind;
  direction: StylizeDirection;
  prompt?: string;
  /** Session-only pixels, never persisted. */
  image: HTMLImageElement | ImageBitmap;
  /** Map-edit counter at capture time. */
  fingerprint: number;
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

let state: VersionState = emptyState();
let mintCounter = 0;
let fingerprint = 0;
const listeners = new Set<() => void>();

function setState(next: VersionState): void {
  state = next;
  for (const l of [...listeners]) l();
}

/** Remove takes captured from an older map state and clear a stale selection. */
function invalidateStale(): void {
  const versions = state.versions.filter((v) => v.fingerprint === fingerprint);
  const selectedId = state.selectedId && versions.some((v) => v.id === state.selectedId) ? state.selectedId : null;
  setState({ ...state, versions, selectedId });
}

export const versionStore = {
  getState(): VersionState {
    return state;
  },
  subscribe(fn: () => void): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  /** Reject a take if the map changed while it was being generated. */
  mint(v: Omit<StylizeVersion, 'id' | 'no'>): StylizeVersion | null {
    if (v.fingerprint !== fingerprint) return null;
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
    fingerprint = 0;
    setState(emptyState());
  },
  currentFingerprint(): number {
    return fingerprint;
  },
  bindMapEvents(bus: EventBus<EditorEvents>): () => void {
    const bump = () => {
      fingerprint += 1;
      invalidateStale();
    };
    bus.on('cells-changed', bump);
    bus.on('objects-changed', bump);
    bus.on('history-applied', bump);
    return () => {
      bus.off('cells-changed', bump);
      bus.off('objects-changed', bump);
      bus.off('history-applied', bump);
    };
  },
};
