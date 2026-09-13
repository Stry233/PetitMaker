import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { append } from '../../../agent/core/log';
import type { Part } from '../../../agent/core/types';
import { panelView, setReadTools, useAgentSession } from '../../../agent/session/store';
import { PREFS } from '../../../core/runtime/prefs';

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
  // The store is a module singleton (like useAgentStore), so a test that leaves an order
  // appended with no jobEnd/incident would otherwise carry an "active job" into the next test —
  // and hydrate() deliberately no-ops on an active job, so it cannot be relied on alone to reset
  // between tests. clearSession() bypasses that guard on purpose (it is an
  // explicit fresh start, never a re-mount) and always lands a clean, unwired-then-rewired log.
  useAgentSession.getState().clearSession();
});

afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
});

/** One 60fps frame, enough for the fake clock to run a queued `requestAnimationFrame`. */
const FRAME_MS = 20;

describe('the log the store BOOTS on', () => {
  /**
   * THE BOOT LOG CARRIES THE SUBSCRIPTION, and nothing has to ask for it. A session belongs to a
   * map, so the app calls `hydrate()` only when a map is RESTORED — every other launch runs on the
   * log the store made for itself, and were that one unwired an append would reach nobody: no epoch
   * bump, so the panel never re-renders while a job runs, and no debounced save, so the session is
   * never written and there is nothing to restore next time either.
   *
   * A fresh MODULE is the only way to see that state: the suite's own `clearSession()` re-adopts,
   * which masks it.
   */
  it('bumps the epoch on an append with no hydrate() ever called', async () => {
    vi.resetModules();
    const fresh = await import('../../../agent/session/store');
    const before = fresh.useAgentSession.getState().epoch;
    append(fresh.useAgentSession.getState().log, { kind: 'steer', text: 'go' });
    expect(fresh.useAgentSession.getState().epoch).toBe(before + 1);
  });

  it('saves the boot session, so the next launch has one to restore', async () => {
    vi.resetModules();
    const fresh = await import('../../../agent/session/store');
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    append(fresh.useAgentSession.getState().log, { kind: 'order', text: 'build', mapContext: '' });
    vi.advanceTimersByTime(600);
    expect(setItem).toHaveBeenCalled();
    setItem.mockRestore();
  });
});

describe('agent session store', () => {
  it('hydrates an empty log and wires the subscription exactly once across a double hydrate', () => {
    useAgentSession.getState().hydrate();
    expect(useAgentSession.getState().log.events).toHaveLength(0);

    useAgentSession.getState().hydrate();
    useAgentSession.getState().hydrate();

    const epochBefore = useAgentSession.getState().epoch;
    append(useAgentSession.getState().log, { kind: 'steer', text: 'go' });
    expect(useAgentSession.getState().epoch).toBe(epochBefore + 1);
  });

  it('debounces the save: three rapid appends write storage exactly once after 500ms+', () => {
    useAgentSession.getState().hydrate();
    const setItem = vi.spyOn(Storage.prototype, 'setItem');

    append(useAgentSession.getState().log, { kind: 'order', text: 'build', mapContext: 'ctx' });
    append(useAgentSession.getState().log, { kind: 'steer', text: 'faster' });
    append(useAgentSession.getState().log, { kind: 'steer', text: 'faster still' });

    expect(setItem).not.toHaveBeenCalled();
    vi.advanceTimersByTime(600);
    expect(setItem.mock.calls.filter(([k]) => k === PREFS.agentLogV3.key)).toHaveLength(1);
  });

  it('setLive publishes on the next frame, and panelView then reflects streaming', () => {
    useAgentSession.getState().hydrate();
    append(useAgentSession.getState().log, { kind: 'order', text: 'build', mapContext: 'ctx' });
    const epochBefore = useAgentSession.getState().epoch;

    const live: readonly Part[] = [{ kind: 'text', text: 'working on it', done: false }];
    useAgentSession.getState().setLive(live);
    vi.advanceTimersByTime(FRAME_MS);

    expect(useAgentSession.getState().epoch).toBe(epochBefore + 1);
    const view = panelView(useAgentSession.getState());
    expect(view.phase).toBe('streaming');
  });

  it('panelView memoizes: same (log, epoch, live) inputs return the identical object', () => {
    useAgentSession.getState().hydrate();
    append(useAgentSession.getState().log, { kind: 'order', text: 'build', mapContext: 'ctx' });

    const state = useAgentSession.getState();
    const first = panelView(state);
    const second = panelView(state);
    expect(second).toBe(first);
  });

  /**
   * A STREAMING DELTA COSTS A FULL RE-FOLD OF THE LOG, for every reader, so an epoch per delta
   * makes the panel cost token-rate x log-length. These hold the coalescing that bounds it to the
   * display's own rate, and the two escapes that keep the coalesced value from ever being read
   * beside a log that has already moved past it.
   */
  describe('setLive is coalesced to one epoch per frame', () => {
    it('many deltas in one frame publish once, with the LAST snapshot', () => {
      useAgentSession.getState().hydrate();
      append(useAgentSession.getState().log, { kind: 'order', text: 'build', mapContext: 'ctx' });
      const epochBefore = useAgentSession.getState().epoch;

      for (const text of ['w', 'wo', 'wor', 'work']) {
        useAgentSession.getState().setLive([{ kind: 'text', text, done: false }]);
      }
      expect(useAgentSession.getState().epoch).toBe(epochBefore);

      vi.advanceTimersByTime(FRAME_MS);
      expect(useAgentSession.getState().epoch).toBe(epochBefore + 1);
      expect(useAgentSession.getState().live).toEqual([{ kind: 'text', text: 'work', done: false }]);
    });

    it('an append FLUSHES what is pending in the same update, so the log and the live parts are never a frame out of step', () => {
      useAgentSession.getState().hydrate();
      const log = useAgentSession.getState().log;
      append(log, { kind: 'order', text: 'build', mapContext: 'ctx' });

      useAgentSession.getState().setLive([{ kind: 'text', text: 'half a sen', done: false }]);
      append(log, { kind: 'toolResult', callId: 'c1', name: 'paint_terrain', content: 'ok', isError: false });

      expect(useAgentSession.getState().live).toEqual([{ kind: 'text', text: 'half a sen', done: false }]);

      // And nothing is owed afterwards: the frame that would have published it finds it taken.
      const epochAfterAppend = useAgentSession.getState().epoch;
      vi.advanceTimersByTime(FRAME_MS);
      expect(useAgentSession.getState().epoch).toBe(epochAfterAppend);
    });

    it('the CLEAR is never deferred: it lands in the same tick as the assistant append that ends a turn', () => {
      useAgentSession.getState().hydrate();
      const log = useAgentSession.getState().log;
      append(log, { kind: 'order', text: 'build', mapContext: 'ctx' });
      useAgentSession.getState().setLive([{ kind: 'text', text: 'said it', done: true }]);

      append(log, { kind: 'assistant', parts: [{ kind: 'text', text: 'said it', done: true }], stop: 'stop' });
      useAgentSession.getState().setLive(null);

      expect(useAgentSession.getState().live).toBeNull();
      expect(panelView(useAgentSession.getState()).phase).not.toBe('streaming');
    });

    it('the read-tool set is a store fact, so the panel and the character share ONE fold', () => {
      useAgentSession.getState().hydrate();
      append(useAgentSession.getState().log, { kind: 'order', text: 'build', mapContext: 'ctx' });

      // Two readers, no argument between them: the same call answers both.
      expect(panelView(useAgentSession.getState())).toBe(panelView(useAgentSession.getState()));

      // Publishing the set (what the panel chunk does as it loads) bumps the epoch, so a standing
      // reader re-folds rather than keeping a view built without it.
      const before = useAgentSession.getState().epoch;
      const view = panelView(useAgentSession.getState());
      setReadTools(new Set(['view_map']));
      expect(useAgentSession.getState().epoch).toBe(before + 1);
      expect(panelView(useAgentSession.getState())).not.toBe(view);

      setReadTools(new Set()); // module state: hand the next test back an unpublished set
    });

    /**
     * A THINKING TURN STREAMS FOR AS LONG AS IT LIKES AND CHANGES NOTHING ON SCREEN. Reasoning
     * arrives at token rate and the panel reads a thought only as a rounded count, so a frame that
     * publishes 40 more characters of it re-folds the whole log for every reader to paint the same
     * pixels. These pin the digest gate: a frame publishes only when the snapshot means something
     * different to the view.
     */
    describe('a frame that would change nothing on screen publishes nothing', () => {
      // The store is a module singleton, so a listener left behind would outlive its own test.
      const unwire: (() => void)[] = [];
      afterEach(() => {
        while (unwire.length > 0) unwire.pop()?.();
      });

      /** Snapshots the store's own update count, which is what a re-fold hangs off. */
      function countUpdates(): () => number {
        let n = 0;
        unwire.push(useAgentSession.subscribe(() => { n += 1; }));
        return () => n;
      }

      function startTurn(): void {
        useAgentSession.getState().hydrate();
        append(useAgentSession.getState().log, { kind: 'order', text: 'build', mapContext: 'ctx' });
      }

      const thought = (chars: number): readonly Part[] => [{ kind: 'reasoning', text: 'x'.repeat(chars), done: false }];

      it('two thoughts inside the same 256-character bucket publish once', () => {
        startTurn();
        const updates = countUpdates();

        useAgentSession.getState().setLive(thought(100));
        vi.advanceTimersByTime(FRAME_MS);
        expect(updates()).toBe(1);

        useAgentSession.getState().setLive(thought(140));
        vi.advanceTimersByTime(FRAME_MS);
        expect(updates()).toBe(1);
        expect(useAgentSession.getState().live).toEqual(thought(100));
      });

      it('a thought that crosses a bucket boundary does publish', () => {
        startTurn();
        const updates = countUpdates();

        useAgentSession.getState().setLive(thought(100));
        vi.advanceTimersByTime(FRAME_MS);
        useAgentSession.getState().setLive(thought(300));
        vi.advanceTimersByTime(FRAME_MS);

        expect(updates()).toBe(2);
        expect(useAgentSession.getState().live).toEqual(thought(300));
      });

      it('a single character of TEXT always publishes: the words are what the panel shows', () => {
        startTurn();
        const updates = countUpdates();

        useAgentSession.getState().setLive([{ kind: 'text', text: 'Rais', done: false }]);
        vi.advanceTimersByTime(FRAME_MS);
        useAgentSession.getState().setLive([{ kind: 'text', text: 'Raise', done: false }]);
        vi.advanceTimersByTime(FRAME_MS);

        expect(updates()).toBe(2);
      });

      it('a new tool call always publishes, and so does its args closing', () => {
        startTurn();
        const updates = countUpdates();

        useAgentSession.getState().setLive(thought(100));
        vi.advanceTimersByTime(FRAME_MS);
        useAgentSession.getState().setLive([
          ...thought(140),
          { kind: 'tool', callId: 'c1', name: 'paint_terrain', input: {}, argsDone: false },
        ]);
        vi.advanceTimersByTime(FRAME_MS);
        expect(updates()).toBe(2);

        useAgentSession.getState().setLive([
          ...thought(150),
          { kind: 'tool', callId: 'c1', name: 'paint_terrain', input: { x: 1 }, argsDone: true },
        ]);
        vi.advanceTimersByTime(FRAME_MS);
        expect(updates()).toBe(3);
      });

      /** The gate SKIPS a publish, it does not discard a snapshot: the "never read a coalesced
       *  value beside a log that has moved" rule still owns the append. */
      it('an append still takes the snapshot the gate left standing', () => {
        startTurn();
        const log = useAgentSession.getState().log;

        useAgentSession.getState().setLive(thought(100));
        vi.advanceTimersByTime(FRAME_MS);
        useAgentSession.getState().setLive(thought(140));
        vi.advanceTimersByTime(FRAME_MS);
        expect(useAgentSession.getState().live).toEqual(thought(100));

        append(log, { kind: 'toolResult', callId: 'c1', name: 'paint_terrain', content: 'ok', isError: false });
        expect(useAgentSession.getState().live).toEqual(thought(140));
      });

      it('the CLEAR is never deferred or gated, however little the last thought changed', () => {
        startTurn();
        useAgentSession.getState().setLive(thought(100));
        vi.advanceTimersByTime(FRAME_MS);
        useAgentSession.getState().setLive(thought(140));

        useAgentSession.getState().setLive(null);
        expect(useAgentSession.getState().live).toBeNull();

        // And the skipped snapshot is gone with it: no frame revives it behind the clear.
        vi.advanceTimersByTime(FRAME_MS);
        expect(useAgentSession.getState().live).toBeNull();
      });
    });

    it('clearSession drops a pending snapshot rather than letting it land on the fresh log', () => {
      useAgentSession.getState().hydrate();
      append(useAgentSession.getState().log, { kind: 'order', text: 'build', mapContext: 'ctx' });
      useAgentSession.getState().setLive([{ kind: 'text', text: 'mid sentence', done: false }]);

      useAgentSession.getState().clearSession();
      vi.advanceTimersByTime(FRAME_MS);

      expect(useAgentSession.getState().live).toBeNull();
    });
  });

  it('hydrate flushes a pending debounced save before re-reading storage, so nothing is lost or ghost-written', () => {
    useAgentSession.getState().hydrate();
    append(useAgentSession.getState().log, { kind: 'steer', text: 'go' });

    // Re-hydrate well inside the 500ms debounce window.
    useAgentSession.getState().hydrate();

    const reread = (useAgentSession.getState().log.events as { kind: string; text?: string }[])
      .filter((e) => e.kind === 'steer').map((e) => e.text);
    expect(reread).toEqual(['go']);

    // No stale timer from the discarded log survives to ghost-write storage later.
    vi.advanceTimersByTime(1000);
    const stored = JSON.parse(localStorage.getItem(PREFS.agentLogV3.key)!) as { events: { kind: string; text?: string }[] };
    expect(stored.events.filter((e) => e.kind === 'steer').map((e) => e.text)).toEqual(['go']);

    // The re-adopted log still saves normally on its own debounce.
    append(useAgentSession.getState().log, { kind: 'steer', text: 'new one' });
    vi.advanceTimersByTime(600);
    const storedAfter = JSON.parse(localStorage.getItem(PREFS.agentLogV3.key)!) as { events: { kind: string; text?: string }[] };
    expect(storedAfter.events.filter((e) => e.kind === 'steer').map((e) => e.text)).toEqual(['go', 'new one']);
  });

  it('hydrate no-ops while a job is active, keeping the same log adopted (no split-brain, no synthetic paused)', () => {
    useAgentSession.getState().hydrate();
    append(useAgentSession.getState().log, { kind: 'order', text: 'build', mapContext: 'ctx' });
    // No jobEnd/incident: the job is still active. Flush the pending debounced save so hydrate's
    // internal flush has nothing new to do, isolating the no-op behavior under test.
    vi.advanceTimersByTime(600);

    const liveLog = useAgentSession.getState().log;
    useAgentSession.getState().hydrate();

    expect(useAgentSession.getState().log).toBe(liveLog);
    expect(useAgentSession.getState().log.events.some((e) => e.kind === 'paused')).toBe(false);

    // Epoch semantics still hold on the retained log: an append after the no-op hydrate still
    // bumps epoch through the same, still-wired subscription.
    const epochBefore = useAgentSession.getState().epoch;
    append(useAgentSession.getState().log, { kind: 'steer', text: 'go faster' });
    expect(useAgentSession.getState().epoch).toBe(epochBefore + 1);
  });

  it('setChildLive updates childLive, and clearSession resets it to null', () => {
    useAgentSession.getState().hydrate();
    expect(useAgentSession.getState().childLive).toBeNull();

    useAgentSession.getState().setChildLive({ task: 'raise a hill', opName: 'paint_terrain', ops: 2 });
    expect(useAgentSession.getState().childLive).toEqual({ task: 'raise a hill', opName: 'paint_terrain', ops: 2 });

    useAgentSession.getState().clearSession();
    expect(useAgentSession.getState().childLive).toBeNull();
  });

  /**
   * `restored`: THE ONE THING THAT TELLS A HELD JOB THE USER IS STANDING IN FROM ONE THE SESSION WAS
   * FOUND HOLDING.
   *
   * The log cannot answer it — a paused job is a paused job whichever page it was paused in — and the
   * two are different screens, so the fact lives here. It falls on the FIRST append, which is the
   * moment the session stops being what was read back: a job resumed and paused again in this page
   * is a live hold, not an offer.
   */
  describe('restored: the session came back from storage', () => {
    it('is false on a boot log, true after a hydrate that found one, and false again on the first append', () => {
      expect(useAgentSession.getState().restored).toBe(false);

      append(useAgentSession.getState().log, { kind: 'order', text: 'build', mapContext: 'ctx' });
      append(useAgentSession.getState().log, { kind: 'jobEnd', outcome: 'done' });
      vi.advanceTimersByTime(600); // the debounced save

      useAgentSession.getState().hydrate();
      expect(useAgentSession.getState().restored).toBe(true);

      append(useAgentSession.getState().log, { kind: 'order', text: 'more', mapContext: 'ctx' });
      expect(useAgentSession.getState().restored).toBe(false);
    });

    it('stays false where the hydrate found nothing to read back', () => {
      localStorage.clear();
      useAgentSession.getState().hydrate();
      expect(useAgentSession.getState().restored).toBe(false);
    });
  });

  /** The corrupt bytes are handed up and HELD, because the fresh log saves over them within the
   *  second: the notice offers to export the evidence, so the evidence has to outlive the read. */
  it('keeps the unreadable bytes for the notice that is about them, and drops them with it', () => {
    localStorage.setItem(PREFS.agentLogV3.key, '{not json');
    useAgentSession.getState().hydrate();
    expect(useAgentSession.getState().storageNotice).toBe('corrupt');
    expect(useAgentSession.getState().corruptRaw).toBe('{not json');

    useAgentSession.getState().dismissStorageNotice();
    expect(useAgentSession.getState().corruptRaw).toBeNull();
  });

  it('clearSession empties the log, persists immediately, and leaves other keys alone', () => {
    useAgentSession.getState().hydrate();
    append(useAgentSession.getState().log, { kind: 'order', text: 'build', mapContext: 'ctx' });

    localStorage.setItem('some-other-pref', 'kept');

    useAgentSession.getState().clearSession();

    expect(useAgentSession.getState().log.events).toHaveLength(0);
    const stored = JSON.parse(localStorage.getItem(PREFS.agentLogV3.key)!);
    expect(stored.events).toHaveLength(0);
    expect(localStorage.getItem('some-other-pref')).toBe('kept');
  });

  describe('storageNotice: the storage banner\'s producer', () => {
    afterEach(() => vi.restoreAllMocks()); // a permanent setItem mock must not leak into the next test

    it('a debounced save that returns pruned sets storageNotice to pruned', () => {
      useAgentSession.getState().hydrate();
      append(useAgentSession.getState().log, { kind: 'order', text: 'build', mapContext: 'ctx' });
      append(useAgentSession.getState().log, { kind: 'compaction', summary: 'summary', retainedFromSeq: 1 });
      append(useAgentSession.getState().log, { kind: 'steer', text: 'after compaction' });

      vi.spyOn(Storage.prototype, 'setItem')
        .mockImplementationOnce(() => { throw new DOMException('quota exceeded', 'QuotaExceededError'); });
      vi.advanceTimersByTime(600);

      expect(useAgentSession.getState().storageNotice).toBe('pruned');
    });

    it('a debounced save that fails twice sets storageNotice to lost', () => {
      useAgentSession.getState().hydrate();
      append(useAgentSession.getState().log, { kind: 'order', text: 'build', mapContext: 'ctx' });

      vi.spyOn(Storage.prototype, 'setItem')
        .mockImplementation(() => { throw new DOMException('quota exceeded', 'QuotaExceededError'); });
      vi.advanceTimersByTime(600);

      expect(useAgentSession.getState().storageNotice).toBe('lost');
    });

    it('a later saved save clears a standing pruned/lost notice', () => {
      useAgentSession.getState().hydrate();
      append(useAgentSession.getState().log, { kind: 'order', text: 'build', mapContext: 'ctx' });

      const setItem = vi.spyOn(Storage.prototype, 'setItem')
        .mockImplementationOnce(() => { throw new DOMException('quota exceeded', 'QuotaExceededError'); });
      vi.advanceTimersByTime(600);
      expect(useAgentSession.getState().storageNotice).toBe('pruned');
      setItem.mockRestore();

      append(useAgentSession.getState().log, { kind: 'steer', text: 'go' });
      vi.advanceTimersByTime(600);

      expect(useAgentSession.getState().storageNotice).toBeNull();
    });

    it('hydrate over corrupt bytes sets corrupt, and no later save auto-clears it: only dismissStorageNotice does', () => {
      localStorage.setItem(PREFS.agentLogV3.key, '{not json');

      useAgentSession.getState().hydrate();
      expect(useAgentSession.getState().storageNotice).toBe('corrupt');

      append(useAgentSession.getState().log, { kind: 'steer', text: 'go' });
      vi.advanceTimersByTime(600);
      expect(useAgentSession.getState().storageNotice).toBe('corrupt');

      useAgentSession.getState().dismissStorageNotice();
      expect(useAgentSession.getState().storageNotice).toBeNull();
    });

    it('clearSession resets the notice', () => {
      localStorage.setItem(PREFS.agentLogV3.key, '{not json');
      useAgentSession.getState().hydrate();
      expect(useAgentSession.getState().storageNotice).toBe('corrupt');

      useAgentSession.getState().clearSession();

      expect(useAgentSession.getState().storageNotice).toBeNull();
    });
  });
});

/** Filing and clearing are session metadata keyed by `orderSeq`, not model-visible log events.
 * The marks reset whenever the log identity changes because sequence numbers are local to a log. */
describe('the leave verbs: filing a settled record away, and clearing one', () => {
  const marks = () => {
    const s = useAgentSession.getState();
    return { filed: [...s.filed], cleared: [...s.cleared] };
  };

  it('files a record away, and says so idempotently', () => {
    useAgentSession.getState().fileAway(4);
    expect(marks()).toEqual({ filed: [4], cleared: [] });

    const before = useAgentSession.getState().filed;
    useAgentSession.getState().fileAway(4);
    // The same answer twice is not a change: a re-file must not churn every reader of the set.
    expect(useAgentSession.getState().filed).toBe(before);
  });

  /** A cleared record is filed BY CONSTRUCTION: there is no card left for it to stand as. */
  it('clears a record, which files it too', () => {
    useAgentSession.getState().clearRecord(7);
    expect(marks()).toEqual({ filed: [7], cleared: [7] });
  });

  it('survives a hydrate round trip', () => {
    useAgentSession.getState().hydrate();
    append(useAgentSession.getState().log, { kind: 'order', text: 'build', mapContext: 'ctx' });
    append(useAgentSession.getState().log, { kind: 'jobEnd', outcome: 'done' });
    useAgentSession.getState().fileAway(1);
    useAgentSession.getState().clearRecord(2);
    vi.advanceTimersByTime(600);

    useAgentSession.getState().hydrate();

    expect(marks()).toEqual({ filed: [1, 2], cleared: [2] });
  });

  /** The seqs belong to the log they were made against. A storage envelope that did not come back
   *  (absent, or a version this build cannot read) takes its marks with it, or the first record of
   *  the NEXT session inherits a stranger's answer. */
  it('drops the marks when the log they belong to does not come back', () => {
    useAgentSession.getState().fileAway(1);
    localStorage.removeItem(PREFS.agentLogV3.key);

    useAgentSession.getState().hydrate();

    expect(marks()).toEqual({ filed: [], cleared: [] });
  });

  it('drops the marks on a fresh session, storage and all', () => {
    useAgentSession.getState().fileAway(1);
    useAgentSession.getState().clearRecord(2);
    vi.advanceTimersByTime(600);

    useAgentSession.getState().clearSession();

    expect(marks()).toEqual({ filed: [], cleared: [] });
    useAgentSession.getState().hydrate();
    expect(marks()).toEqual({ filed: [], cleared: [] });
  });
});

describe('clearing removes provider context and stored transcripts', () => {
  it('erases the transcript immediately and cancels the older pending save', () => {
    const log = useAgentSession.getState().log;
    const order = append(log, { kind: 'order', text: 'deleted private request', mapContext: '' });
    append(log, { kind: 'jobEnd', outcome: 'done' });
    useAgentSession.getState().clearRecord(order.seq);
    expect(useAgentSession.getState().log.events).toEqual([]);
    expect(localStorage.getItem(PREFS.agentLogV3.key)).not.toContain('deleted private request');
    vi.advanceTimersByTime(600);
    expect(localStorage.getItem(PREFS.agentLogV3.key)).not.toContain('deleted private request');
    useAgentSession.getState().hydrate();
    expect(useAgentSession.getState().log.events).toEqual([]);
    const next = append(useAgentSession.getState().log, { kind: 'order', text: 'new request', mapContext: '' });
    expect(useAgentSession.getState().cleared.has(next.seq)).toBe(false);
  });

  it('erases legacy hidden records and their summaries on hydration', () => {
    const log = useAgentSession.getState().log;
    const order = append(log, { kind: 'order', text: 'legacy secret', mapContext: '' });
    append(log, { kind: 'jobEnd', outcome: 'done' });
    append(log, { kind: 'compaction', summary: 'legacy secret summary', retainedFromSeq: order.seq });
    vi.advanceTimersByTime(600);
    localStorage.setItem(PREFS.agentMarksV3.key, JSON.stringify({ v: 3, filed: [order.seq], cleared: [order.seq] }));
    useAgentSession.getState().hydrate();
    expect(useAgentSession.getState().log.events).toEqual([]);
    expect(localStorage.getItem(PREFS.agentLogV3.key)).not.toContain('legacy secret');
  });

  it('keeps filed records in context until they are explicitly cleared', () => {
    const log = useAgentSession.getState().log;
    const order = append(log, { kind: 'order', text: 'keep this record', mapContext: '' });
    append(log, { kind: 'jobEnd', outcome: 'done' });
    useAgentSession.getState().fileAway(order.seq);
    expect(useAgentSession.getState().log).toBe(log);
    expect(JSON.stringify(log.events)).toContain('keep this record');
  });
});
