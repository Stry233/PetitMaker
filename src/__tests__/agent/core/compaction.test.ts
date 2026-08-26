import { afterEach, describe, expect, it, vi } from 'vitest';
import { append, createLog } from '../../../agent/core/log';
import { COMPACTION_RESERVE, compact, needsCompaction } from '../../../agent/core/compaction';
import { deriveMessages } from '../../../agent/core/project-messages';
import { FIRST_EVENT_IDLE_MS } from '../../../agent/core/stream-idle';
import { createScriptedAdapter } from '../../../agent/eval/scripted-adapter';
import type { Part, StreamEvent } from '../../../agent/core/types';
import type { Adapter, AdapterRequest } from '../../../agent/providers/types';

afterEach(() => vi.useRealTimers());

const estimate = (s: string): number => s.length;
// A per-event cost so large that even one group's events alone cross KEEP_RECENT: it guarantees a
// genuine fold (something precedes the retained tail) whenever a fixture carries 2+ groups, and is
// used wherever a test needs `compact` to actually run the adapter rather than bail early.
const bigEstimate = (): number => 9000;

describe('needsCompaction', () => {
  it('is false at exactly the reserve boundary and true one token past it', () => {
    const log = createLog(() => 0);
    append(log, { kind: 'order', text: 'a'.repeat(50), mapContext: 'ctx' });
    const messages = deriveMessages(log, { budgetTokens: Number.MAX_SAFE_INTEGER, estimate });
    const total = messages.reduce((sum, m) => sum + estimate(m.role === 'user' ? m.text : ''), 0);

    expect(needsCompaction(log, { contextWindow: total + COMPACTION_RESERVE + 1, estimate })).toBe(false);
    expect(needsCompaction(log, { contextWindow: total + COMPACTION_RESERVE - 1, estimate })).toBe(true);
  });
});

/** Builds one exchange group: an order opens it, an assistant turn calls a tool, and a toolResult
 *  closes it. Every event's estimated cost is pinned to a constant via the caller's `estimate`, so
 *  a test can predict exactly which groups a tail cut keeps. */
function seedGroup(log: ReturnType<typeof createLog>, orderText: string, callId: string): void {
  append(log, { kind: 'order', text: orderText, mapContext: '' });
  append(log, {
    kind: 'assistant',
    stop: 'tool-calls',
    parts: [{ kind: 'tool', callId, name: 'place_object', input: { id: 'tree' }, argsDone: true }],
  });
  append(log, { kind: 'toolResult', callId, name: 'place_object', content: 'placed', isError: false });
}

describe('compact', () => {
  it('cuts the tail at an exchange boundary, never splitting a call from its result', async () => {
    const log = createLog(() => 0);
    // Five groups of three events each; a constant-per-event estimate of 1000 makes each group
    // cost exactly 3000, so accumulating from the newest crosses KEEP_RECENT (8000) after the
    // third group back (3000+3000+3000=9000 >= 8000): groups 3, 4 and 5 survive, 1 and 2 do not.
    let group3StartSeq = -1;
    for (let i = 1; i <= 5; i++) {
      const ev = append(log, { kind: 'order', text: `job ${i}`, mapContext: '' });
      if (i === 3) group3StartSeq = ev.seq;
      append(log, {
        kind: 'assistant',
        stop: 'tool-calls',
        parts: [{ kind: 'tool', callId: `c${i}`, name: 'place_object', input: {}, argsDone: true }],
      });
      append(log, { kind: 'toolResult', callId: `c${i}`, name: 'place_object', content: 'placed', isError: false });
    }

    const adapter = createScriptedAdapter([
      { events: [{ t: 'text', delta: 'summary of jobs 1-5' }, { t: 'done', stop: 'stop' }] },
    ]);
    const ok = await compact(log, { adapter, model: 'm', signal: new AbortController().signal, estimate: () => 1000 });
    expect(ok).toBe(true);

    const compactionEvent = log.events.find((e) => e.kind === 'compaction');
    expect(compactionEvent && compactionEvent.kind === 'compaction' ? compactionEvent.retainedFromSeq : undefined)
      .toBe(group3StartSeq);

    // Pairing holds after the cut: every assistant tool call is immediately followed by a tool
    // message carrying exactly its own call ids.
    const out = deriveMessages(log, { budgetTokens: Number.MAX_SAFE_INTEGER, estimate });
    for (let i = 0; i < out.length; i++) {
      const m = out[i];
      if (m?.role === 'assistant' && m.toolCalls.length > 0) {
        const next = out[i + 1];
        expect(next?.role).toBe('tool');
        if (next?.role === 'tool') {
          expect(next.results.map((r) => r.callId).sort()).toEqual(m.toolCalls.map((c) => c.callId).sort());
        }
      }
    }
    expect(out[0]).toEqual({ role: 'user', text: '(conversation summary) summary of jobs 1-5' });
  });

  it('folds INSIDE a single exchange at an assistant boundary when no group boundary can be used', async () => {
    // Shape A of the compaction audit: one order, no steer, so the whole job is ONE group and the
    // group walk can only return the order's own seq. Before the emergency boundary this bailed and
    // the caller settled the job as an overflow incident - skill kept, job lost.
    const log = createLog(() => 0);
    append(log, { kind: 'order', text: 'one enormous job', mapContext: '' });
    const assistantSeqs: number[] = [];
    for (let i = 1; i <= 5; i++) {
      const a = append(log, {
        kind: 'assistant',
        stop: 'tool-calls',
        parts: [{ kind: 'tool', callId: `c${i}`, name: 'place_object', input: {}, argsDone: true }],
      });
      assistantSeqs.push(a.seq);
      append(log, { kind: 'toolResult', callId: `c${i}`, name: 'place_object', content: 'placed', isError: false });
    }

    const adapter = createScriptedAdapter([
      { events: [{ t: 'text', delta: 'summary of the one big job' }, { t: 'done', stop: 'stop' }] },
    ]);
    // 1000 per event: walking back from the newest assistant, the suffix cost reaches KEEP_RECENT
    // (8000) exactly at the SECOND assistant (8 events x 1000), which is therefore the oldest kept.
    const ok = await compact(log, { adapter, model: 'm', signal: new AbortController().signal, estimate: () => 1000 });
    expect(ok).toBe(true);

    const ev = log.events.find((e) => e.kind === 'compaction');
    expect(ev && ev.kind === 'compaction' ? ev.retainedFromSeq : undefined).toBe(assistantSeqs[1]);

    // Pairs intact and the window opens on the summary, exactly as a group-boundary cut does.
    const out = deriveMessages(log, { budgetTokens: Number.MAX_SAFE_INTEGER, estimate });
    expect(out[0]).toEqual({ role: 'user', text: '(conversation summary) summary of the one big job' });
    for (let i = 0; i < out.length; i++) {
      const m = out[i];
      if (m?.role === 'assistant' && m.toolCalls.length > 0) {
        const next = out[i + 1];
        expect(next?.role).toBe('tool');
        if (next?.role === 'tool') {
          expect(next.results.map((r) => r.callId).sort()).toEqual(m.toolCalls.map((c) => c.callId).sort());
        }
      }
    }
  });

  it('bails before spending the adapter call when even the assistant walk reaches the window\'s first event', async () => {
    const log = createLog(() => 0);
    // No assistant turn has landed yet, so there is no seq inside the window to cut at: a summary
    // would only ADD a message ahead of the order, never remove one.
    append(log, { kind: 'order', text: 'one enormous order', mapContext: 'x'.repeat(50) });
    const before = log.events.length;

    // A well-behaved adapter that WOULD succeed if called: this proves the false result comes from
    // the early bail (nothing to fold), not from an adapter failure.
    const adapter = createScriptedAdapter([
      { events: [{ t: 'text', delta: 'would-be summary' }, { t: 'done', stop: 'stop' }] },
    ]);
    const ok = await compact(log, { adapter, model: 'm', signal: new AbortController().signal, estimate: bigEstimate });

    expect(ok).toBe(false);
    expect(log.events.length).toBe(before);
    expect(adapter.requests).toHaveLength(0);
  });

  it('carries the last order\'s text and the job\'s op count in the request, inspected via a function turn', async () => {
    const log = createLog(() => 0);
    seedGroup(log, 'build a village', 'c1');
    append(log, { kind: 'order', text: 'add two more trees', mapContext: '' });
    append(log, {
      kind: 'assistant',
      stop: 'tool-calls',
      parts: [
        { kind: 'tool', callId: 'c2', name: 'place_object', input: {}, argsDone: true },
        { kind: 'tool', callId: 'c3', name: 'place_object', input: {}, argsDone: true },
      ],
    });
    append(log, { kind: 'toolResult', callId: 'c2', name: 'place_object', content: 'placed', isError: false });
    append(log, { kind: 'toolResult', callId: 'c3', name: 'place_object', content: 'placed', isError: false });

    let captured: AdapterRequest | undefined;
    const adapter = createScriptedAdapter([
      (req) => {
        captured = req;
        return [{ t: 'text', delta: 'summary' }, { t: 'done', stop: 'stop' }];
      },
    ]);
    // Two groups, and bigEstimate guarantees the second alone crosses KEEP_RECENT: the fold is
    // genuine (the first group is left behind), so the request is actually sent.
    const ok = await compact(log, { adapter, model: 'm', signal: new AbortController().signal, estimate: bigEstimate });
    expect(ok).toBe(true);

    expect(captured?.tools).toEqual([]);
    expect(captured?.system.length).toBeGreaterThan(0);
    const ledgerMessage = captured?.messages.find((m) => m.role === 'user' && m.text.startsWith('(map ledger)'));
    expect(ledgerMessage).toBeDefined();
    const ledgerText = ledgerMessage?.role === 'user' ? ledgerMessage.text : '';
    expect(ledgerText).toContain('add two more trees');
    expect(ledgerText).toContain('2');
  });

  it('spends no tail budget on reasoning: a giant thought in the newest group moves no boundary', async () => {
    // Five groups whose every event cost is its own character count. The order text is sized so a
    // group costs ~3008, and accumulating from the newest crosses KEEP_RECENT (8000) at the third
    // group back: the cut lands at group 3 whatever the model thought along the way. An 8,000-char
    // reasoning part in the NEWEST group is the trap — counted, it alone crosses KEEP_RECENT and
    // the tail collapses to that one group, spending the whole retention on bytes deriveMessages
    // never sends.
    const build = (thought: string | undefined): { log: ReturnType<typeof createLog>; group3StartSeq: number } => {
      const log = createLog(() => 0);
      let group3StartSeq = -1;
      for (let i = 1; i <= 5; i++) {
        const ev = append(log, { kind: 'order', text: 'o'.repeat(3000), mapContext: '' });
        if (i === 3) group3StartSeq = ev.seq;
        const parts: Part[] = [{ kind: 'tool', callId: `c${i}`, name: 'place_object', input: {}, argsDone: true }];
        if (i === 5 && thought !== undefined) parts.unshift({ kind: 'reasoning', text: thought, done: true });
        append(log, { kind: 'assistant', stop: 'tool-calls', parts });
        append(log, { kind: 'toolResult', callId: `c${i}`, name: 'place_object', content: 'placed', isError: false });
      }
      return { log, group3StartSeq };
    };

    const retainedSeqOf = async (log: ReturnType<typeof createLog>): Promise<{ seq: number; req?: AdapterRequest }> => {
      let req: AdapterRequest | undefined;
      const adapter = createScriptedAdapter([
        (r) => { req = r; return [{ t: 'text', delta: 'summary' }, { t: 'done', stop: 'stop' }]; },
      ]);
      expect(await compact(log, { adapter, model: 'm', signal: new AbortController().signal, estimate })).toBe(true);
      const ev = log.events.find((e) => e.kind === 'compaction');
      return { seq: ev && ev.kind === 'compaction' ? ev.retainedFromSeq : -1, req };
    };

    const plain = build(undefined);
    const thinking = build('t'.repeat(8000));
    const plainCut = await retainedSeqOf(plain.log);
    const thinkingCut = await retainedSeqOf(thinking.log);

    expect(plainCut.seq).toBe(plain.group3StartSeq);
    expect(thinkingCut.seq).toBe(thinking.group3StartSeq);

    // And the thought reaches no request either: the summary turn replays the same messages the
    // model would have received, which never carry a reasoning part.
    const sent = (thinkingCut.req?.messages ?? []).map((m) => (m.role === 'user' ? m.text : m.role === 'assistant' ? m.text : '')).join('');
    expect(sent).not.toContain('tttt');
  });

  it('falls back to the mechanical ledger when the adapter turn errors, so an unreachable summarizer costs no job', async () => {
    const log = createLog(() => 0);
    // Two groups (genuinely foldable via bigEstimate) so the adapter is actually invoked: a
    // degenerate single-exchange log would bail before ever reaching it, which would make this
    // test pass for the wrong reason.
    seedGroup(log, 'first job', 'c1');
    seedGroup(log, 'second job', 'c2');

    const adapter = createScriptedAdapter([{ error: { cls: 'network', detail: 'boom' } }]);
    const ok = await compact(log, { adapter, model: 'm', signal: new AbortController().signal, estimate: bigEstimate });

    expect(ok).toBe(true);
    expect(adapter.requests).toHaveLength(1);
    const ev = log.events.find((e) => e.kind === 'compaction');
    expect(ev && ev.kind === 'compaction' ? ev.summary : undefined)
      .toBe('(automatic summary) Last order: "second job". Tool calls so far this job: 1.');
  });

  it('falls back to the mechanical ledger when the summary comes back empty', async () => {
    const log = createLog(() => 0);
    seedGroup(log, 'first job', 'c1');
    seedGroup(log, 'second job', 'c2');

    const adapter = createScriptedAdapter([{ events: [{ t: 'done', stop: 'stop' }] }]);
    const ok = await compact(log, { adapter, model: 'm', signal: new AbortController().signal, estimate: bigEstimate });

    expect(ok).toBe(true);
    expect(adapter.requests).toHaveLength(1);
    const ev = log.events.find((e) => e.kind === 'compaction');
    expect(ev && ev.kind === 'compaction' ? ev.summary : undefined)
      .toBe('(automatic summary) Last order: "second job". Tool calls so far this job: 1.');
  });

  it('bounds the summary stream: a summarizer that accepts the connection and never speaks falls back rather than hanging', async () => {
    vi.useFakeTimers();
    const log = createLog(() => 0);
    seedGroup(log, 'first job', 'c1');
    seedGroup(log, 'second job', 'c2');

    let returned = false;
    const adapter: Adapter = {
      // Accepts the request and then goes silent: the generator's `next()` never settles, which is
      // the one failure mode the error/empty fallbacks cannot see.
      stream(): AsyncGenerator<StreamEvent> {
        return {
          next: () => new Promise<IteratorResult<StreamEvent>>(() => {}),
          return: async () => { returned = true; return { done: true, value: undefined }; },
          throw: async () => ({ done: true, value: undefined }),
          [Symbol.asyncIterator]() { return this; },
        } as unknown as AsyncGenerator<StreamEvent>;
      },
      async listModels() { return ['m']; },
    };

    const pending = compact(log, { adapter, model: 'm', signal: new AbortController().signal, estimate: bigEstimate });
    await vi.advanceTimersByTimeAsync(FIRST_EVENT_IDLE_MS);

    expect(await pending).toBe(true);
    const ev = log.events.find((e) => e.kind === 'compaction');
    expect(ev && ev.kind === 'compaction' ? ev.summary : undefined)
      .toBe('(automatic summary) Last order: "second job". Tool calls so far this job: 1.');
    // The dead fetch is cancelled rather than left holding the connection.
    expect(returned).toBe(true);
  });

  it('appends nothing when the summary turn ends because the job was aborted', async () => {
    const log = createLog(() => 0);
    seedGroup(log, 'first job', 'c1');
    seedGroup(log, 'second job', 'c2');
    const before = log.events.length;

    const controller = new AbortController();
    controller.abort();
    const adapter = createScriptedAdapter([{ events: [{ t: 'text', delta: 'never arrives' }, { t: 'done', stop: 'stop' }] }]);
    const ok = await compact(log, { adapter, model: 'm', signal: controller.signal, estimate: bigEstimate });

    expect(ok).toBe(false);
    expect(log.events.length).toBe(before);
  });

  it('a second compaction summarizes from the first\'s boundary, carrying the prior summary forward', async () => {
    const log = createLog(() => 0);
    // Two groups up front so the FIRST compaction is itself a genuine fold (group 1 dropped,
    // group 2 retained) rather than the degenerate single-exchange case.
    seedGroup(log, 'first job part one', 'c1');
    seedGroup(log, 'first job part two', 'c2');

    const firstAdapter = createScriptedAdapter([
      { events: [{ t: 'text', delta: 'summary one' }, { t: 'done', stop: 'stop' }] },
    ]);
    expect(await compact(log, { adapter: firstAdapter, model: 'm', signal: new AbortController().signal, estimate: bigEstimate })).toBe(true);
    const firstRetained = log.events.find((e) => e.kind === 'compaction');
    const firstRetainedFromSeq = firstRetained && firstRetained.kind === 'compaction' ? firstRetained.retainedFromSeq : -1;
    // Non-degenerate: the retained tail starts strictly after the window's first event (job one).
    expect(firstRetainedFromSeq).toBeGreaterThan(log.events[0]?.seq ?? 0);

    // A third group lands after the first compaction, giving the second call its own two-group
    // window (job two, still retained verbatim, plus job three) to fold genuinely as well.
    seedGroup(log, 'second job', 'c3');

    let secondReq: AdapterRequest | undefined;
    const secondAdapter = createScriptedAdapter([
      (req) => {
        secondReq = req;
        return [{ t: 'text', delta: 'summary two' }, { t: 'done', stop: 'stop' }];
      },
    ]);
    expect(await compact(log, { adapter: secondAdapter, model: 'm', signal: new AbortController().signal, estimate: bigEstimate })).toBe(true);

    // The second request's derived messages already carry the first summary as a plain user
    // message, since deriveMessages replays from the latest compaction forward.
    expect(secondReq?.messages.some((m) => m.role === 'user' && m.text === '(conversation summary) summary one')).toBe(true);

    const compactions = log.events.filter((e) => e.kind === 'compaction');
    expect(compactions).toHaveLength(2);
    const second = compactions[1];
    expect(second && second.kind === 'compaction' ? second.summary : undefined).toBe('summary two');
    expect(second && second.kind === 'compaction' ? second.retainedFromSeq >= firstRetainedFromSeq : false).toBe(true);
  });
});
