/**
 * The zustand bridge from the append-only session log to React: a thin store holding the live
 * `SessionLog`, the in-flight streaming `Part`s (not yet committed as an `assistant` event) and an
 * `epoch` bumped on every log append or live update, so a selector keying on `epoch` re-renders
 * exactly when the panel's view of the world could have changed.
 */
import { create, type StoreApi, type UseBoundStore } from 'zustand';
import { createLog, subscribe, type SessionLog } from '../core/log';
import { isJobActive } from '../core/loop';
import { deriveView, type PanelView } from '../core/project-view';
import type { Part } from '../core/types';
import {
  clearMarks, loadLog, loadMarks, NO_MARKS, saveLog, saveMarks, type StorageHealth,
} from './persist';

const SAVE_DEBOUNCE_MS = 500;

export interface AgentSessionState {
  log: SessionLog;
  live: readonly Part[] | null;
  epoch: number;
  setLive(parts: readonly Part[] | null): void;
  /** The helper lane's live view of a `delegate_task` child, set from `executor.ts`'s
   *  `onChildProgress` hook (via the runner) as the child works; null whenever no delegate call
   *  is in flight. Deliberately OUTSIDE the log/epoch/panelView fold: a reload has no live child
   *  to show, and this field must never make it into anything a reload could replay. */
  childLive: { task: string; opName?: string; ops: number; label?: string } | null;
  setChildLive(p: { task: string; opName?: string; ops: number; label?: string } | null): void;
  /** The storage banner's producer: `'pruned'`/`'lost'` come from a debounced/flushed
   *  `saveLog` that had to prune or gave up entirely; `'corrupt'` comes from `hydrate` finding
   *  bytes that existed but did not deserialize. A later `'saved'` clears a pruned/lost notice
   *  automatically (the very next save proves storage works again), but `'corrupt'` does NOT
   *  auto-clear on any save: the corrupt bytes are already gone (replaced by a fresh log), so a
   *  save succeeding says nothing about whether the discard was noticed. Only
   *  `dismissStorageNotice` or a fresh `clearSession` clears it. */
  storageNotice: 'pruned' | 'lost' | 'corrupt' | null;
  /** The bytes a `'corrupt'` notice is ABOUT, held for the one press that writes them out for a bug
   *  report. They are gone from storage the moment the fresh log saves over them, so the notice
   *  would otherwise offer to export evidence it no longer has. Cleared with the notice. */
  corruptRaw: string | null;
  dismissStorageNotice(): void;
  /**
   * THE LOG CAME BACK FROM STORAGE AND NOTHING HAS HAPPENED TO IT SINCE.
   *
   * It is the only thing that tells a RESTORED hold apart from a live one, and the two are different
   * screens: a session the user paused a minute ago is a run they are standing inside (the ticket,
   * its ops, its held tape), while a session that came back holding one is an OFFER — here is what
   * was under way, resume it or put it away. The log cannot answer this, and rightly: a paused job
   * is a paused job whichever page it was paused in.
   *
   * Cleared by the FIRST append, which is the moment the session stops being what was read back —
   * so a job resumed and paused again in this page wears the live face, not the offer.
   */
  restored: boolean;
  clearSession(): void;
  /** The settled records the user has put away, by `orderSeq` — the card is off the job zone and
   *  the record stands in the history. Persisted BESIDE the log (`persist.ts:RecordMarks`): whether
   *  a card has been dismissed is not a fact the model or the record is folded from, so it is not an
   *  event. Every leave verb in the panel writes through `fileAway`. */
  filed: ReadonlySet<number>;
  /** The records the user has removed outright. A cleared record is `filed` too (there is no card
   *  left for it to stand as), so a reader asking either question asks one set. */
  cleared: ReadonlySet<number>;
  fileAway(orderSeq: number): void;
  clearRecord(orderSeq: number): void;
  /** Boot/cold-panel operation: flushes any pending save, then adopts `loadLog() ?? createLog()`
   *  UNLESS a job is currently active on the live log, in which case it no-ops and keeps the
   *  current log adopted — a re-mount must never clobber a session a live `runJob` is still
   *  appending to with a stale copy re-read from storage (which would also pick up a bogus
   *  synthetic `paused` tail from `loadLog`, split-braining the two). */
  hydrate(): void;
}

// One debounce timer and one log subscription for the store's lifetime (the store is a module
// singleton): `hydrate`/`clearSession` replace `log` and must re-wire onto the new instance rather
// than accumulate a listener per call.
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let unwireLog: (() => void) | undefined;

function cancelPendingSave(): void {
  if (saveTimer !== undefined) {
    clearTimeout(saveTimer);
    saveTimer = undefined;
  }
}

/* A STREAMING TURN CALLS `setLive` PER DELTA, and every epoch bump re-folds the whole log for every
 * reader, so the unbounded version of this costs token-rate x log-length. Coalescing an INCOMING
 * snapshot to one bump per animation frame makes it cost display-rate instead. Two rules keep the
 * coalesced value from ever being read beside a log that has moved past it: any append flushes what
 * is pending in the SAME `set` (`wire`), and the CLEAR (`setLive(null)`) is never deferred — it
 * lands right behind the `assistant` append that ends a turn, which is the one moment a stale
 * snapshot would be rendered on top of the event holding the same words. A background tab runs no
 * frames, so a pending snapshot there waits for the next append; nothing is reading it either. */
const NO_PENDING = Symbol('no pending live');
let liveFrame: number | undefined;
let pendingLive: readonly Part[] | typeof NO_PENDING = NO_PENDING;
const canAnimate = (): boolean => typeof requestAnimationFrame === 'function';

function cancelPendingLive(): void {
  if (liveFrame !== undefined && canAnimate()) cancelAnimationFrame(liveFrame);
  liveFrame = undefined;
  pendingLive = NO_PENDING;
}

/* A REASONING STREAM CHANGES NOTHING ON SCREEN FOR MOST OF ITS LENGTH, and one bump per frame is
 * still one full re-fold of the log per frame for every reader — for as long as the model thinks,
 * which on a reasoning model is the bulk of a turn. `liveDigest` is what a snapshot MEANS to the
 * view: the words said so far, the calls opened and whether their args have closed, and reasoning
 * only to 256-character BUCKETS, since no reader shows a thought's exact length (the "thought for"
 * reading is a rounded count). A frame whose digest matches what the store already holds publishes
 * nothing. */
const REASONING_BUCKET_BITS = 8;

function liveDigest(parts: readonly Part[]): string {
  return parts.map((p) => (
    p.kind === 'reasoning' ? `r${p.text.length >> REASONING_BUCKET_BITS}`
      : p.kind === 'text' ? `t${p.text.length}`
        : `c${p.callId}:${String(p.argsDone)}`
  )).join('|');
}

/** The coalesced snapshot as a state patch, or `undefined` for nothing owed. Clears the pending
 *  slot, so a second call in the same tick reports nothing twice. */
function takePendingLive(): { live: readonly Part[] } | undefined {
  if (pendingLive === NO_PENDING) return undefined;
  const live = pendingLive;
  cancelPendingLive();
  return { live };
}

const NO_SEQS: ReadonlySet<number> = new Set();

/** A seq added to one of the two mark sets, or the SAME set back where it is already in it: a leave
 *  verb pressed twice is one answer, and a fresh Set would re-render every reader for nothing. */
function withSeq(set: ReadonlySet<number>, seq: number): ReadonlySet<number> {
  return set.has(seq) ? set : new Set([...set, seq]);
}

const NO_READ_TOOLS: ReadonlySet<string> = new Set();
let readTools: ReadonlySet<string> = NO_READ_TOOLS;

/** The panel chunk names the tools that only LOOK at the map, once, as it loads.
 *
 *  It is a MODULE fact rather than a `panelView` argument because the two readers must fold the log
 *  the SAME way to share one cached view, and the EAGER reader cannot name the set: the character
 *  poses off the session whether or not the panel is open, and the set derives from the tool
 *  schemas, which live behind the lazy boundary the character stands outside of. Until the panel
 *  loads it is empty, which only means an op row nobody is rendering yet would not be dimmed. */
export function setReadTools(names: ReadonlySet<string>): void {
  if (names === readTools) return;
  readTools = names;
  useAgentSession.setState((s) => ({ epoch: s.epoch + 1 }));
}

/** Folds a `saveLog` result into `storageNotice`: a `'saved'` clears a standing pruned/lost
 *  notice (the write just proved storage works again) but never touches a standing `'corrupt'`
 *  one (see the field's own doc), and a failure health simply becomes the notice. */
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
  /** Subscribes the store to a log's appends. Separate from `adopt` so the BOOT log can be wired
   *  in the initializer below, where calling `set` is not yet allowed. */
  function wire(log: SessionLog): void {
    unwireLog?.();
    unwireLog = subscribe(log, () => {
      scheduleSave(log);
      // `restored` falls on the first append: from here the session is no longer what was read back.
      set((s) => ({ ...takePendingLive(), epoch: s.epoch + 1, restored: false }));
    });
  }

  function adopt(log: SessionLog): void {
    wire(log);
    cancelPendingLive();
    set({ log, live: null, epoch: 0, childLive: null, restored: false });
  }

  // THE BOOT LOG IS WIRED HERE AND NOT BY `hydrate`. A session belongs to a map, so the app reads
  // one back only when a map is restored (App.tsx) — every other launch starts on the log created
  // right here, and until it carries the subscription an append reaches nobody: no `epoch` bump, so
  // the panel never re-renders while a job runs, and no `scheduleSave`, so the session is never
  // written and there is nothing for the next launch to restore either.
  const bootLog = createLog();
  wire(bootLog);

  // A save armed by an append and still waiting out its debounce is neither in storage nor
  // gone: it is owed to whichever log the timer captured (the one currently adopted, since
  // nothing re-adopts without going through here). Flushing it synchronously before hydrate
  // re-reads storage is what keeps hydrate from losing the append (the read would otherwise
  // race the debounce) and from leaving a stale timer that would later ghost-write the
  // discarded log's content over whatever the newly adopted log saves in the meantime.
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
    clearRecord: (orderSeq) => {
      const filed = withSeq(get().filed, orderSeq);
      const cleared = withSeq(get().cleared, orderSeq);
      if (filed === get().filed && cleared === get().cleared) return;
      set({ filed, cleared });
      saveMarks({ filed: [...filed], cleared: [...cleared] });
    },
    storageNotice: null,
    corruptRaw: null,
    dismissStorageNotice: () => set({ storageNotice: null, corruptRaw: null }),
    // A plain, uncoalesced field: a `delegate_task` call appends to the CHILD's own log at tool
    // rate, not token rate, so there is no reasoning-stream volume here to bound with a frame
    // gate the way `setLive` does.
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
        // A snapshot that reads the same as the one already published is LEFT STANDING rather than
        // dropped: skipping the `set` saves the re-fold, and leaving it pending keeps the rule that
        // an append flushes whatever is owed in its own update, so the log and the live parts are
        // never a frame out of step.
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
      // An explicit fresh start clears whatever notice the PREVIOUS session left standing (a
      // 'corrupt' one never auto-clears on a save, so nothing else would ever reset it here) — and
      // the leave marks with it: they name order seqs in the log being discarded, so carried over
      // they would put away the FIRST record of the new session.
      clearMarks();
      set({ storageNotice: null, corruptRaw: null, filed: NO_SEQS, cleared: NO_SEQS });
      applyStorageHealth(saveLog(log)); // immediate: an emptied session is not left riding the debounce window.
    },
    hydrate: () => {
      flushPendingSave();
      // A live job keeps appending to the CURRENT log after this call; re-adopting a copy
      // freshly re-read from storage would orphan that live log (still being written to, never
      // saved again) while the panel showed a stale, split-brained stand-in. Single-tab
      // assumption: this guards a re-mount racing a live session, not two tabs sharing storage.
      if (isJobActive(get().log)) return;
      const { log: loaded, corrupt, corruptRaw } = loadLog();
      if (corrupt) set({ storageNotice: 'corrupt', corruptRaw: corruptRaw ?? null });
      // `adopt`'s own `set` is a partial merge, so the notice just set above (or one already
      // standing from a prior failed save) survives it rather than being wiped by this reload.
      adopt(loaded ?? createLog());
      // The marks come back only WITH the log they were made against. An envelope that did not
      // return (absent, or a version this build cannot read) leaves a fresh log whose order seqs
      // start over, and a mark against seq 1 would then put away a record nobody has seen.
      if (!loaded) clearMarks();
      const marks = loaded ? loadMarks() : NO_MARKS;
      // ADOPTED FROM STORAGE, which `adopt` has just set false: only a log that actually came back
      // is restored, so a hydrate that found nothing leaves the fresh log reading live.
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

// Keyed on the log instance so a fresh log (hydrate/clearSession) never reads a stale entry; within
// one log, (epoch, live, readTools) identity is the full recompute key per the derivation's own
// inputs, so unchanged inputs return the SAME PanelView object.
const cache = new WeakMap<SessionLog, PanelViewCacheEntry>();

/** The ONE fold of the log every reader shares. Both callers (the panel column and the character's
 *  host) take the same object for the same inputs, so a streaming delta folds the log once rather
 *  than once per reader, and a selector keyed on it does not churn between renders. */
export function panelView(state: AgentSessionState): PanelView {
  const entry = cache.get(state.log);
  if (entry && entry.epoch === state.epoch && entry.live === state.live && entry.readTools === readTools) {
    return entry.view;
  }
  const view = deriveView(state.log, { live: state.live ?? undefined, readTools });
  cache.set(state.log, { epoch: state.epoch, live: state.live, readTools, view });
  return view;
}
