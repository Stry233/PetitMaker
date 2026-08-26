import { describe, expect, it } from 'vitest';
import { createScriptedAdapter, type ScriptedTurn } from '../../../agent/eval/scripted-adapter';
import { append, createLog, eventsOf, type SessionLog } from '../../../agent/core/log';
import type { ExecutedResult, LoopDeps, ToolExecutor } from '../../../agent/core/loop';
import { runJob } from '../../../agent/core/loop';
import type { Adapter, AdapterRequest } from '../../../agent/providers/types';

/** The failure-mode suite for `runJob`: the retry ladder, exhaustion, unretryable errors, a
 *  mid-run abort, overflow-driven compaction, a bad-args batch, the verbatim-retry and revert
 *  dampers, the silent-turn governor path (empty and reasoning-only alike), and the iteration cap.
 *  Companion to loop.test.ts, which
 *  covers the happy-path plumbing (gates, checkpoints, pause/resume, steers). */

interface RecordedCall { callId: string; name: string; args: Record<string, unknown> }

function makeExecutor(opts: {
  writeNames?: Set<string>;
  wideNames?: Set<string>;
  result?: (call: RecordedCall) => ExecutedResult;
} = {}): ToolExecutor & { calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const writeNames = opts.writeNames ?? new Set<string>();
  const wideNames = opts.wideNames ?? new Set<string>();
  return {
    calls,
    async execute(call) {
      calls.push(call);
      return opts.result ? opts.result(call) : { content: `did ${call.name}`, isError: false };
    },
    isWrite: (name) => writeNames.has(name),
    isWide: (name) => wideNames.has(name),
    describe: (call) => `run ${call.name}`,
  };
}

function makeDeps(overrides: Partial<LoopDeps> & { adapter: LoopDeps['adapter']; executor: ToolExecutor }): LoopDeps {
  return {
    model: 'scripted-model',
    system: 'system prompt',
    tools: [],
    oversight: 'yolo',
    sameModel: true,
    budgetTokens: 100_000,
    signal: new AbortController().signal,
    undoStackSize: () => 0,
    ...overrides,
  };
}

function textTurn(text: string): ScriptedTurn {
  return { events: [{ t: 'text', delta: text }, { t: 'done', stop: 'stop' }] };
}

function toolTurn(calls: { callId: string; name: string; args?: Record<string, unknown> }[], stop: 'tool-calls' | 'length' = 'tool-calls'): ScriptedTurn {
  return {
    events: [{
      t: 'done', stop,
      final: calls.map((c) => ({ callId: c.callId, name: c.name, args: c.args, rawArgs: JSON.stringify(c.args ?? {}) })),
    }],
  };
}

/** A turn that produced ONLY reasoning before the provider cut it off at its output limit: no
 *  text, no tool call, so it reads as empty to anything that only looks at those two. */
function reasoningTurn(text: string): ScriptedTurn {
  return { events: [{ t: 'reasoning', delta: text }, { t: 'done', stop: 'length' }] };
}

/** A turn that produced ONLY reasoning and then ENDED of its own accord: the model thought, and
 *  nothing it thought reached the user. Silent, but not idle, and not cut off either. */
function thinkingTurn(text: string): ScriptedTurn {
  return { events: [{ t: 'reasoning', delta: text }, { t: 'done', stop: 'stop' }] };
}

/** No parts at all: the model produced nothing whatsoever and ended the turn. */
const EMPTY_TURN: ScriptedTurn = { events: [{ t: 'done', stop: 'stop' }] };

/** The trailing system note of the i-th request, which is the only channel the nudges ride. */
function noteAt(snapshots: AdapterRequest[], i: number): string {
  const messages = snapshots[i]?.messages ?? [];
  const last = messages[messages.length - 1];
  return last && last.role === 'user' ? last.text : '';
}

function seedOrder(log: SessionLog, text = 'go'): void {
  append(log, { kind: 'order', text, mapContext: '' });
}

/** A no-op sleep: records every delay the loop asks it to wait, but resolves immediately so the
 *  retry-ladder tests run at real-clock speed with no fake timers. */
function fakeSleep(): { sleep: (ms: number, signal: AbortSignal) => Promise<void>; calls: number[] } {
  const calls: number[] = [];
  return { calls, sleep: async (ms) => { calls.push(ms); } };
}

/** Wraps a `ScriptedAdapter` to snapshot each request with `structuredClone` AT THE MOMENT it is
 *  sent: the adapter's own `requests` array aliases the live objects the loop built, so comparing
 *  entries read back at the end of a test would trivially "pass" even if a later mutation (or a
 *  rebuilt request that happens to share structure) made two turns look identical after the fact. */
function withRequestSnapshots(adapter: Adapter & { requests: AdapterRequest[] }): { adapter: Adapter & { requests: AdapterRequest[] }; snapshots: AdapterRequest[] } {
  const snapshots: AdapterRequest[] = [];
  const wrapped: Adapter & { requests: AdapterRequest[] } = {
    requests: adapter.requests,
    async *stream(req, signal) {
      snapshots.push(structuredClone(req));
      yield* adapter.stream(req, signal);
    },
    listModels: (signal) => adapter.listModels(signal),
  };
  return { adapter: wrapped, snapshots };
}

describe('runJob failure modes', () => {
  it('1. a retryable rate-limit error retries the SAME request after the provider\'s own retryAfterMs, then succeeds', async () => {
    const log = createLog(() => 0);
    seedOrder(log, 'go');
    const scripted = createScriptedAdapter([
      { error: { cls: 'rate-limit', detail: 'slow down', retryAfterMs: 7000 } },
      textTurn('all done'),
    ]);
    const { adapter, snapshots } = withRequestSnapshots(scripted);
    const executor = makeExecutor();
    const { sleep, calls: sleepCalls } = fakeSleep();
    const deps = makeDeps({ adapter, executor, sleep });

    const outcome = await runJob(log, deps);

    expect(outcome).toBe('done');
    const retryEvents = eventsOf(log).filter((e) => e.kind === 'retry');
    expect(retryEvents).toHaveLength(1);
    expect(retryEvents[0]).toMatchObject({ attempt: 1, cls: 'rate-limit', delayMs: 7000 });
    expect(sleepCalls).toEqual([7000]);
    expect(scripted.requests).toHaveLength(2);
    expect(snapshots).toHaveLength(2);
    expect(snapshots[1]).toEqual(snapshots[0]); // the identical request replayed verbatim
  });

  /**
   * ONE 429 TEACHES THE SESSION ITS PACE, and nothing before one costs a millisecond.
   *
   * A forty-turn autopilot job spends a request per turn, which on a shared per-minute budget is the
   * same limit discovered over and over — the ladder answers each refusal, and only a gap between
   * turns stops earning them. The clock moves with the sleeps here, so the second turn's wait is
   * measured against a log whose last turn really did close six seconds earlier.
   */
  it('1b. paces the turns after a rate-limit, and paces nothing in a session that never hit one', async () => {
    let clock = 0;
    const paceSleep = (calls: number[]) => async (ms: number): Promise<void> => { calls.push(ms); clock += ms; };

    const limited = createLog(() => clock);
    seedOrder(limited, 'place five huts');
    const limitedCalls: number[] = [];
    const limitedDeps = makeDeps({
      adapter: createScriptedAdapter([
        { error: { cls: 'rate-limit', detail: 'slow down', retryAfterMs: 6000 } },
        toolTurn([{ callId: 'c1', name: 'place_object', args: {} }]),
        textTurn('five huts'),
      ]),
      executor: makeExecutor(),
      sleep: paceSleep(limitedCalls),
    });
    expect(await runJob(limited, limitedDeps)).toBe('done');
    // The ladder's own wait, then the pace the refusal taught it before the next turn's request.
    expect(limitedCalls).toEqual([6000, 6000]);

    clock = 0;
    const easy = createLog(() => clock);
    seedOrder(easy, 'place five huts');
    const easyCalls: number[] = [];
    const easyDeps = makeDeps({
      adapter: createScriptedAdapter([
        toolTurn([{ callId: 'c1', name: 'place_object', args: {} }]),
        textTurn('five huts'),
      ]),
      executor: makeExecutor(),
      sleep: paceSleep(easyCalls),
    });
    expect(await runJob(easy, easyDeps)).toBe('done');
    expect(easyCalls, 'a fast local model stays fast').toEqual([]);
  });

  it('2. attempts exhaust at MAX_TURN_RETRIES: 4 retry events, then the 5th attempt lands an incident', async () => {
    const log = createLog(() => 0);
    seedOrder(log, 'go');
    const turns: ScriptedTurn[] = Array.from({ length: 5 }, () => ({ error: { cls: 'rate-limit', detail: 'still limited' } }));
    const adapter = createScriptedAdapter(turns);
    const executor = makeExecutor();
    const { sleep } = fakeSleep();
    const deps = makeDeps({ adapter, executor, sleep });

    const outcome = await runJob(log, deps);

    expect(outcome).toBe('incident');
    expect(adapter.requests).toHaveLength(5); // 1 initial + 4 retries: MAX_TURN_RETRIES total attempts
    const retryEvents = eventsOf(log).filter((e) => e.kind === 'retry');
    expect(retryEvents.map((e) => (e.kind === 'retry' ? e.attempt : -1))).toEqual([1, 2, 3, 4]);
    expect(eventsOf(log).some((e) => e.kind === 'incident')).toBe(true);
    const jobEnd = eventsOf(log).find((e) => e.kind === 'jobEnd');
    expect(jobEnd).toMatchObject({ kind: 'jobEnd', outcome: 'incident' });
  });

  it('3. an unretryable auth error incidents immediately: exactly one adapter call, no retry event', async () => {
    const log = createLog(() => 0);
    seedOrder(log, 'go');
    const adapter = createScriptedAdapter([{ error: { cls: 'auth', detail: 'bad api key' } }]);
    const executor = makeExecutor();
    const deps = makeDeps({ adapter, executor });

    const outcome = await runJob(log, deps);

    expect(outcome).toBe('incident');
    expect(adapter.requests).toHaveLength(1);
    expect(eventsOf(log).some((e) => e.kind === 'retry')).toBe(false);
    expect(eventsOf(log).some((e) => e.kind === 'incident')).toBe(true);
    const jobEnd = eventsOf(log).find((e) => e.kind === 'jobEnd');
    expect(jobEnd).toMatchObject({ outcome: 'incident' });
  });

  it('4. an abort mid-stream preserves the partial assistant turn (stop aborted), ends the job aborted, and makes no further adapter calls', async () => {
    const log = createLog(() => 0);
    seedOrder(log, 'go');
    const controller = new AbortController();
    const adapter = createScriptedAdapter([
      { events: [{ t: 'text', delta: 'partial reply' }, { t: 'text', delta: ' never sent' }, { t: 'done', stop: 'stop' }] },
    ]);
    const executor = makeExecutor();
    let aborted = false;
    const deps = makeDeps({
      adapter, executor, signal: controller.signal,
      onLive: (parts) => {
        if (parts && parts.length > 0 && !aborted) { aborted = true; controller.abort(); }
      },
    });

    const outcome = await runJob(log, deps);

    expect(outcome).toBe('aborted');
    expect(adapter.requests).toHaveLength(1);
    const jobEnds = eventsOf(log).filter((e) => e.kind === 'jobEnd');
    expect(jobEnds).toHaveLength(1);
    expect(jobEnds[0]).toMatchObject({ outcome: 'aborted' });
    const assistantEvents = eventsOf(log).filter((e) => e.kind === 'assistant');
    expect(assistantEvents).toHaveLength(1);
    const partial = assistantEvents[0];
    expect(partial).toMatchObject({ stop: 'aborted' });
    const parts = partial?.kind === 'assistant' ? partial.parts : [];
    expect(parts.some((p) => p.kind === 'text' && p.text === 'partial reply')).toBe(true);
  });

  it('5. an overflow error runs compaction (visible between the failed and replayed requests) and replays on the compacted window, with no retry event', async () => {
    const log = createLog(() => 0);
    // A compactable TWO-EXCHANGE fixture: a completed prior exchange, then the job's own order.
    // `compact` reads the whole log (not job-scoped), so this gives it two groups to fold between
    // while `runJob`'s own turn/empty counters (scoped to the LAST order) see only the second.
    append(log, { kind: 'order', text: 'an earlier job', mapContext: '' });
    append(log, {
      kind: 'assistant', stop: 'tool-calls',
      parts: [{ kind: 'tool', callId: 'c0', name: 'place_object', input: {}, argsDone: true }],
    });
    append(log, { kind: 'toolResult', callId: 'c0', name: 'place_object', content: 'placed', isError: false });
    seedOrder(log, 'go');

    const adapter = createScriptedAdapter([
      { error: { cls: 'overflow', detail: 'context length exceeded' } },
      { events: [{ t: 'text', delta: 'a short summary' }, { t: 'done', stop: 'stop' }] }, // compact's own summary turn
      textTurn('replayed and done'),
    ]);
    const executor = makeExecutor();
    // A constant per-message cost large enough that the job's own single-event group alone
    // crosses KEEP_RECENT, guaranteeing compact finds a genuine fold (something precedes the cut)
    // without the loop's own pre-turn needsCompaction check tripping first (the whole log's
    // handful of messages stays well under contextWindow - COMPACTION_RESERVE at 9000 each).
    const bigEstimate = (): number => 9000;
    const deps = makeDeps({ adapter, executor, estimate: bigEstimate });

    const outcome = await runJob(log, deps);

    expect(outcome).toBe('done');
    expect(eventsOf(log).some((e) => e.kind === 'retry')).toBe(false);
    expect(eventsOf(log).some((e) => e.kind === 'compaction')).toBe(true);
    expect(adapter.requests).toHaveLength(3);
    expect(adapter.requests[0]?.tools).toEqual(deps.tools);
    expect(adapter.requests[1]?.tools).toEqual([]); // the summary request, between the failed and replayed turns
    expect(adapter.requests[2]?.tools).toEqual(deps.tools);
  });

  it('6. a bad-args call in an otherwise-good batch gets its own reissue toolResult and never reaches the executor, while its sibling runs', async () => {
    const log = createLog(() => 0);
    seedOrder(log, 'go');
    const badArgsTurn: ScriptedTurn = {
      events: [{
        t: 'done', stop: 'tool-calls',
        final: [
          { callId: 'c1', name: 'paint_terrain', rawArgs: '{oops' }, // unparseable: args stays undefined
          { callId: 'c2', name: 'place_object', args: { id: 'tree' }, rawArgs: JSON.stringify({ id: 'tree' }) },
        ],
      }],
    };
    const adapter = createScriptedAdapter([badArgsTurn, textTurn('done')]);
    const executor = makeExecutor();
    const deps = makeDeps({ adapter, executor });

    const outcome = await runJob(log, deps);

    expect(outcome).toBe('done');
    expect(executor.calls).toEqual([{ callId: 'c2', name: 'place_object', args: { id: 'tree' } }]);
    const results = eventsOf(log).filter((e) => e.kind === 'toolResult');
    expect(results).toHaveLength(2);
    const badResult = results.find((r) => r.kind === 'toolResult' && r.callId === 'c1');
    expect(badResult).toMatchObject({ isError: true });
    expect(badResult?.kind === 'toolResult' ? badResult.content : '').toMatch(/Reissue the calls? with complete arguments/);
    const goodResult = results.find((r) => r.kind === 'toolResult' && r.callId === 'c2');
    expect(goodResult).toMatchObject({ isError: false });
  });

  it('7a. a call failing a SECOND time with the same signature, after a write reopened the ground, carries the verbatim-retry escalation on its own result; the first does not', async () => {
    const log = createLog(() => 0);
    seedOrder(log, 'go');
    const call = { callId0: 'c1', callId1: 'c2', name: 'paint_terrain', args: { x: 1 } };
    const adapter = createScriptedAdapter([
      toolTurn([{ callId: call.callId0, name: call.name, args: call.args }]),
      // The write between the two failures is what lets the second one EXECUTE at all: an
      // unchanged map answers an identical retry with the repeat refusal instead.
      toolTurn([{ callId: 'w1', name: 'place_object', args: { x: 5 } }]),
      toolTurn([{ callId: call.callId1, name: call.name, args: call.args }]),
      textTurn('done'),
    ]);
    const executor = makeExecutor({
      writeNames: new Set(['paint_terrain', 'place_object']),
      result: (c) => c.name === 'paint_terrain'
        ? { content: 'boom', isError: true }
        : { content: 'placed', isError: false },
    });
    const deps = makeDeps({ adapter, executor });

    const outcome = await runJob(log, deps);

    expect(outcome).toBe('done');
    const results = eventsOf(log).filter((e) => e.kind === 'toolResult');
    expect(results).toHaveLength(3);
    const contentOf = (callId: string) => results.find((r) => r.kind === 'toolResult' && r.callId === callId)?.kind === 'toolResult'
      ? (results.find((r) => r.kind === 'toolResult' && r.callId === callId) as { content: string }).content
      : '';
    expect(contentOf(call.callId0)).not.toMatch(/has already failed/);
    expect(contentOf(call.callId1)).toMatch(/\(system\).*has already failed/);
  });

  it('7b. a tool reverted a SECOND time carries the change-strategy escalation on its own result; the first does not', async () => {
    const log = createLog(() => 0);
    seedOrder(log, 'go');
    const adapter = createScriptedAdapter([
      toolTurn([{ callId: 'c1', name: 'paint_terrain', args: { x: 1 } }]),
      toolTurn([{ callId: 'c2', name: 'paint_terrain', args: { x: 2 } }]),
      textTurn('done'),
    ]);
    const executor = makeExecutor({ result: () => ({ content: 'reverted', isError: false, detail: { reverted: true } }) });
    const deps = makeDeps({ adapter, executor });

    const outcome = await runJob(log, deps);

    expect(outcome).toBe('done');
    const results = eventsOf(log).filter((e) => e.kind === 'toolResult');
    expect(results).toHaveLength(2);
    const contentOf = (callId: string) => {
      const r = results.find((e) => e.kind === 'toolResult' && e.callId === callId);
      return r?.kind === 'toolResult' ? r.content : '';
    };
    expect(contentOf('c1')).not.toMatch(/strategy/);
    expect(contentOf('c2')).toMatch(/\(system\).*strategy/);
  });

  it('8. two consecutive empty turns get a nudge request each; a third empty turn ends the job done with no further request', async () => {
    const log = createLog(() => 0);
    seedOrder(log, 'go');
    const emptyTurn: ScriptedTurn = { events: [{ t: 'done', stop: 'stop' }] };
    const adapter = createScriptedAdapter([emptyTurn, emptyTurn, emptyTurn]);
    const executor = makeExecutor();
    const deps = makeDeps({ adapter, executor });

    const outcome = await runJob(log, deps);

    // The governor path just ends politely past the third empty turn: no incident, no
    // "(system) Iteration limit" wording (that belongs to the cap, not the empty-turn damper).
    expect(outcome).toBe('done');
    expect(adapter.requests).toHaveLength(3); // the loop gives up rather than sending a 4th request
    const jobEnd = eventsOf(log).find((e) => e.kind === 'jobEnd');
    expect(jobEnd).toMatchObject({ outcome: 'done' });

    const lastMessageOf = (i: number) => {
      const messages = adapter.requests[i]?.messages ?? [];
      return messages[messages.length - 1];
    };
    // The first request carries only the order itself: no nudge yet on an empty streak of 0.
    expect(lastMessageOf(0)).toMatchObject({ role: 'user', text: '<map_context></map_context>\ngo' });
    expect(lastMessageOf(1)).toMatchObject({ role: 'user' });
    expect((lastMessageOf(1) as { text: string }).text).toMatch(/\(system\).*no text and no tool calls/);
    expect(lastMessageOf(2)).toMatchObject({ role: 'user' });
    expect((lastMessageOf(2) as { text: string }).text).toMatch(/\(system\).*no text and no tool calls/);
  });

  it('9. maxTurns 2 appends the cap message on the final request and ends capped even though the model keeps calling tools', async () => {
    const log = createLog(() => 0);
    seedOrder(log, 'go');
    const adapter = createScriptedAdapter([
      toolTurn([{ callId: 'c1', name: 'place_object', args: {} }]),
      toolTurn([{ callId: 'c2', name: 'place_object', args: {} }]), // never executed: the cap ends the job first
    ]);
    const executor = makeExecutor();
    const deps = makeDeps({ adapter, executor, maxTurns: 2 });

    const outcome = await runJob(log, deps);

    expect(outcome).toBe('capped');
    expect(adapter.requests).toHaveLength(2);
    const secondMessages = adapter.requests[1]?.messages ?? [];
    const trailing = secondMessages[secondMessages.length - 1];
    expect(trailing).toMatchObject({ role: 'user' });
    expect((trailing as { text: string }).text).toMatch(/\(system\).*iteration limit is reached/);
    const jobEnd = eventsOf(log).find((e) => e.kind === 'jobEnd');
    expect(jobEnd).toMatchObject({ outcome: 'capped' });
    expect(executor.calls).toEqual([{ callId: 'c1', name: 'place_object', args: {} }]); // c2 never ran
  });

  it('10. the retry attempt count reseeds from the log: a job already holding 4 retry events for the turn in progress exhausts on the very next attempt, never restarting the ladder at 0', async () => {
    const log = createLog(() => 0);
    seedOrder(log, 'go');
    // Simulate a process reload mid-retry-sleep: 4 retry attempts for this still-unfinished turn
    // are already in the log (no assistant event yet, since the turn has never once succeeded),
    // as if an earlier process died and a fresh runJob call is now resuming it. The in-memory
    // `attempt` counter must reseed from this count rather than starting over at 0, or the ladder
    // would grant 4 more attempts than MAX_TURN_RETRIES allows across the reload.
    for (let attempt = 1; attempt <= 4; attempt++) {
      append(log, { kind: 'retry', attempt, cls: 'rate-limit', delayMs: 1000 });
    }
    const adapter = createScriptedAdapter([{ error: { cls: 'rate-limit', detail: 'still limited' } }]);
    const executor = makeExecutor();
    const { sleep } = fakeSleep();
    const deps = makeDeps({ adapter, executor, sleep });

    const outcome = await runJob(log, deps);

    expect(outcome).toBe('incident');
    expect(adapter.requests).toHaveLength(1); // exactly one more adapter attempt: the 5th overall
    const retryEvents = eventsOf(log).filter((e) => e.kind === 'retry');
    expect(retryEvents).toHaveLength(4); // no 5th retry event logged: it exhausts straight to incident
    expect(eventsOf(log).some((e) => e.kind === 'incident')).toBe(true);
    const jobEnd = eventsOf(log).find((e) => e.kind === 'jobEnd');
    expect(jobEnd).toMatchObject({ outcome: 'incident' });
  });
  it('11. a length-stopped turn tells the next request what happened, so the two requests are not identical', async () => {
    const log = createLog(() => 0);
    seedOrder(log, 'go');
    // The live repeat cycle: the turn stops on `length` with a tool call, whose reissue result is
    // appended, but `DROPPED_STOPS` drops the turn AND that result from the replay window, so with
    // no note the second request is byte-identical to the first, the model re-emits the same
    // oversized call, and the job grinds on to MAX_TURNS. The nudge rides the `appendSystemNote`
    // channel, which is outside the drop window by construction.
    const scripted = createScriptedAdapter([
      toolTurn([{ callId: 'c1', name: 'paint_terrain', args: { x: 1 } }], 'length'),
      textTurn('smaller this time, done'),
    ]);
    const { adapter, snapshots } = withRequestSnapshots(scripted);
    const executor = makeExecutor();
    const deps = makeDeps({ adapter, executor });

    const outcome = await runJob(log, deps);

    expect(outcome).toBe('done');
    expect(snapshots).toHaveLength(2);
    expect(snapshots[1]).not.toEqual(snapshots[0]);
    const trailing = (i: number) => {
      const messages = snapshots[i]?.messages ?? [];
      return messages[messages.length - 1];
    };
    expect(trailing(0)).toMatchObject({ role: 'user', text: '<map_context></map_context>\ngo' });
    expect(trailing(1)).toMatchObject({ role: 'user' });
    expect((trailing(1) as { text: string }).text).toMatch(/\(system\).*cut off/);
  });

  it('12. three length-stopped turns in a row settle an overflow incident rather than grinding to the iteration cap', async () => {
    const log = createLog(() => 0);
    seedOrder(log, 'go');
    const adapter = createScriptedAdapter([
      toolTurn([{ callId: 'c1', name: 'paint_terrain', args: { x: 1 } }], 'length'),
      toolTurn([{ callId: 'c2', name: 'paint_terrain', args: { x: 1 } }], 'length'),
      toolTurn([{ callId: 'c3', name: 'paint_terrain', args: { x: 1 } }], 'length'),
      textTurn('never reached'),
    ]);
    const executor = makeExecutor();
    const deps = makeDeps({ adapter, executor });

    const outcome = await runJob(log, deps);

    expect(outcome).toBe('incident');
    expect(adapter.requests).toHaveLength(3); // no 4th request: the job ends instead of retrying again
    const incident = eventsOf(log).find((e) => e.kind === 'incident');
    expect(incident).toMatchObject({ error: { cls: 'overflow' } });
    expect(incident?.kind === 'incident' ? incident.error.detail : '').toMatch(/output limit/);
    const jobEnd = eventsOf(log).find((e) => e.kind === 'jobEnd');
    expect(jobEnd).toMatchObject({ outcome: 'incident' });
    expect(executor.calls).toHaveLength(0); // every batch was truncation-poisoned
  });

  it('13. three REASONING-ONLY length-stopped turns settle the overflow incident too, never a false `done`', async () => {
    const log = createLog(() => 0);
    seedOrder(log, 'go');
    // An extended-thinking provider can hit its output cap while still reasoning, before any text
    // or tool call lands. Such a turn has neither, so it also reads as EMPTY: with the empty gate
    // standing first in runJob's order, three of them settled `jobEnd {outcome:'done'}` with no
    // summary at all, reporting success for a job that never answered. A truncated turn is the
    // model being cut off, not choosing silence, so it is not an empty turn.
    const adapter = createScriptedAdapter([reasoningTurn('thinking'), reasoningTurn('still thinking'), reasoningTurn('thinking yet')]);
    const executor = makeExecutor();

    const outcome = await runJob(log, makeDeps({ adapter, executor }));

    expect(outcome).toBe('incident');
    expect(eventsOf(log).find((e) => e.kind === 'incident')).toMatchObject({ error: { cls: 'overflow' } });
    const ends = eventsOf(log).filter((e) => e.kind === 'jobEnd');
    expect(ends).toHaveLength(1);
    expect(ends[0]).toMatchObject({ outcome: 'incident' });
    expect(adapter.requests).toHaveLength(3);
  });

  it('13b. three genuinely EMPTY turns the model chose still end the job done, exactly as before', async () => {
    const log = createLog(() => 0);
    seedOrder(log, 'go');
    // The other half of the definition: excluding a truncated turn from "empty" must not stop a
    // real empty streak from reaching its own gate.
    const emptyTurn: ScriptedTurn = { events: [{ t: 'done', stop: 'stop' }] };
    const adapter = createScriptedAdapter([emptyTurn, emptyTurn, emptyTurn]);

    const outcome = await runJob(log, makeDeps({ adapter, executor: makeExecutor() }));

    expect(outcome).toBe('done');
    expect(adapter.requests).toHaveLength(3);
    expect(eventsOf(log).some((e) => e.kind === 'incident')).toBe(false);
    expect(eventsOf(log).find((e) => e.kind === 'jobEnd')).toMatchObject({ outcome: 'done' });
  });

  it('13c. a mixed streak (empty, truncated, empty) fires neither gate early: each counter reads only its own turns', async () => {
    const log = createLog(() => 0);
    seedOrder(log, 'go');
    const emptyTurn: ScriptedTurn = { events: [{ t: 'done', stop: 'stop' }] };
    const scripted = createScriptedAdapter([emptyTurn, reasoningTurn('thinking'), emptyTurn, textTurn('done at last')]);
    const { adapter, snapshots } = withRequestSnapshots(scripted);

    const outcome = await runJob(log, makeDeps({ adapter, executor: makeExecutor() }));

    // Three turns produced nothing, but no THREE of one kind: neither gate may end the job on them.
    expect(outcome).toBe('done');
    expect(snapshots).toHaveLength(4);
    expect(eventsOf(log).some((e) => e.kind === 'incident')).toBe(false);
    const noteOf = (i: number) => {
      const messages = snapshots[i]?.messages ?? [];
      const last = messages[messages.length - 1];
      return last && last.role === 'user' ? last.text : '';
    };
    expect(noteOf(1)).toMatch(/no text and no tool calls/); // the empty turn counted as empty
    expect(noteOf(2)).toMatch(/cut off/); // the truncated turn counted as truncated, not as empty
    expect(noteOf(3)).toMatch(/no text and no tool calls/); // and the empty counter recovers honestly
  });

  it('13d. the length exclusion BREAKS the run rather than skipping past it: [empty, empty, cut off, empty] is a streak of one', async () => {
    const log = createLog(() => 0);
    seedOrder(log, 'go');
    // Transparent skipping (`continue` where the counter says `break`) would read this tail as
    // three empties in a row and settle `done` on the fourth turn, with the job never answered.
    // A truncated turn is not a hole in the empty run, it ENDS it: whatever silence preceded the
    // cut belongs to a stretch the model has since been nudged out of.
    const scripted = createScriptedAdapter([
      EMPTY_TURN, EMPTY_TURN, reasoningTurn('thinking'), EMPTY_TURN, textTurn('finally'),
    ]);
    const { adapter, snapshots } = withRequestSnapshots(scripted);

    const outcome = await runJob(log, makeDeps({ adapter, executor: makeExecutor() }));

    expect(outcome).toBe('done');
    expect(snapshots).toHaveLength(5); // skip-counting would stop at 4, having given up early
    expect(eventsOf(log).find((e) => e.kind === 'jobEnd')).toMatchObject({ outcome: 'done', summary: 'finally' });
    expect(noteAt(snapshots, 4)).toMatch(/no text and no tool calls/); // a streak of ONE, freshly counted
  });

  it('14. a turn that only REASONED is told so, not told it produced nothing', async () => {
    const log = createLog(() => 0);
    seedOrder(log, 'go');
    // A model that thought at length and emitted no text must not be told it "produced no text
    // and no tool calls": that is false about the thinking, and leaves the model no way to tell
    // which half of the sentence to act on.
    const scripted = createScriptedAdapter([thinkingTurn('weighing where the ridge goes'), textTurn('Ridge raised.')]);
    const { adapter, snapshots } = withRequestSnapshots(scripted);

    expect(await runJob(log, makeDeps({ adapter, executor: makeExecutor() }))).toBe('done');

    expect(snapshots).toHaveLength(2);
    expect(noteAt(snapshots, 1)).toMatch(/reasoning/);
    expect(noteAt(snapshots, 1)).not.toMatch(/produced no text and no tool calls/);
  });

  it('14b. a turn with no parts at all still gets the empty nudge: the two shapes stay distinct', async () => {
    const log = createLog(() => 0);
    seedOrder(log, 'go');
    const scripted = createScriptedAdapter([EMPTY_TURN, textTurn('Ridge raised.')]);
    const { adapter, snapshots } = withRequestSnapshots(scripted);

    expect(await runJob(log, makeDeps({ adapter, executor: makeExecutor() }))).toBe('done');

    expect(noteAt(snapshots, 1)).toMatch(/produced no text and no tool calls/);
    expect(noteAt(snapshots, 1)).not.toMatch(/reasoning/);
  });

  it('14c. three reasoning-only turns still settle done with no summary: the bound holds however the silence is spent', async () => {
    const log = createLog(() => 0);
    seedOrder(log, 'go');
    const adapter = createScriptedAdapter([thinkingTurn('one'), thinkingTurn('two'), thinkingTurn('three')]);

    expect(await runJob(log, makeDeps({ adapter, executor: makeExecutor() }))).toBe('done');

    expect(adapter.requests).toHaveLength(3);
    const end = eventsOf(log).find((e) => e.kind === 'jobEnd');
    expect(end).toMatchObject({ outcome: 'done' });
    expect(end).not.toHaveProperty('summary');
  });

  it('14d. a reasoning-only turn the provider CUT OFF is reported as cut off: length outranks the silent reading', async () => {
    const log = createLog(() => 0);
    seedOrder(log, 'go');
    const scripted = createScriptedAdapter([reasoningTurn('thinking'), textTurn('Ridge raised.')]);
    const { adapter, snapshots } = withRequestSnapshots(scripted);

    expect(await runJob(log, makeDeps({ adapter, executor: makeExecutor() }))).toBe('done');

    expect(noteAt(snapshots, 1)).toMatch(/cut off/);
    expect(noteAt(snapshots, 1)).not.toMatch(/State your conclusion/);
  });

  it('14e. the note speaks about the LATEST silent turn, not the oldest one in the run', async () => {
    const log = createLog(() => 0);
    seedOrder(log, 'go');
    // A turn that thought followed by one that did not: "that turn" is the one just seen, so the
    // model is asked about the silence it is actually in rather than about a turn two requests ago.
    const scripted = createScriptedAdapter([thinkingTurn('weighing it'), EMPTY_TURN, textTurn('Ridge raised.')]);
    const { adapter, snapshots } = withRequestSnapshots(scripted);

    expect(await runJob(log, makeDeps({ adapter, executor: makeExecutor() }))).toBe('done');

    expect(noteAt(snapshots, 1)).toMatch(/reasoning/);
    expect(noteAt(snapshots, 2)).toMatch(/produced no text and no tool calls/);
    expect(noteAt(snapshots, 2)).not.toMatch(/reasoning/);
  });

  it('14f. a whitespace-only thought is no thought: the turn is told it produced nothing', async () => {
    const log = createLog(() => 0);
    seedOrder(log, 'go');
    // An adapter that emits a blank reasoning delta (a provider sending an empty
    // `reasoning_content` field, a newline between chunks) still makes the assembler open a
    // reasoning part. A part is not a thought: telling the model "that turn was all reasoning"
    // over whitespace would name work it never did and leave the actual silence unnamed.
    const scripted = createScriptedAdapter([thinkingTurn('   \n  '), textTurn('Ridge raised.')]);
    const { adapter, snapshots } = withRequestSnapshots(scripted);

    expect(await runJob(log, makeDeps({ adapter, executor: makeExecutor() }))).toBe('done');

    expect(noteAt(snapshots, 1)).toMatch(/produced no text and no tool calls/);
    expect(noteAt(snapshots, 1)).not.toMatch(/reasoning/);
  });
});
