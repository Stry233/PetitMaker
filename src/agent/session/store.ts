/** Zustand bridge from the append-only session log and its in-flight stream to React. */
import { create, type StoreApi, type UseBoundStore } from 'zustand';
import { createLog, subscribe, type SessionLog } from '../core/log';
import { isJobActive } from '../core/loop';
import { deriveView, type PanelView } from '../core/project-view';
import type { Part } from '../core/types';
import { eraseRecords } from './erase-records';
import {
  clearMarks, loadLog, loadMarks, NO_MARKS, saveLog, saveMarks, type StorageHealth,
} from './persist';

const SAVE_DEBOUNCE_MS = 500;

export interface AgentSessionState {
  log: SessionLog;
  live: readonly Part[] | null;
  epoch: number;
  setLive(parts: readonly Part[] | null): void;
  /** Ephemeral delegated-helper progress. It is neither persisted nor folded into the panel log. */
  childLive: { task: string; opName?: string; ops: number; label?: string } | null;
  setChildLive(p: { task: string; opName?: string; ops: number; label?: string } | null): void;
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
}

// The module-level timer and subscription follow whichever log the singleton store adopts.
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let unwireLog: (() => void) | undefined;

function cancelPendingSave(): void {
  if (saveTimer !== undefined) {
    clearTimeout(saveTimer);
    saveTimer = undefined;
  }
}

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

/* The live digest tracks display-relevant changes and buckets reasoning into 256-character steps. */
const REASONING_BUCKET_BITS = 8;

function liveDigest(parts: readonly Part[]): string {
  return parts.map((p) => (
    p.kind === 'reasoning' ? `r${p.text.length >> REASONING_BUCKET_BITS}`
      : p.kind === 'text' ? `t${p.text.length}`
        : `c${p.callId}:${String(p.argsDone)}`
  )).join('|');
}

/** Takes and clears the pending live snapshot as a Zustand state patch. */
function takePendingLive(): { live: readonly Part[] } | undefined {
  if (pendingLive === NO_PENDING) return undefined;
  const live = pendingLive;
  cancelPendingLive();
  return { live };
}

const NO_SEQS: ReadonlySet<number> = new Set();

/** Adds a record ID without changing set identity when it is already present. */
function withSeq(set: ReadonlySet<number>, seq: number): ReadonlySet<number> {
  return set.has(seq) ? set : new Set([...set, seq]);
}

const NO_READ_TOOLS: ReadonlySet<string> = new Set();
let readTools: ReadonlySet<string> = NO_READ_TOOLS;

/** Installs the read-only tool names once the lazy panel schema has loaded. */
export function setReadTools(names: ReadonlySet<string>): void {
  if (names === readTools) return;
  readTools = names;
  useAgentSession.setState((s) => ({ epoch: s.epoch + 1 }));
}

/** Updates the storage notice; a successful write clears capacity failures but not corruption. */
function applyStorageHealth(health: StorageHealth): void {
  useAgentSession.setState((s) => (health === 'saved'
    ? (s.storageNotice === 'pruned' || s.storageNotice === 'lost' ? { storageNotice: null } : {})
    : { storageNotice: health }));
}

function scheduleSave(log: SessionLog): void {
  cancelPendingSave();
  saveTimer = setTimeout(() => {
    saveTimer = undefined;
    applyStorageHealth(saveLog(log));
  }, SAVE_DEBOUNCE_MS);
}

export const useAgentSession: UseBoundStore<StoreApi<AgentSessionState>> = create<AgentSessionState>((set, get) => {
  /** Replaces the active log subscription. */
  function wire(log: SessionLog): void {
    unwireLog?.();
    unwireLog = subscribe(log, () => {
      scheduleSave(log);
      // The first append turns a restored snapshot into a live session.
      set((s) => ({ ...takePendingLive(), epoch: s.epoch + 1, restored: false }));
    });
  }

  function adopt(log: SessionLog): void {
    wire(log);
    cancelPendingLive();
    set({ log, live: null, epoch: 0, childLive: null, restored: false });
  }

  // The initial empty log needs the same render and persistence subscription as an adopted log.
  const bootLog = createLog();
  wire(bootLog);

  // Flush before adopting another log so a stale debounce cannot overwrite the replacement.
  function flushPendingSave(): void {
    if (saveTimer === undefined) return;
    cancelPendingSave();
    applyStorageHealth(saveLog(get().log));
  }

  return {
    log: bootLog,
    live: null,
    epoch: 0,
    childLive: null,
    restored: false,
    filed: NO_SEQS,
    cleared: NO_SEQS,
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
      cancelPendingSave();
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
    setChildLive: (p) => set({ childLive: p }),
    setLive: (parts) => {
      if (parts === null || !canAnimate()) {
        cancelPendingLive();
        set((s) => ({ live: parts, epoch: s.epoch + 1 }));
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
      cancelPendingSave();
      cancelPendingLive();
      const log = createLog();
      adopt(log);
      // A fresh session clears notices and record marks owned by the discarded log.
      clearMarks();
      set({ storageNotice: null, corruptRaw: null, filed: NO_SEQS, cleared: NO_SEQS });
      applyStorageHealth(saveLog(log)); // Persist the empty session immediately.
    },
    hydrate: () => {
      flushPendingSave();
      // Rehydration cannot replace a log while its job is still appending.
      if (isJobActive(get().log)) return;
      const { log: loaded, corrupt, corruptRaw } = loadLog();
      if (corrupt) set({ storageNotice: 'corrupt', corruptRaw: corruptRaw ?? null });
      // Record marks are valid only with the log whose order sequence they reference.
      if (!loaded) clearMarks();
      const marks = loaded ? loadMarks() : NO_MARKS;
      // Older releases hid cleared records without erasing their provider context.
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
  readTools: ReadonlySet<string>;
  view: PanelView;
}

// Cache by log instance and every deriveView input that can change its result.
const cache = new WeakMap<SessionLog, PanelViewCacheEntry>();

/** Returns the shared cached panel projection for the current store inputs. */
export function panelView(state: AgentSessionState): PanelView {
  const entry = cache.get(state.log);
  if (entry && entry.epoch === state.epoch && entry.live === state.live && entry.readTools === readTools) {
    return entry.view;
  }
  const view = deriveView(state.log, { live: state.live ?? undefined, readTools });
  cache.set(state.log, { epoch: state.epoch, live: state.live, readTools, view });
  return view;
}
