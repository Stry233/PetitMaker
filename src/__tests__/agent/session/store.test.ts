// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { append } from '../../../agent/core/log';
import type { Part } from '../../../agent/core/types';
import { panelView, setToolFacts, useAgentSession } from '../../../agent/session/store';
import { stubFacts } from '../../_support/tool-facts';
import { PREFS } from '../../../platform/storage/prefs';

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
  // The store is a module singleton and hydrate() no-ops on an active job, so a test that leaves an
  // order unfinished would carry it into the next; clearSession() resets regardless.
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
   * The app calls `hydrate()` only when a map is restored, so every other launch runs on the boot
   * log, which has to be wired for epochs and saves by itself. A fresh module is the only way to see
   * it: the suite's `clearSession()` re-adopts and would mask an unwired boot log.
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

  /** Every epoch re-folds the log for every reader, so one per delta would cost token rate times log
   *  length. An append and a clear bypass the coalescing so live parts never lag the log. */
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

      // The frame that would have published it finds nothing left to publish.
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

    it('the tool facts are a store fact, so the panel and the character share ONE fold', () => {
      useAgentSession.getState().hydrate();
      append(useAgentSession.getState().log, { kind: 'order', text: 'build', mapContext: 'ctx' });

      expect(panelView(useAgentSession.getState())).toBe(panelView(useAgentSession.getState()));

      // The panel chunk publishes the facts as it loads; a standing reader then re-folds.
      const view = panelView(useAgentSession.getState());
      const facts = stubFacts();
      setToolFacts(facts);
      expect(useAgentSession.getState().toolFacts).toBe(facts);
      expect(panelView(useAgentSession.getState())).not.toBe(view);

      setToolFacts(undefined); // the store is a singleton
    });

    /** Open transcripts need each arriving character; unchanged snapshots need no new projection. */
    describe('a frame that would change nothing on screen publishes nothing', () => {
      // The store is a module singleton, so a listener left behind would outlive its own test.
      const unwire: (() => void)[] = [];
      afterEach(() => {
        while (unwire.length > 0) unwire.pop()?.();
      });

      /** Counts store updates, each of which costs readers a re-fold. */
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

      it('publishes a single new reasoning character on the next frame', () => {
        startTurn();
        const updates = countUpdates();

        useAgentSession.getState().setLive(thought(100));
        vi.advanceTimersByTime(FRAME_MS);
        expect(updates()).toBe(1);

        useAgentSession.getState().setLive(thought(101));
        vi.advanceTimersByTime(FRAME_MS);
        expect(updates()).toBe(2);
        expect(useAgentSession.getState().live).toEqual(thought(101));
      });

      it('coalesces a reasoning burst while ignoring an unchanged snapshot', () => {
        startTurn();
        const updates = countUpdates();

        useAgentSession.getState().setLive(thought(100));
        vi.advanceTimersByTime(FRAME_MS);
        useAgentSession.getState().setLive(thought(100));
        vi.advanceTimersByTime(FRAME_MS);
        expect(updates()).toBe(1);
        useAgentSession.getState().setLive(thought(150));
        useAgentSession.getState().setLive(thought(200));
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

      /** The gate skips a publish without discarding the snapshot, so an append still flushes it. */
      it('an append still takes the snapshot the gate left standing', () => {
        startTurn();
        const log = useAgentSession.getState().log;

        useAgentSession.getState().setLive(thought(100));
        vi.advanceTimersByTime(FRAME_MS);
        const completed: readonly Part[] = [{ kind: 'reasoning', text: 'x'.repeat(100), done: true }];
        useAgentSession.getState().setLive(completed);
        vi.advanceTimersByTime(FRAME_MS);
        expect(useAgentSession.getState().live).toEqual(thought(100));

        append(log, { kind: 'toolResult', callId: 'c1', name: 'paint_terrain', content: 'ok', isError: false });
        expect(useAgentSession.getState().live).toEqual(completed);
      });

      it('the CLEAR is never deferred or gated, however little the last thought changed', () => {
        startTurn();
        useAgentSession.getState().setLive(thought(100));
        vi.advanceTimersByTime(FRAME_MS);
        useAgentSession.getState().setLive(thought(140));

        useAgentSession.getState().setLive(null);
        expect(useAgentSession.getState().live).toBeNull();

        // No later frame revives the skipped snapshot behind the clear.
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
    // No jobEnd, so the job is active. Settling the debounced save leaves hydrate's own flush idle.
    vi.advanceTimersByTime(600);

    const liveLog = useAgentSession.getState().log;
    useAgentSession.getState().hydrate();

    expect(useAgentSession.getState().log).toBe(liveLog);
    expect(useAgentSession.getState().log.events.some((e) => e.kind === 'paused')).toBe(false);

    // The retained log's subscription is still wired.
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
   * `restored` tells a hold made in this page from one read back from storage, which the log alone
   * cannot. It falls on the first append: a job resumed and paused again here is a live hold.
   */
  describe('restored: the session came back from storage', () => {
    it('is false on a boot log, true after a hydrate that found one, and false again on the first append', () => {
      expect(useAgentSession.getState().restored).toBe(false);

      append(useAgentSession.getState().log, { kind: 'order', text: 'build', mapContext: 'ctx' });
      append(useAgentSession.getState().log, { kind: 'jobEnd', outcome: 'done' });
      vi.advanceTimersByTime(600);

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

  /** The fresh log saves over the corrupt bytes within a second, so the store holds them for the
   *  notice that offers to export them. */
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
    afterEach(() => vi.restoreAllMocks());

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
    // A re-file keeps the same set, so readers do not churn.
    expect(useAgentSession.getState().filed).toBe(before);
  });

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

  /** Seqs are local to a log: when the stored log is absent or unreadable, its marks go too, or the
   *  next session's first record would inherit them. */
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
