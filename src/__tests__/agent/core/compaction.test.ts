import { afterEach, describe, expect, it, vi } from 'vitest';
import { append, createLog } from '../../../agent/core/log';
import { COMPACTION_RESERVE, compact, needsCompaction } from '../../../agent/core/compaction';
import { deriveMessages } from '../../../agent/core/project-messages';
import { FIRST_EVENT_IDLE_MS } from '../../../agent/core/stream-idle';
import { createScriptedAdapter } from '../../_support/agent/scripted-adapter';
import type { Part, StreamEvent } from '../../../agent/core/types';
import type { Adapter, AdapterRequest } from '../../../agent/core/adapter';

afterEach(() => vi.useRealTimers());

const estimate = (s: string): number => s.length;
// A per-event cost so large that one group alone crosses KEEP_RECENT, so a fixture with 2+ groups
// always folds (something precedes the retained tail) and `compact` runs the adapter.
const bigEstimate = (): number => 9000;
const UNBOUNDED = Number.MAX_SAFE_INTEGER;

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

/** Appends one exchange group: an order opens it, an assistant turn calls a tool, a toolResult closes it. */
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
    // Five groups of three events at 1000 per event cost 3000 each; accumulating from the newest
    // crosses KEEP_RECENT (8000) at the third group back, so groups 3 to 5 survive and 1 and 2 do not.
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
    const ok = await compact(log, { adapter, model: 'm', budgetTokens: UNBOUNDED, signal: new AbortController().signal, estimate: () => 1000 });
    expect(ok).toBe(true);

    const compactionEvent = log.events.find((e) => e.kind === 'compaction');
    expect(compactionEvent && compactionEvent.kind === 'compaction' ? compactionEvent.retainedFromSeq : undefined)
      .toBe(group3StartSeq);

    // Every assistant tool call is still followed by a tool message carrying exactly its call ids.
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
    expect(out[0]).toEqual({ role: 'user', text: '(conversation summary, reference only) <summary_data>"summary of jobs 1-5"</summary_data>' });
  });

  it('summarizes only the evicted prefix, within the window\'s budget, so an overflow recovery fits', async () => {
    const log = createLog(() => 0);
    // At 1000 per event and per message groups 3 to 5 are retained; of the evicted groups 1 and 2,
    // a 3500-token budget holds only the newer.
    for (let i = 1; i <= 5; i++) seedGroup(log, `job ${i}`, `c${i}`);
    let captured: AdapterRequest | undefined;
    const adapter = createScriptedAdapter([
      (req) => {
        captured = req;
        return [{ t: 'text', delta: 'summary' }, { t: 'done', stop: 'stop' }];
      },
    ]);
    const ok = await compact(log, { adapter, model: 'm', budgetTokens: 3500, signal: new AbortController().signal, estimate: () => 1000 });
    expect(ok).toBe(true);
    const sent = JSON.stringify(captured?.messages);
    expect(sent).toContain('job 2');
    expect(sent).not.toContain('job 1');
    for (const retained of ['job 3', 'job 4']) expect(sent).not.toContain(retained);
    expect(captured?.messages.filter((m) => m.role !== 'user' || !m.text.startsWith('(map ledger)'))).toHaveLength(3);
  });

  it('folds INSIDE a single exchange at an assistant boundary when no group boundary can be used', async () => {
    // One order and no steer make the whole job one group, so only an assistant boundary can be cut
    // at; without that fallback the job would settle as an overflow incident.
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
    // Walking back from the newest assistant at 1000 per event, the suffix reaches KEEP_RECENT
    // (8000) at the second assistant (8 events), the oldest one kept.
    const ok = await compact(log, { adapter, model: 'm', budgetTokens: UNBOUNDED, signal: new AbortController().signal, estimate: () => 1000 });
    expect(ok).toBe(true);

    const ev = log.events.find((e) => e.kind === 'compaction');
    expect(ev && ev.kind === 'compaction' ? ev.retainedFromSeq : undefined).toBe(assistantSeqs[1]);

    // The window opens on the summary and pairs stay intact, as after a group-boundary cut.
    const out = deriveMessages(log, { budgetTokens: Number.MAX_SAFE_INTEGER, estimate });
    expect(out[0]).toEqual({ role: 'user', text: '(conversation summary, reference only) <summary_data>"summary of the one big job"</summary_data>' });
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
    // No assistant turn exists, so no seq inside the window can be cut at; a summary would only
    // add a message ahead of the order.
    append(log, { kind: 'order', text: 'one enormous order', mapContext: 'x'.repeat(50) });
    const before = log.events.length;

    // The adapter would succeed if called, so the false result comes from the early bail.
    const adapter = createScriptedAdapter([
      { events: [{ t: 'text', delta: 'would-be summary' }, { t: 'done', stop: 'stop' }] },
    ]);
    const ok = await compact(log, { adapter, model: 'm', budgetTokens: UNBOUNDED, signal: new AbortController().signal, estimate: bigEstimate });

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
    const ok = await compact(log, { adapter, model: 'm', budgetTokens: UNBOUNDED, signal: new AbortController().signal, estimate: bigEstimate });
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
    // A 3000-character order makes a group cost about 3008, so the cut lands at group 3 (KEEP_RECENT
    // is 8000). Counted, the 8000-character reasoning part alone would collapse the tail to one group.
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
      expect(await compact(log, { adapter, model: 'm', budgetTokens: UNBOUNDED, signal: new AbortController().signal, estimate })).toBe(true);
      const ev = log.events.find((e) => e.kind === 'compaction');
      return { seq: ev && ev.kind === 'compaction' ? ev.retainedFromSeq : -1, req };
    };

    const plain = build(undefined);
    const thinking = build('t'.repeat(8000));
    const plainCut = await retainedSeqOf(plain.log);
    const thinkingCut = await retainedSeqOf(thinking.log);

    expect(plainCut.seq).toBe(plain.group3StartSeq);
    expect(thinkingCut.seq).toBe(thinking.group3StartSeq);

    // The summary request replays the messages the model would have received, which carry no reasoning part.
    const sent = (thinkingCut.req?.messages ?? []).map((m) => (m.role === 'user' ? m.text : m.role === 'assistant' ? m.text : '')).join('');
    expect(sent).not.toContain('tttt');
  });

  it('falls back to the mechanical ledger when the adapter turn errors, so an unreachable summarizer costs no job', async () => {
    const log = createLog(() => 0);
    // Two foldable groups so the adapter is invoked; a single exchange would bail before reaching it.
    seedGroup(log, 'first job', 'c1');
    seedGroup(log, 'second job', 'c2');

    const adapter = createScriptedAdapter([{ error: { cls: 'network', detail: 'boom' } }]);
    const ok = await compact(log, { adapter, model: 'm', budgetTokens: UNBOUNDED, signal: new AbortController().signal, estimate: bigEstimate });

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
    const ok = await compact(log, { adapter, model: 'm', budgetTokens: UNBOUNDED, signal: new AbortController().signal, estimate: bigEstimate });

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
      // Accepts the request then goes silent: `next()` never settles, a failure the error and empty fallbacks cannot see.
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

    const pending = compact(log, { adapter, model: 'm', budgetTokens: UNBOUNDED, signal: new AbortController().signal, estimate: bigEstimate });
    await vi.advanceTimersByTimeAsync(FIRST_EVENT_IDLE_MS);

    expect(await pending).toBe(true);
    const ev = log.events.find((e) => e.kind === 'compaction');
    expect(ev && ev.kind === 'compaction' ? ev.summary : undefined)
      .toBe('(automatic summary) Last order: "second job". Tool calls so far this job: 1.');
    // The stalled stream is closed rather than left holding the connection.
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
    const ok = await compact(log, { adapter, model: 'm', budgetTokens: UNBOUNDED, signal: controller.signal, estimate: bigEstimate });

    expect(ok).toBe(false);
    expect(log.events.length).toBe(before);
  });

  it('a second compaction summarizes from the first\'s boundary, carrying the prior summary forward', async () => {
    const log = createLog(() => 0);
    // Two groups make the first compaction a real fold (group 1 dropped, group 2 retained).
    seedGroup(log, 'first job part one', 'c1');
    seedGroup(log, 'first job part two', 'c2');

    const firstAdapter = createScriptedAdapter([
      { events: [{ t: 'text', delta: 'summary one' }, { t: 'done', stop: 'stop' }] },
    ]);
    expect(await compact(log, { adapter: firstAdapter, model: 'm', budgetTokens: UNBOUNDED, signal: new AbortController().signal, estimate: bigEstimate })).toBe(true);
    const firstRetained = log.events.find((e) => e.kind === 'compaction');
    const firstRetainedFromSeq = firstRetained && firstRetained.kind === 'compaction' ? firstRetained.retainedFromSeq : -1;
    expect(firstRetainedFromSeq).toBeGreaterThan(log.events[0]?.seq ?? 0);

    // A third group gives the second call a two-group window (job two, still verbatim, plus job three) to fold.
    seedGroup(log, 'second job', 'c3');

    let secondReq: AdapterRequest | undefined;
    const secondAdapter = createScriptedAdapter([
      (req) => {
        secondReq = req;
        return [{ t: 'text', delta: 'summary two' }, { t: 'done', stop: 'stop' }];
      },
    ]);
    expect(await compact(log, { adapter: secondAdapter, model: 'm', budgetTokens: UNBOUNDED, signal: new AbortController().signal, estimate: bigEstimate })).toBe(true);

    // deriveMessages replays from the latest compaction, so the first summary arrives as a plain user message.
    expect(secondReq?.messages.some((m) => m.role === 'user' && m.text === '(conversation summary, reference only) <summary_data>"summary one"</summary_data>')).toBe(true);

    const compactions = log.events.filter((e) => e.kind === 'compaction');
    expect(compactions).toHaveLength(2);
    const second = compactions[1];
    expect(second && second.kind === 'compaction' ? second.summary : undefined).toBe('summary two');
    expect(second && second.kind === 'compaction' ? second.retainedFromSeq >= firstRetainedFromSeq : false).toBe(true);
  });
});
