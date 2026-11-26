/** Zustand bridge from the append-only session log and its in-flight stream to React. */
import { create, type StoreApi, type UseBoundStore } from 'zustand';
import { createLog, subscribe, type SessionLog } from '../core/log';
import { isJobActive } from '../core/job-reads';
import { deriveView, type PanelView, type ProjectionFacts } from '../core/project-view';
import { jobOwnsMap } from '../core/view-types';
import type { ChildProgress, Part } from '../core/types';
import { eraseRecords } from './erase-records';
import {
  clearMarks, loadLog, loadMarks, NO_MARKS, saveLog, saveMarks, type StorageHealth,
} from './persist';
import { debouncedWrite } from '../../platform/async/debounced-write';

const SAVE_DEBOUNCE_MS = 500;

interface AgentSessionState {
  log: SessionLog;
  live: readonly Part[] | null;
  /** When the in-flight turn's parts last moved, in epoch ms; 0 before any did, as in a restored session. */
  liveAt: number;
  epoch: number;
  setLive(parts: readonly Part[] | null): void;
  /** Ephemeral delegated-helper progress. It is neither persisted nor folded into the panel log. */
  /** The helpers at work, by the call that started each. */
  childLive: Readonly<Record<string, ChildProgress>>;
  /** Sets or clears one call's helper; a null call clears them all. */
  setChildLive(callId: string | null, p: ChildProgress | null): void;
  /** Storage condition shown to the user. Corruption persists until dismissed or cleared. */
  storageNotice: 'pruned' | 'lost' | 'corrupt' | null;
  /** Unreadable stored bytes retained for the recovery export until the notice is cleared. */
  corruptRaw: string | null;
  dismissStorageNotice(): void;
  /** True until the first append after a log is restored from storage. */
  restored: boolean;
  clearSession(): void;
  /** Settled record IDs filed out of the active job area. */
  filed: ReadonlySet<number>;
  /** Record IDs removed from history; every cleared record is also filed. */
  cleared: ReadonlySet<number>;
  fileAway(orderSeq: number): void;
  clearRecord(orderSeq: number): void;
  /** Erases settled transcripts together, including summaries that may contain them. */
  clearRecords(orderSeqs: readonly number[]): void;
  /** Flushes pending storage and adopts a stored log unless the current log has an active job. */
  hydrate(): void;
  /** The tool facts the projection reads, present once the lazy tool surface has loaded. */
  toolFacts: ProjectionFacts | undefined;
}

// The module-level save and subscription follow whichever log the singleton store adopts.
const save = debouncedWrite<SessionLog>(SAVE_DEBOUNCE_MS, (log) => applyStorageHealth(saveLog(log)));
let unwireLog: (() => void) | undefined;

/* Coalesce token-rate live snapshots to display rate. Log appends flush pending data atomically,
 * while `setLive(null)` clears immediately after the committed assistant event. */
const NO_PENDING = Symbol('no pending live');
let liveFrame: number | undefined;
let pendingLive: readonly Part[] | typeof NO_PENDING = NO_PENDING;
const canAnimate = (): boolean => typeof requestAnimationFrame === 'function';

function cancelPendingLive(): void {
  if (liveFrame !== undefined && canAnimate()) cancelAnimationFrame(liveFrame);
  liveFrame = undefined;
  pendingLive = NO_PENDING;
}

/** Frame coalescing bounds publication; reasoning characters still reach an open transcript. */
function liveDigest(parts: readonly Part[]): string {
  return parts.map((p) => (
    p.kind === 'reasoning' ? `r${p.text.length}`
      : p.kind === 'text' ? `t${p.text.length}`
        : `c${p.callId}:${String(p.argsDone)}`
  )).join('|');
}

/** Takes and clears the pending live snapshot as a Zustand state patch, stamped as a movement. */
function takePendingLive(): { live: readonly Part[]; liveAt: number } | undefined {
  if (pendingLive === NO_PENDING) return undefined;
  const live = pendingLive;
  cancelPendingLive();
  return { live, liveAt: Date.now() };
}

const NO_SEQS: ReadonlySet<number> = new Set();
const NO_HELPERS: Readonly<Record<string, ChildProgress>> = {};

/** Adds a record ID without changing set identity when it is already present. */
function withSeq(set: ReadonlySet<number>, seq: number): ReadonlySet<number> {
  return set.has(seq) ? set : new Set([...set, seq]);
}

/** Installs the tool facts the projection reads once the lazy tool surface has loaded. */
export function setToolFacts(facts: ProjectionFacts | undefined): void {
  if (facts !== useAgentSession.getState().toolFacts) useAgentSession.setState({ toolFacts: facts });
}

/** Updates the storage notice; a successful write clears capacity failures but not corruption. */
function applyStorageHealth(health: StorageHealth): void {
  useAgentSession.setState((s) => (health === 'saved'
    ? (s.storageNotice === 'pruned' || s.storageNotice === 'lost' ? { storageNotice: null } : {})
    : { storageNotice: health }));
}

export const useAgentSession: UseBoundStore<StoreApi<AgentSessionState>> = create<AgentSessionState>((set, get) => {
  /** Replaces the active log subscription. */
  function wire(log: SessionLog): void {
    unwireLog?.();
    unwireLog = subscribe(log, () => {
      save.schedule(log);
      // The first append turns a restored snapshot into a live session.
      set((s) => ({ ...takePendingLive(), epoch: s.epoch + 1, restored: false }));
    });
  }

  function adopt(log: SessionLog): void {
    wire(log);
    cancelPendingLive();
    set({ log, live: null, liveAt: 0, epoch: 0, childLive: NO_HELPERS, restored: false });
  }

  // The initial empty log needs the same render and persistence subscription as an adopted log.
  const bootLog = createLog();
  wire(bootLog);

  return {
    log: bootLog,
    live: null,
    liveAt: 0,
    epoch: 0,
    childLive: NO_HELPERS,
    restored: false,
    filed: NO_SEQS,
    cleared: NO_SEQS,
    toolFacts: undefined,
    fileAway: (orderSeq) => {
      const filed = withSeq(get().filed, orderSeq);
      if (filed === get().filed) return;
      set({ filed });
      saveMarks({ filed: [...filed], cleared: [...get().cleared] });
    },
    clearRecord: (orderSeq) => get().clearRecords([orderSeq]),
    clearRecords: (orderSeqs) => {
      const filed = orderSeqs.reduce(withSeq, get().filed);
      const cleared = orderSeqs.reduce(withSeq, get().cleared);
      if (filed === get().filed && cleared === get().cleared) return;
      save.cancel();
      const previous = get().log;
      const retained = eraseRecords(previous, cleared);
      if (retained !== previous) adopt(retained);
      set({ filed, cleared });
      saveMarks({ filed: [...filed], cleared: [...cleared] });
      applyStorageHealth(saveLog(retained));
    },
    storageNotice: null,
    corruptRaw: null,
    dismissStorageNotice: () => set({ storageNotice: null, corruptRaw: null }),
    // Child progress arrives at tool rate and does not need frame coalescing.
    setChildLive: (callId, p) => set((s) => {
      if (callId === null) return { childLive: NO_HELPERS };
      const { [callId]: _gone, ...rest } = s.childLive;
      return { childLive: p ? { ...rest, [callId]: p } : rest };
    }),
    setLive: (parts) => {
      if (parts === null || !canAnimate()) {
        cancelPendingLive();
        // Clearing the parts is the turn closing, which the log stamps itself.
        set((s) => ({ live: parts, epoch: s.epoch + 1, ...(parts ? { liveAt: Date.now() } : {}) }));
        return;
      }
      pendingLive = parts;
      if (liveFrame !== undefined) return;
      liveFrame = requestAnimationFrame(() => {
        liveFrame = undefined;
        // Keep an equivalent snapshot pending so the next log append can flush it atomically.
        const current = get().live;
        if (pendingLive !== NO_PENDING && current !== null && liveDigest(pendingLive) === liveDigest(current)) return;
        const flushed = takePendingLive();
        if (flushed) set((s) => ({ ...flushed, epoch: s.epoch + 1 }));
      });
    },
    clearSession: () => {
      save.cancel();
      cancelPendingLive();
      const log = createLog();
      adopt(log);
      // A fresh session clears notices and record marks owned by the discarded log.
      clearMarks();
      set({ storageNotice: null, corruptRaw: null, filed: NO_SEQS, cleared: NO_SEQS });
      applyStorageHealth(saveLog(log)); // Persist the empty session immediately.
    },
    hydrate: () => {
      // Flush before adopting another log so a stale debounce cannot overwrite the replacement.
      save.flush();
      // Rehydration cannot replace a log while its job is still appending.
      if (isJobActive(get().log)) return;
      const { log: loaded, corrupt, corruptRaw } = loadLog();
      if (corrupt) set({ storageNotice: 'corrupt', corruptRaw: corruptRaw ?? null });
      // Record marks are valid only with the log whose order sequence they reference.
      if (!loaded) clearMarks();
      const marks = loaded ? loadMarks() : NO_MARKS;
      // A stored cleared mark erases its record's provider context as well as hiding it.
      const retained = loaded ? eraseRecords(loaded, new Set(marks.cleared)) : createLog();
      adopt(retained);
      if (loaded && retained !== loaded) applyStorageHealth(saveLog(retained));
      // Only a log read from storage begins in the restored state.
      set({ filed: new Set(marks.filed), cleared: new Set(marks.cleared), restored: loaded !== null });
    },
  };
});

interface PanelViewCacheEntry {
  epoch: number;
  live: readonly Part[] | null;
  facts: ProjectionFacts | undefined;
  view: PanelView;
}

// Cache by log instance and every deriveView input that can change its result.
const cache = new WeakMap<SessionLog, PanelViewCacheEntry>();

/** Returns the shared cached panel projection for the current store inputs. */
export function panelView(state: AgentSessionState): PanelView {
  const entry = cache.get(state.log);
  const facts = state.toolFacts;
  if (entry && entry.epoch === state.epoch && entry.live === state.live && entry.facts === facts) {
    return entry.view;
  }
  const view = deriveView(state.log, { live: state.live ?? undefined, facts });
  cache.set(state.log, { epoch: state.epoch, live: state.live, facts, view });
  return view;
}

/** Whether an assistant job is live in `state`. A log restored from storage has no job behind it. */
export function jobRunningIn(state: AgentSessionState): boolean {
  return !state.restored && jobOwnsMap(panelView(state).phase);
}
