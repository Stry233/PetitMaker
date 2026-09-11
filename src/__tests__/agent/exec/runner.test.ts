import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Hoisted above every import (including the transitive `openai` import inside
// agent/exec/runner.ts -> agent/providers/openai.ts) so the region test can inspect exactly what
// base URL the SDK constructor received, the same technique providers/openai.test.ts uses.
const { openAiCtorMock } = vi.hoisted(() => ({ openAiCtorMock: vi.fn() }));
vi.mock('openai', () => {
  class MockOpenAI {
    chat = { completions: { create: vi.fn() } };
    models = { list: vi.fn() };
    constructor(opts: unknown) { openAiCtorMock(opts); }
  }
  return { default: MockOpenAI };
});

import { CommandExecutor } from '../../../core/commands/command-executor';
import { EventBus } from '../../../core/commands/event-bus';
import type { EditorEvents } from '../../../core/model/types';
import { createDefaultRegistry } from '../../../rules';
import { roadLookup } from '../../../state/object-index';
import { makeState } from '../../rules/_helpers';

import { createScriptedAdapter, type ScriptedTurn } from '../../../agent/eval/scripted-adapter';
import { append, eventsOf } from '../../../agent/core/log';
import { answerGate, pendingGate } from '../../../agent/core/gates';
import { deriveView } from '../../../agent/core/project-view';
import type { Part, StreamEvent } from '../../../agent/core/types';
import type { Adapter } from '../../../agent/providers/types';
import { toAnthropicMessages } from '../../../agent/providers/anthropic';
import { buildMapContext, type AgentToolDeps } from '../../../agent/tools/tools';
import { useAgentSession } from '../../../agent/session/store';
import { createRunner, type RunnerConfig } from '../../../agent/exec/runner';

/** Drains the microtask queue: every scripted turn here resolves through promise chains alone (no
 *  real timers), so a fixed, generous number of `await`s is enough to run a job up to its next
 *  genuinely blocking wait (an open gate, or a `runner.active()` false settle). */
async function flush(): Promise<void> {
  for (let i = 0; i < 50; i++) await Promise.resolve();
}

function textTurn(text: string): ScriptedTurn {
  return { events: [{ t: 'text', delta: text }, { t: 'done', stop: 'stop' }] };
}
/** A finished text turn that also hands back provider-raw content blocks, the way the Anthropic
 *  dialect does (a thinking block and its signature, then the text). */
function rawTurn(text: string, signature: string): ScriptedTurn {
  return {
    events: [
      { t: 'text', delta: text },
      { t: 'done', stop: 'stop', raw: [{ type: 'thinking', thinking: 'weighing it up', signature }, { type: 'text', text }] },
    ],
  };
}
function toolTurn(calls: { callId: string; name: string; args?: Record<string, unknown> }[]): ScriptedTurn {
  return { events: [{ t: 'done', stop: 'tool-calls', final: calls.map((c) => ({ callId: c.callId, name: c.name, args: c.args, rawArgs: JSON.stringify(c.args ?? {}) })) }] };
}

/** A fresh state+executor pair on every call, so a spy wrapping this exposes exactly how many
 *  times the runner asked for one. */
function makeToolDepsFactory(): () => AgentToolDeps {
  return () => {
    const state = makeState(20, 20);
    const exec = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry(), roadLookup(state));
    return { getState: () => state, getExecutor: () => exec, getRegion: () => [] };
  };
}

function makeCfg(overrides: Partial<RunnerConfig> = {}): RunnerConfig {
  return {
    providerId: 'claude',
    apiKey: 'test-key',
    model: 'scripted-model',
    oversight: 'yolo',
    makeToolDeps: makeToolDepsFactory(),
    registry: createDefaultRegistry(),
    ...overrides,
  };
}

beforeEach(() => {
  useAgentSession.getState().clearSession();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('exec/runner', () => {
  it('does not publish or clear live output on a replacement session', async () => {
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => { release = resolve; });
    const adapter: Adapter = {
      async *stream() {
        await waiting;
        yield { t: 'text', delta: 'old session output' };
        yield { t: 'done', stop: 'stop' };
      },
      async listModels() { return []; },
    };
    const runner = createRunner(makeCfg({ adapterForTest: adapter }));
    runner.send('go');
    await flush();
    const oldLog = useAgentSession.getState().log;
    useAgentSession.getState().clearSession();
    const freshLive: Part[] = [{ kind: 'text', text: 'new session output', done: false }];
    useAgentSession.setState({ live: freshLive });
    const observed: (readonly Part[] | null)[] = [];
    const unsubscribe = useAgentSession.subscribe((state) => { observed.push(state.live); });
    release();
    await flush();
    unsubscribe();
    expect(runner.active()).toBe(false);
    expect(observed.every((live) => live === freshLive)).toBe(true);
    expect(useAgentSession.getState().live).toBe(freshLive);
    expect(eventsOf(oldLog)[eventsOf(oldLog).length - 1]).toMatchObject({ kind: 'jobEnd', outcome: 'aborted' });
  });

  it('send while idle appends an order and drives a scripted text-only turn to done', async () => {
    // Question-ending closes throughout this file: a zero-write close that hands back to the user
    // settles at once, while a plain one is answered by the loop's delivery nudge first — these
    // tests are about the runner's mechanics, so their scripts close on the settled shape.
    const adapter = createScriptedAdapter([textTurn('All set. Want anything changed?')]);
    const runner = createRunner(makeCfg({ adapterForTest: adapter }));

    runner.send('build a house');
    await flush();

    const log = useAgentSession.getState().log;
    const events = eventsOf(log);
    expect(events.map((e) => e.kind)).toEqual(['order', 'assistant', 'jobEnd']);
    expect(events[events.length - 1]).toMatchObject({ kind: 'jobEnd', outcome: 'done' });
    expect(deriveView(log).phase).toBe('idle');
    expect(runner.active()).toBe(false);
  });

  /**
   * THE TURN AS IT ARRIVES REACHES THE STORE. The loop appends nothing until a turn closes, so the
   * live parts are the panel's ONLY evidence that anything is happening: without this wire the
   * phase never leaves `thinking`, a sentence appears only once it is finished, and a tool call
   * shows no row until its result lands. `LoopDeps.onLive` is that wire.
   */
  it('publishes the streaming parts to the session store, and clears them at the settle', async () => {
    const adapter = createScriptedAdapter([{
      events: [{ t: 'text', delta: 'Levelling ' }, { t: 'text', delta: 'the shore.' }, { t: 'done', stop: 'stop' }],
    }]);
    const runner = createRunner(makeCfg({ adapterForTest: adapter }));
    const seen: (readonly Part[] | null)[] = [];
    const unsub = useAgentSession.subscribe((st) => seen.push(st.live));

    runner.send('level the shore');
    await flush();
    unsub();

    const streamed = seen.filter((parts): parts is readonly Part[] => parts !== null);
    expect(streamed.length, 'nothing was published while the turn streamed').toBeGreaterThan(0);
    expect(streamed.some((parts) => parts.some((p) => p.kind === 'text' && p.text.includes('Levelling')))).toBe(true);
    // A turn that has landed as an event must not also stand as a half-written one.
    expect(useAgentSession.getState().live).toBeNull();
  });

  it('send while running queues a steer, never a second runJob', async () => {
    const adapter = createScriptedAdapter([
      toolTurn([{ callId: 'c1', name: 'inspect_region', args: { x1: 0, y1: 0, x2: 1, y2: 1 } }]),
      textTurn('Done now. Anything else?'),
    ]);
    const runner = createRunner(makeCfg({ adapterForTest: adapter }));

    runner.send('go');
    runner.send('go faster'); // fired while the first job is still mid-flight
    await flush();

    const log = useAgentSession.getState().log;
    expect(eventsOf(log).filter((e) => e.kind === 'order')).toHaveLength(1);
    expect(eventsOf(log).some((e) => e.kind === 'steer' && e.text === 'go faster')).toBe(true);
    expect(adapter.requests).toHaveLength(2); // both turns of the ONE job, never a second job's turn
    expect(deriveView(log).phase).toBe('idle');
  });

  it('send while gated answers the gate with words', async () => {
    const adapter = createScriptedAdapter([
      toolTurn([{ callId: 'c1', name: 'paint_terrain', args: { rect: { x1: 2, y1: 2, x2: 3, y2: 3 }, terrain: 'mountain', elevation: 1 } }]),
      textTurn('Skipped as asked.'),
    ]);
    const runner = createRunner(makeCfg({ adapterForTest: adapter, oversight: 'strict' }));

    runner.send('build something');
    await flush();
    expect(deriveView(useAgentSession.getState().log).phase).toBe('gated');

    runner.send('actually, skip it');
    await flush();

    const log = useAgentSession.getState().log;
    expect(eventsOf(log).find((e) => e.kind === 'gateAnswered')).toMatchObject({ answer: 'words', words: 'actually, skip it' });
    expect(eventsOf(log).some((e) => e.kind === 'toolResult' && e.callId === 'c1')).toBe(false);
    expect(deriveView(log).phase).toBe('idle');
  });

  it('pause then a further send resumes the same job with a second runJob', async () => {
    const adapter = createScriptedAdapter([
      toolTurn([{ callId: 'c1', name: 'inspect_region', args: { x1: 0, y1: 0, x2: 1, y2: 1 } }]),
      textTurn('Resumed and done. Anything else?'),
    ]);
    const runner = createRunner(makeCfg({ adapterForTest: adapter }));

    runner.send('go');
    runner.pause();
    await flush();

    let log = useAgentSession.getState().log;
    expect(deriveView(log).phase).toBe('paused');
    expect(runner.active()).toBe(false);

    runner.send('continue please');
    await flush();

    log = useAgentSession.getState().log;
    const events = eventsOf(log);
    expect(events.filter((e) => e.kind === 'resumed')).toHaveLength(1);
    expect(events[events.length - 1]).toMatchObject({ kind: 'jobEnd', outcome: 'done' });
    expect(adapter.requests).toHaveLength(2); // the second runJob replayed both scripted turns
    expect(JSON.stringify(adapter.requests[adapter.requests.length - 1])).toContain('continue please');
    expect(deriveView(log).phase).toBe('idle');
  });

  it('pause() on an already-settled paused session appends nothing, and resume still works', async () => {
    const adapter = createScriptedAdapter([textTurn('finally done')]);
    const runner = createRunner(makeCfg({ adapterForTest: adapter }));

    runner.send('go');
    runner.pause();
    await flush();

    const log = useAgentSession.getState().log;
    expect(deriveView(log).phase).toBe('paused');
    expect(eventsOf(log).filter((e) => e.kind === 'pauseRequested')).toHaveLength(1);

    // pause() again on an already-settled 'paused' log (no job in flight) must not append a SECOND
    // pauseRequested: that sticks the projected phase at 'pausing' forever, and from there a
    // further send only queues a steer nobody delivers while resume() no-ops.
    runner.pause();
    expect(eventsOf(log).filter((e) => e.kind === 'pauseRequested')).toHaveLength(1);
    expect(deriveView(log).phase).toBe('paused');

    runner.resume();
    await flush();

    const events = eventsOf(log);
    expect(events[events.length - 1]).toMatchObject({ kind: 'jobEnd', outcome: 'done' });
    expect(deriveView(log).phase).toBe('idle');
  });

  /**
   * SET-ASIDE IS THE OTHER ANSWER TO A HOLD, and it has to SETTLE the job rather than hide it.
   *
   * A paused job owns the composer's resume route and the session's current seat, so a panel that
   * only put its card away would be one with no way to a fresh order and a dock still reporting a
   * hold nothing is showing. `aborted` is what the outcome already means — a run the user stopped.
   */
  it('setAside settles a held job as aborted, and leaves a live one to stop()', async () => {
    const adapter = createScriptedAdapter([
      toolTurn([{ callId: 'c1', name: 'inspect_region', args: { x1: 0, y1: 0, x2: 1, y2: 1 } }]),
      textTurn('never reached'),
    ]);
    const runner = createRunner(makeCfg({ adapterForTest: adapter }));

    runner.send('go');
    runner.pause();
    await flush();

    const log = useAgentSession.getState().log;
    expect(deriveView(log).phase).toBe('paused');

    runner.setAside();
    const events = eventsOf(log);
    expect(events[events.length - 1]).toMatchObject({ kind: 'jobEnd', outcome: 'aborted' });
    expect(deriveView(log).phase).toBe('aborted');

    // A second press answers nothing: the job has already settled, so there is no hold to put away.
    runner.setAside();
    expect(eventsOf(log).filter((e) => e.kind === 'jobEnd')).toHaveLength(1);
  });

  /**
   * A KEY GOING AWAY CALLS `stop()`, AND AN ABORT REACHES NOTHING ON A HELD JOB. `settings.ts`'s
   * `forgetKey` aborts first so the record survives the disconnection, but a paused job has no loop
   * to abort: `inflight` is undefined, `abortController?.abort()` settles nothing, and the job stood
   * at `paused` forever with its partial edits on the map and no `jobEnd` on the log — no phase the
   * panel could read as news, and no rewind reachable.
   */
  it('stop() settles a HELD job, since there is no loop to abort', async () => {
    const adapter = createScriptedAdapter([
      toolTurn([{ callId: 'c1', name: 'inspect_region', args: { x1: 0, y1: 0, x2: 1, y2: 1 } }]),
      textTurn('never reached'),
    ]);
    const runner = createRunner(makeCfg({ adapterForTest: adapter }));

    runner.send('go');
    runner.pause();
    await flush();

    const log = useAgentSession.getState().log;
    expect(deriveView(log).phase).toBe('paused');

    runner.stop();
    expect(eventsOf(log)[eventsOf(log).length - 1]).toMatchObject({ kind: 'jobEnd', outcome: 'aborted' });
    expect(deriveView(log).phase).toBe('aborted');

    // And it stays idempotent: a second stop has nothing left to settle.
    runner.stop();
    expect(eventsOf(log).filter((e) => e.kind === 'jobEnd')).toHaveLength(1);
  });

  it('stop() on a session holding nothing appends nothing at all', async () => {
    const adapter = createScriptedAdapter([textTurn('done')]);
    const runner = createRunner(makeCfg({ adapterForTest: adapter }));

    runner.stop(); // never ran anything
    expect(eventsOf(useAgentSession.getState().log)).toHaveLength(0);

    runner.send('go');
    await flush();
    const before = eventsOf(useAgentSession.getState().log).length;
    runner.stop(); // a settled session
    expect(eventsOf(useAgentSession.getState().log)).toHaveLength(before);
  });

  /**
   * THE INVARIANT LIVES AT THE APPEND SITE, NOT AT THE DRAW SITE. Every surface withholds Pause
   * while a gate stands, but `askGate` appends `gateAsked` from a promise continuation — outside any
   * React event handler — so the subscription SCHEDULES rather than commits, and for one frame the
   * DOM shows a Pause over a log that is already gated. A `pointerdown` already travelling then
   * lands `pauseRequested`: the phase goes `pausing`, the projection withholds the gate, and the
   * loop's `awaitGate` is left parked with no question on screen.
   */
  it('pause() refuses while a gate is standing, whatever the surface offered', async () => {
    const adapter = createScriptedAdapter([
      toolTurn([{ callId: 'c1', name: 'paint_terrain', args: { rect: { x1: 2, y1: 2, x2: 3, y2: 3 }, terrain: 'mountain', elevation: 1 } }]),
      textTurn('carried on'),
    ]);
    const runner = createRunner(makeCfg({ adapterForTest: adapter, oversight: 'strict' }));

    runner.send('build something');
    await flush();
    const log = useAgentSession.getState().log;
    expect(deriveView(log).phase).toBe('gated');
    expect(pendingGate(log)).toBeTruthy();

    runner.pause();
    expect(eventsOf(log).some((e) => e.kind === 'pauseRequested')).toBe(false);
    expect(deriveView(log).phase).toBe('gated');

    // The gate still answers, and the job runs on: nothing was parked.
    answerGate(log, pendingGate(log)!.gateId, 'allow');
    await flush();
    expect(deriveView(log).phase).toBe('idle');
  });

  /**
   * OVERSIGHT IS READ AT THE GATE DECISION, NOT AT LAUNCH.
   *
   * The manage card is reachable while a job runs, and its oversight row writes straight through to
   * the runner's config object (`ui/agent/panel-runner.ts` mutates it in place), so the tier a call
   * is judged against is the one standing when that call arrives.
   *
   * The change lands BETWEEN two calls, which is where a user makes it: the second scripted turn is
   * a function, so it runs after the first write has settled and before the second is minted.
   */
  const writeCall = (callId: string, x: number): ScriptedTurn => toolTurn([{
    callId,
    name: 'paint_terrain',
    args: { rect: { x1: x, y1: 2, x2: x + 1, y2: 3 }, terrain: 'mountain', elevation: 1 },
  }]);
  const eventsOfTurn = (turn: ScriptedTurn): StreamEvent[] => (turn as { events: StreamEvent[] }).events;

  it('tightening oversight mid-run gates the NEXT write', async () => {
    const cfg = makeCfg({ oversight: 'yolo' });
    cfg.adapterForTest = createScriptedAdapter([
      writeCall('c1', 2),
      () => { cfg.oversight = 'strict'; return eventsOfTurn(writeCall('c2', 6)); },
      textTurn('all done'),
    ]);
    const runner = createRunner(cfg);

    runner.send('build something');
    await flush();

    const log = useAgentSession.getState().log;
    expect(eventsOf(log).some((e) => e.kind === 'toolResult' && e.callId === 'c1')).toBe(true);
    expect(deriveView(log).phase).toBe('gated');
    expect(pendingGate(log)?.callId).toBe('c2');
  });

  it('loosening oversight mid-run stops asking', async () => {
    const cfg = makeCfg({ oversight: 'strict' });
    cfg.adapterForTest = createScriptedAdapter([
      writeCall('c1', 2),
      writeCall('c2', 6),
      textTurn('all done'),
    ]);
    const runner = createRunner(cfg);

    runner.send('build something');
    await flush();
    const log = useAgentSession.getState().log;
    expect(pendingGate(log)?.callId).toBe('c1');

    // The one question is answered, and the user decides not to be asked the next one.
    cfg.oversight = 'yolo';
    answerGate(log, pendingGate(log)!.gateId, 'allow');
    await flush();

    expect(eventsOf(log).some((e) => e.kind === 'toolResult' && e.callId === 'c2')).toBe(true);
    expect(eventsOf(log).filter((e) => e.kind === 'gateAsked')).toHaveLength(1);
    expect(deriveView(log).phase).toBe('idle');
  });

  it('setAside is a no-op on a session that is not holding anything', async () => {
    const adapter = createScriptedAdapter([textTurn('done')]);
    const runner = createRunner(makeCfg({ adapterForTest: adapter }));

    runner.setAside(); // an idle session
    expect(eventsOf(useAgentSession.getState().log)).toHaveLength(0);

    runner.send('go');
    await flush();
    const before = eventsOf(useAgentSession.getState().log).length;
    runner.setAside(); // a settled one
    expect(eventsOf(useAgentSession.getState().log)).toHaveLength(before);
  });

  it('a throw during the job redacts a leaked key before it reaches the incident', async () => {
    const leak = 'sk-abcdefghijklmnopqrstuvwx';
    // A misbehaving adapter (the "should be impossible" case the runner's own catch defends
    // against): a real adapter's `stream()` contract never throws, but a buggy one might, and its
    // exception can quote request/response details the same way a crashed tool's message can.
    const throwingAdapter: Adapter = {
      async *stream() {
        throw new Error(`network failure, key=${leak} rejected`);
      },
      async listModels() {
        return [];
      },
    };
    const runner = createRunner(makeCfg({ adapterForTest: throwingAdapter }));

    runner.send('go');
    await flush();

    const log = useAgentSession.getState().log;
    const incident = eventsOf(log).find((e) => e.kind === 'incident');
    expect(incident).toBeDefined();
    const detail = (incident as unknown as { error: { detail: string } }).error.detail;
    expect(detail).not.toContain(leak);
    expect(detail).toContain('<redacted-key>');
    expect(runner.active()).toBe(false);
  });

  it('a region-split provider (zhipu, region 1) builds its adapter against the CN base URL', async () => {
    const runner = createRunner(makeCfg({ providerId: 'zhipu', apiKey: 'zhipu-key', region: 1 }));

    runner.send('go');
    runner.stop(); // abort before the mocked client is ever asked to stream anything
    await flush();

    expect(openAiCtorMock).toHaveBeenCalledWith(
      expect.objectContaining({ baseURL: 'https://open.bigmodel.cn/api/paas/v4' }),
    );
  });

  /** The editor's display language is the system prompt's `{uiLanguage}` fallback: which language to
   *  open in before the user has typed anything readable. It rides on the config, so a runner that
   *  is not told falls back to English — for the whole app, not one seam. */
  it('speaks the editor\'s display language into the system prompt, and English when told none', async () => {
    const adapter = createScriptedAdapter([textTurn('好的。')]);
    const runner = createRunner(makeCfg({ adapterForTest: adapter, uiLocale: 'zh' }));
    runner.send('build a house');
    await flush();
    expect(adapter.requests[0]!.system).toContain('Simplified Chinese');
    expect(adapter.requests[0]!.system).not.toContain('({uiLanguage})');

    useAgentSession.getState().clearSession();
    const bare = createScriptedAdapter([textTurn('All set.')]);
    createRunner(makeCfg({ adapterForTest: bare })).send('build a house');
    await flush();
    expect(bare.requests[0]!.system).toContain('English');
    expect(bare.requests[0]!.system).not.toContain('Simplified Chinese');
  });

  it('send writes the real, non-empty map context onto the order event', async () => {
    const factory = makeToolDepsFactory();
    let captured: AgentToolDeps | undefined;
    const makeToolDeps = vi.fn((): AgentToolDeps => {
      captured = factory();
      return captured;
    });
    const adapter = createScriptedAdapter([textTurn('ok')]);
    const runner = createRunner(makeCfg({ adapterForTest: adapter, makeToolDeps }));

    runner.send('build a house');
    await flush();

    const log = useAgentSession.getState().log;
    const order = eventsOf(log).find((e) => e.kind === 'order');
    expect(order).toBeDefined();
    const mapContext = (order as unknown as { mapContext: string }).mapContext;
    expect(mapContext).not.toBe('');
    expect(captured).toBeDefined();
    expect(mapContext).toBe(buildMapContext(captured!.getState(), captured!.getRegion(), captured!));
  });

  it('send stamps the filed region onto the order event when the store has a painted region, and omits it for an empty one', async () => {
    const factory = makeToolDepsFactory();
    const paintedCells = [{ x: 2, y: 3 }, { x: 5, y: 9 }];
    const makeToolDepsWithRegion = (): AgentToolDeps => ({ ...factory(), getRegion: () => paintedCells });

    const adapter1 = createScriptedAdapter([textTurn('ok')]);
    const runner1 = createRunner(makeCfg({ adapterForTest: adapter1, makeToolDeps: makeToolDepsWithRegion }));
    runner1.send('build a house');
    await flush();
    const order1 = eventsOf(useAgentSession.getState().log).find((e) => e.kind === 'order');
    expect(order1).toMatchObject({ region: { count: 2, x1: 2, y1: 3, x2: 5, y2: 9 } });

    useAgentSession.getState().clearSession();
    const adapter2 = createScriptedAdapter([textTurn('ok')]);
    const runner2 = createRunner(makeCfg({ adapterForTest: adapter2 })); // default factory: getRegion() => []
    runner2.send('build a house');
    await flush();
    const order2 = eventsOf(useAgentSession.getState().log).find((e) => e.kind === 'order');
    expect((order2 as { region?: unknown } | undefined)?.region).toBeUndefined();
  });

  it('stop aborts: outcome aborted, no adapter call after', async () => {
    const adapter = createScriptedAdapter([textTurn('never gets here')]);
    const runner = createRunner(makeCfg({ adapterForTest: adapter }));

    runner.send('go');
    runner.stop();
    await flush();

    const log = useAgentSession.getState().log;
    const events = eventsOf(log);
    expect(events[events.length - 1]).toMatchObject({ kind: 'jobEnd', outcome: 'aborted' });
    expect(adapter.requests).toHaveLength(0);
    expect(runner.active()).toBe(false);
  });

  /** The dock's retry countdown presses `retryNow()` to end the ladder's own backoff early; this
   *  must resolve the pending sleep WITHOUT the fake clock ever advancing, since a real countdown
   *  press does not wait out the delay it is cutting short. */
  it('retryNow() during the retry backoff lets the job finish without advancing fake time', async () => {
    vi.useFakeTimers();
    const adapter = createScriptedAdapter([
      { error: { cls: 'rate-limit', detail: 'slow down', retryAfterMs: 30000 } },
      textTurn('Done after the retry. Anything else?'),
    ]);
    const runner = createRunner(makeCfg({ adapterForTest: adapter }));

    runner.send('go');
    await flush();

    let log = useAgentSession.getState().log;
    expect(eventsOf(log).some((e) => e.kind === 'retry')).toBe(true);
    expect(deriveView(log).phase).toBe('retrying'); // still mid-job, sitting in the backoff sleep

    runner.retryNow();
    await flush();

    log = useAgentSession.getState().log;
    const events = eventsOf(log);
    expect(events[events.length - 1]).toMatchObject({ kind: 'jobEnd', outcome: 'done' });
    expect(adapter.requests).toHaveLength(2);
    expect(runner.active()).toBe(false);
  });

  it('retryNow() with no retry pending is a no-op', async () => {
    const adapter = createScriptedAdapter([textTurn('all set')]);
    const runner = createRunner(makeCfg({ adapterForTest: adapter }));

    expect(() => runner.retryNow()).not.toThrow();

    runner.send('go');
    await flush();

    const log = useAgentSession.getState().log;
    expect(eventsOf(log)[eventsOf(log).length - 1]).toMatchObject({ kind: 'jobEnd', outcome: 'done' });
  });

  it('makeToolDeps is called fresh per job start', async () => {
    const spy = vi.fn(makeToolDepsFactory());
    const adapter = createScriptedAdapter([textTurn('first'), textTurn('second')]);
    const runner = createRunner(makeCfg({ adapterForTest: adapter, makeToolDeps: spy }));

    runner.send('job one');
    await flush();
    expect(deriveView(useAgentSession.getState().log).phase).toBe('idle');

    runner.send('job two');
    await flush();

    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('a second send in the same tick as the first yields one order event (reentry joins)', async () => {
    const adapter = createScriptedAdapter([textTurn('Where should the house go?')]);
    const runner = createRunner(makeCfg({ adapterForTest: adapter }));

    runner.send('build a house'); // double-click: both calls fire before any await runs
    runner.send('build a house');
    await flush();

    const log = useAgentSession.getState().log;
    expect(eventsOf(log).filter((e) => e.kind === 'order')).toHaveLength(1);
    expect(adapter.requests).toHaveLength(1);
  });

  it('a reload with a leftover unresolved call executes it once even under a rapid double send', async () => {
    const { log } = useAgentSession.getState();
    const toolDeps = makeToolDepsFactory()();
    const exec = toolDeps.getExecutor();
    const before = exec.getUndoStackSize();
    const args = { rect: { x1: 2, y1: 2, x2: 3, y2: 3 }, terrain: 'mountain', elevation: 1 };

    // The shape a page reload leaves behind: an order, an assistant turn with one unresolved
    // write call, and the persisted layer's synthetic pause tail — nothing has executed yet.
    append(log, { kind: 'order', text: 'build something', mapContext: '' });
    append(log, {
      kind: 'assistant',
      parts: [{ kind: 'tool', callId: 'c1', name: 'paint_terrain', input: args, argsDone: true }],
      stop: 'tool-calls',
    });
    append(log, { kind: 'paused' });

    const adapter = createScriptedAdapter([textTurn('continued and done')]);
    const runner = createRunner(makeCfg({ adapterForTest: adapter, makeToolDeps: () => toolDeps }));

    runner.send('continue'); // double-click: both fire before any await runs
    runner.send('continue');
    await flush();

    const events = eventsOf(log);
    expect(events.filter((e) => e.kind === 'resumed')).toHaveLength(1);
    expect(events.filter((e) => e.kind === 'toolResult' && e.callId === 'c1')).toHaveLength(1);
    expect(exec.getUndoStackSize()).toBe(before + 1); // the write ran exactly once
    expect(events[events.length - 1]).toMatchObject({ kind: 'jobEnd', outcome: 'done' });
  });

  it('delegate_task is really wired: the child runs on the SAME adapter, and under strict oversight its write gate mirrors onto the parent log', async () => {
    // One scripted adapter serves BOTH the parent job and the child job the runner spawns for it
    // (exactly what `createRunner`'s `launch()` wires: one `buildAdapter` call, reused as both
    // `loopDeps.adapter` and `delegateOpts.adapter`) — turns in the order each side asks for one:
    // the parent's delegate call, then the child's own two turns, then the parent's closing turn.
    const adapter = createScriptedAdapter([
      toolTurn([{ callId: 'd1', name: 'delegate_task', args: { task: 'raise a small hill' } }]),
      toolTurn([{ callId: 'c1', name: 'paint_terrain', args: { rect: { x1: 2, y1: 2, x2: 3, y2: 3 }, terrain: 'mountain', elevation: 1 } }]),
      textTurn('child done'),
      textTurn('All set with the helper task.'),
    ]);
    const runner = createRunner(makeCfg({ adapterForTest: adapter, oversight: 'strict' }));

    runner.send('get some help');
    await flush();

    // Gate 1: the parent's OWN call to delegate_task (itself a write tool, gated like any other
    // under strict oversight) before the runner ever reaches `delegateTask`.
    let log = useAgentSession.getState().log;
    expect(deriveView(log).phase).toBe('gated');
    const gate1 = pendingGate(log);
    expect(gate1).toBeDefined();
    answerGate(log, gate1!.gateId, 'allow');
    await flush();

    // Gate 2: the CHILD's own paint_terrain write, gated under the same strict oversight on its
    // own log, mirrored onto the parent log by `bridgeChildGates` (never answerable directly on
    // a log this test, or a human, never sees).
    log = useAgentSession.getState().log;
    expect(deriveView(log).phase).toBe('gated');
    const gate2 = pendingGate(log);
    expect(gate2).toBeDefined();
    expect(gate2!.gateId).not.toBe(gate1!.gateId);
    expect(gate2!.summary).toContain('paint_terrain');
    answerGate(log, gate2!.gateId, 'allow');
    await flush();

    log = useAgentSession.getState().log;
    const events = eventsOf(log);
    const delegateResult = events.find((e) => e.kind === 'toolResult' && e.callId === 'd1');
    expect(delegateResult).toMatchObject({ content: 'child done', isError: false });
    expect(events[events.length - 1]).toMatchObject({ kind: 'jobEnd', outcome: 'done' });
    expect(deriveView(log).phase).toBe('idle');
    expect(runner.active()).toBe(false);
    expect(adapter.requests).toHaveLength(4); // every scripted turn consumed, parent and child alike
  });

  it('the runner wires onChildProgress so the helper lane can watch the live child', async () => {
    const adapter = createScriptedAdapter([
      toolTurn([{ callId: 'd1', name: 'delegate_task', args: { task: 'raise a small hill' } }]),
      toolTurn([{ callId: 'c1', name: 'paint_terrain', args: { rect: { x1: 2, y1: 2, x2: 3, y2: 3 }, terrain: 'mountain', elevation: 1 } }]),
      textTurn('child done'),
      textTurn('All set with the helper task.'),
    ]);
    const runner = createRunner(makeCfg({ adapterForTest: adapter, oversight: 'strict' }));

    runner.send('get some help');
    await flush();

    // Gate 1: the parent's own delegate_task call.
    let log = useAgentSession.getState().log;
    const gate1 = pendingGate(log);
    expect(gate1).toBeDefined();
    answerGate(log, gate1!.gateId, 'allow');
    await flush();

    // The child job is now running (its order + tool-call are on its own log, mirrored gate
    // pending on the parent log); the helper lane already has a live view of it, before its
    // first write has landed.
    expect(useAgentSession.getState().childLive).toEqual({ task: 'raise a small hill', ops: 0 });

    // Gate 2: the child's own write, mirrored onto the parent log.
    log = useAgentSession.getState().log;
    const gate2 = pendingGate(log);
    expect(gate2).toBeDefined();
    answerGate(log, gate2!.gateId, 'allow');
    await flush();

    // The delegate call has returned (however it ends), so the lane goes back to empty.
    expect(useAgentSession.getState().childLive).toBeNull();
    log = useAgentSession.getState().log;
    expect(eventsOf(log)[eventsOf(log).length - 1]).toMatchObject({ kind: 'jobEnd', outcome: 'done' });
  });

  it('clearSession mid-run orphans the job safely: it aborts on the OLD log, runs no further tool, and a fresh send on the NEW log starts cleanly', async () => {
    const adapter = createScriptedAdapter([
      toolTurn([{ callId: 'c1', name: 'paint_terrain', args: { rect: { x1: 2, y1: 2, x2: 3, y2: 3 }, terrain: 'mountain', elevation: 1 } }]),
      textTurn('should never run'),
    ]);
    const runner = createRunner(makeCfg({ adapterForTest: adapter, oversight: 'strict' }));

    runner.send('build something');
    await flush();

    const oldLog = useAgentSession.getState().log;
    expect(deriveView(oldLog).phase).toBe('gated'); // mid-run: waiting on the write gate, never answered
    expect(runner.active()).toBe(true);

    useAgentSession.getState().clearSession(); // swaps the store's log out from under the live job
    await flush();

    // The abort, and its jobEnd, land on the OLD log — the one the orphaned job actually held.
    const oldEvents = eventsOf(oldLog);
    expect(oldEvents[oldEvents.length - 1]).toMatchObject({ kind: 'jobEnd', outcome: 'aborted' });
    expect(oldEvents.some((e) => e.kind === 'toolResult')).toBe(false); // the gated call never executed
    expect(adapter.requests).toHaveLength(1); // only the pre-gate turn; the post-gate turn never ran
    expect(runner.active()).toBe(false);

    // The store's current log is the fresh one clearSession adopted, untouched by the orphan.
    const newLog = useAgentSession.getState().log;
    expect(newLog).not.toBe(oldLog);
    expect(eventsOf(newLog)).toHaveLength(0);

    // A fresh send on it starts a clean job with no trace of the aborted run.
    const adapter2 = createScriptedAdapter([textTurn('Fresh and clean. What shall I build?')]);
    const runner2 = createRunner(makeCfg({ adapterForTest: adapter2 }));
    runner2.send('start again');
    await flush();

    const events2 = eventsOf(useAgentSession.getState().log);
    expect(events2.map((e) => e.kind)).toEqual(['order', 'assistant', 'jobEnd']);
    expect(events2[events2.length - 1]).toMatchObject({ kind: 'jobEnd', outcome: 'done' });
    expect(runner2.active()).toBe(false);
  });

  it('a composed strict-oversight + region-lock job: the gated write straying outside the region is refused with OUT OF REGION, detail.regionBlocked, and no change outside the region', async () => {
    const state = makeState(20, 20);
    const exec = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry(), roadLookup(state));
    const region: { x: number; y: number }[] = [];
    for (let y = 1; y <= 4; y++) for (let x = 1; x <= 4; x++) region.push({ x, y });
    const toolDeps: AgentToolDeps = { getState: () => state, getExecutor: () => exec, getRegion: () => region };
    const before = exec.getUndoStackSize();

    const adapter = createScriptedAdapter([
      toolTurn([{ callId: 'c1', name: 'paint_terrain', args: { rect: { x1: 2, y1: 2, x2: 9, y2: 9 }, terrain: 'mountain', elevation: 1 } }]),
      textTurn('done'),
    ]);
    const runner = createRunner(makeCfg({ adapterForTest: adapter, oversight: 'strict', makeToolDeps: () => toolDeps }));

    runner.send('paint a big square');
    await flush();

    let log = useAgentSession.getState().log;
    expect(deriveView(log).phase).toBe('gated');
    const gate = pendingGate(log);
    expect(gate).toBeDefined();
    answerGate(log, gate!.gateId, 'allow'); // the gate says yes; the region rule still says no
    await flush();

    log = useAgentSession.getState().log;
    const toolResult = eventsOf(log).find((e) => e.kind === 'toolResult' && e.callId === 'c1') as
      { content: string; isError: boolean; detail?: { regionBlocked?: boolean } } | undefined;
    expect(toolResult).toBeDefined();
    expect(toolResult!.isError).toBe(true);
    expect(toolResult!.content).toContain('OUT OF REGION');
    expect(toolResult!.content).toContain('(1,1)-(4,4)');
    expect(toolResult!.detail?.regionBlocked).toBe(true);
    expect(state.cells[9]![9]!.terrain).toBeNull(); // outside the region, untouched
    expect(state.cells[2]![2]!.terrain).toBeNull(); // all-or-nothing: even the in-region part never landed
    expect(exec.getUndoStackSize()).toBe(before);
    expect(deriveView(useAgentSession.getState().log).phase).toBe('idle');
  });
});

/**
 * A RUNNING JOB IS ONE CONTRACT.
 *
 * The panel mutates the runner's config in place, so every connection field can move under a job in
 * flight. The rule is that none of them reaches it: `launch()` builds the adapter and copies the
 * model out, so a job's every turn goes to one host as one author, and the change applies from the
 * next order. A mid-thought swap would change the author mid-sentence, and on the Anthropic dialect
 * it would feed one model's signed thinking blocks to another.
 *
 * OVERSIGHT IS THE DELIBERATE EXCEPTION, pinned by the gate tests: it is read through a getter
 * because a tier the user tightens mid-run has to reach the next write.
 */
describe('exec/runner: a running job keeps the connection it launched with', () => {
  /** A three-turn job, so there are later turns for a mid-run change to reach. */
  function threeTurnJob(): ScriptedTurn[] {
    return [
      toolTurn([{ callId: 'c1', name: 'get_map_stats', args: {} }]),
      toolTurn([{ callId: 'c2', name: 'get_map_stats', args: {} }]),
      textTurn('Measured twice. Anything else?'),
    ];
  }

  it('sends every turn of the job on the launch model, however the armed one moves', async () => {
    const adapter = createScriptedAdapter(threeTurnJob());
    const cfg = makeCfg({ adapterForTest: adapter, model: 'model-a' });
    const runner = createRunner(cfg);

    runner.send('go');
    cfg.model = 'model-b'; // the user arms another model while the first turn is in flight
    await flush();

    expect(adapter.requests.map((r) => r.model)).toEqual(['model-a', 'model-a', 'model-a']);
    expect(runner.active()).toBe(false);
  });

  it('gives the next order the newly armed model, so the change is applied and not dropped', async () => {
    const adapter = createScriptedAdapter([...threeTurnJob(), textTurn('Second order done. Anything else?')]);
    const cfg = makeCfg({ adapterForTest: adapter, model: 'model-a' });
    const runner = createRunner(cfg);

    runner.send('first order');
    cfg.model = 'model-b';
    await flush();
    runner.send('second order');
    await flush();

    expect(adapter.requests.map((r) => r.model)).toEqual(['model-a', 'model-a', 'model-a', 'model-b']);
  });

  it('reports the launch connection while the job runs, and nothing once it settles', async () => {
    const adapter = createScriptedAdapter(threeTurnJob());
    const cfg = makeCfg({
      adapterForTest: adapter, model: 'model-a', providerId: 'custom', customBaseUrl: 'https://gw.example/v1',
    });
    const runner = createRunner(cfg);

    expect(runner.connection()).toBeUndefined();
    runner.send('go');
    expect(runner.connection()).toEqual({ providerId: 'custom', model: 'model-a', customBaseUrl: 'https://gw.example/v1' });

    // The armed answer moves; the launched one does not, which is what lets a settings card show both.
    cfg.model = 'model-b';
    cfg.customBaseUrl = 'https://other.example/v1';
    expect(runner.connection()).toEqual({ providerId: 'custom', model: 'model-a', customBaseUrl: 'https://gw.example/v1' });

    await flush();
    expect(runner.connection()).toBeUndefined();
  });

  /** The endpoint's own half of the same rule: the adapter is built once per launch, so a base URL
   *  edited mid-run reaches no request of the job in flight and every request of the next one. */
  it('builds the adapter once per job, so a mid-run endpoint edit reaches only the next one', async () => {
    openAiCtorMock.mockClear();
    const cfg = makeCfg({ providerId: 'custom', customBaseUrl: 'https://first.example/v1', model: 'm' });
    const runner = createRunner(cfg);

    runner.send('first order');
    cfg.customBaseUrl = 'https://second.example/v1';
    await flush();
    runner.send('second order');
    await flush();

    expect(openAiCtorMock.mock.calls.map((c) => (c[0] as { baseURL?: string }).baseURL))
      .toEqual(['https://first.example/v1', 'https://second.example/v1']);
  });

  /**
   * THE DISPLAY LANGUAGE HAS A FOOT IN BOTH CAMPS, and this is the half that is a connection fact: it
   * is the system prompt's opening language, built once per launch with everything else. Its OTHER
   * role, the words on screen, is environmental and moves the instant the user changes it.
   */
  it('builds the system prompt once per job, so a language change reaches the next one', async () => {
    const adapter = createScriptedAdapter([...threeTurnJob(), textTurn('Second order done. Anything else?')]);
    const cfg = makeCfg({ adapterForTest: adapter, uiLocale: 'en' });
    const runner = createRunner(cfg);

    runner.send('first order');
    cfg.uiLocale = 'ja';
    await flush();
    runner.send('second order');
    await flush();

    const systems = adapter.requests.map((r) => r.system);
    expect(new Set(systems.slice(0, 3)).size, 'one prompt for the whole job').toBe(1);
    expect(systems[3], 'and the next job is built afresh').not.toBe(systems[0]);
  });

  /**
   * THE REPLAY PATH STAYS COHERENT ACROSS A MID-RUN CHANGE, which is the one way this rule could
   * corrupt something rather than merely surprise someone.
   *
   * `rawModel` is stamped with the model the turn was actually SENT to (`loop.ts` reads `deps.model`,
   * the launch copy), so a change made mid-job cannot mislabel bytes the previous model minted. The
   * next job then reads the log honestly: its own model did not produce that raw, so `sameModel` is
   * false and the Anthropic dialect rebuilds the history from the neutral fields instead of echoing
   * signatures the new model would reject.
   */
  it('stamps raw with the model that produced it, so the next job replays nothing it should not', async () => {
    const adapter = createScriptedAdapter([rawTurn('one done, more?','sig-a'), rawTurn('two done, more?','sig-b')]);
    const cfg = makeCfg({ adapterForTest: adapter, model: 'model-a' });
    const runner = createRunner(cfg);

    runner.send('first order');
    cfg.model = 'model-b'; // mid-run, and the turn still goes out on model-a
    await flush();

    const assistant = eventsOf(useAgentSession.getState().log).filter((e) => e.kind === 'assistant');
    expect(assistant.map((e) => (e as { rawModel?: string }).rawModel)).toEqual(['model-a']);

    runner.send('second order');
    await flush();

    const second = adapter.requests[1]!;
    expect(second.model).toBe('model-b');
    expect(second.sameModel).toBe(false);
    expect(JSON.stringify(toAnthropicMessages(second.messages, second.sameModel))).not.toContain('sig-a');
  });
});

/** The panel mutates the runner's config in place rather than rebuilding the runner, so one runner
 *  can launch job A on one model and job B on another over the same log — and A's raw thinking
 *  blocks (signatures included) are still in it. */
describe('exec/runner: sameModel across launches', () => {
  it('replays a logged turn\'s raw to the same model, and stops replaying it the moment a different model is armed', async () => {
    const adapter = createScriptedAdapter([rawTurn('one done, more?','sig-a'), rawTurn('two done, more?','sig-a2'), rawTurn('three done, more?','sig-b')]);
    const cfg = makeCfg({ adapterForTest: adapter, model: 'model-a' });
    const runner = createRunner(cfg);

    runner.send('first order');
    await flush();
    runner.send('second order'); // a second launch, same model still armed
    await flush();

    const second = adapter.requests[1]!;
    expect(second.sameModel).toBe(true);
    // The first turn's raw bytes reach the model that minted them, verbatim.
    expect(JSON.stringify(toAnthropicMessages(second.messages, second.sameModel))).toContain('sig-a');

    // Exactly what the panel does when the user arms another model: the config object is mutated,
    // the runner is not rebuilt.
    cfg.model = 'model-b';
    runner.send('third order');
    await flush();

    const third = adapter.requests[2]!;
    expect(third.sameModel).toBe(false);
    // Both earlier turns' raw is withheld; the history is rebuilt from the neutral fields.
    const projected = JSON.stringify(toAnthropicMessages(third.messages, third.sameModel));
    expect(projected).not.toContain('sig-a');
    expect(projected).not.toContain('sig-a2');
    expect(projected).toContain('one'); // the turns themselves are still there, as plain text

    // And the switched job runs to completion rather than falling over on the mixed history.
    const events = eventsOf(useAgentSession.getState().log);
    expect(events[events.length - 1]).toMatchObject({ kind: 'jobEnd', outcome: 'done' });
    expect(runner.active()).toBe(false);
  });

  it('a fresh log answers true again: what a previous session ran cannot pin a new one to false', async () => {
    const adapter = createScriptedAdapter([rawTurn('one done, more?','sig-a'), rawTurn('two done, more?','sig-b'), rawTurn('three done, more?','sig-b2')]);
    const cfg = makeCfg({ adapterForTest: adapter, model: 'model-a' });
    const runner = createRunner(cfg);

    runner.send('first order');
    await flush();
    cfg.model = 'model-b';
    runner.send('second order');
    await flush();
    expect(adapter.requests[1]!.sameModel).toBe(false);

    useAgentSession.getState().clearSession(); // a new log holds no raw at all
    runner.send('a new session');
    await flush();
    expect(adapter.requests[2]!.sameModel).toBe(true);
  });

  it('the OpenAI dialect is unaffected either way: it never replays raw, whatever the flag says', async () => {
    const adapter = createScriptedAdapter([rawTurn('one done, more?','sig-a'), rawTurn('two done, more?','sig-a2')]);
    const cfg = makeCfg({ adapterForTest: adapter, providerId: 'deepseek', model: 'model-a' });
    const runner = createRunner(cfg);

    runner.send('first order');
    await flush();
    runner.send('second order');
    await flush();

    const second = adapter.requests[1]!;
    expect(second.sameModel).toBe(true); // the flag is about the log, not the dialect
    // providers/openai.test.ts pins the dialect's own side of this: `raw` is dropped regardless.
    expect(second.messages.some((m) => m.role === 'assistant' && m.raw !== undefined)).toBe(true);
  });
});

/**
 * PAUSE, FROM THE PRESS TO THE SETTLE.
 *
 * The dock offers a pause in exactly the phases `RUNNING` covers (thinking, streaming, executing)
 * with a ticket standing, so those are the moments the press really arrives in. The loop honours it
 * at a boundary — before a call, and between turns — and the job must reach `paused` from every one
 * of them, with the work that had not started still not started.
 */
describe('pause reaches the loop from every moment the dock offers it', () => {
  const paint = (callId: string, x: number): ScriptedTurn => toolTurn([{
    callId,
    name: 'paint_terrain',
    args: { rect: { x1: x, y1: 2, x2: x + 1, y2: 3 }, terrain: 'mountain', elevation: 1 },
  }]);
  const streamOf = (turn: ScriptedTurn): StreamEvent[] => (turn as { events: StreamEvent[] }).events;

  it('lands from a press while the turn is streaming, before its calls run', async () => {
    const runner = createRunner(makeCfg({
      adapterForTest: createScriptedAdapter([
        // The press arrives as the turn begins, which is a phase the dock draws a pause in.
        () => { runner.pause(); return streamOf(paint('c1', 2)); },
        textTurn('carried on'),
      ]),
    }));

    runner.send('build something');
    await flush();

    const log = useAgentSession.getState().log;
    expect(deriveView(log).phase).toBe('paused');
    expect(eventsOf(log).some((e) => e.kind === 'toolResult'), 'the call had not started').toBe(false);
    expect(runner.active()).toBe(false);
  });

  it('lands from a press between two calls of one turn', async () => {
    const runner = createRunner(makeCfg({
      adapterForTest: createScriptedAdapter([
        { events: [{ t: 'done', stop: 'tool-calls', final: [
          { callId: 'c1', name: 'inspect_region', args: { x1: 0, y1: 0, x2: 1, y2: 1 }, rawArgs: '{}' },
          { callId: 'c2', name: 'inspect_region', args: { x1: 2, y1: 2, x2: 3, y2: 3 }, rawArgs: '{}' },
        ] }] },
        textTurn('carried on'),
      ]),
    }));

    runner.send('look around');
    // The first call resolves, then the press lands; the second must not run.
    await Promise.resolve();
    await Promise.resolve();
    runner.pause();
    await flush();

    const log = useAgentSession.getState().log;
    expect(deriveView(log).phase).toBe('paused');
    const ran = eventsOf(log)
      .filter((e) => e.kind === 'toolResult')
      .map((e) => (e as unknown as { callId: string }).callId);
    expect(ran).not.toContain('c2');
  });

  it('lands from a press taken between turns, and resume carries the job on', async () => {
    const runner = createRunner(makeCfg({
      adapterForTest: createScriptedAdapter([
        paint('c1', 2),
        () => { runner.pause(); return streamOf(paint('c2', 6)); },
        textTurn('all done'),
      ]),
    }));

    runner.send('build something');
    await flush();
    let log = useAgentSession.getState().log;
    expect(deriveView(log).phase).toBe('paused');

    runner.resume();
    await flush();
    log = useAgentSession.getState().log;
    expect(deriveView(log).phase).toBe('idle');
    expect(eventsOf(log).some((e) => e.kind === 'toolResult' && e.callId === 'c2')).toBe(true);
  });

  /**
   * A PAUSE REQUEST NEVER OUTLIVES THE JOB IT WAS ASKED OF.
   *
   * The dock says "Pausing" the moment the request lands, and the loop answers it at the next
   * boundary — but a turn that settles the job has no next boundary, so the request would still be
   * the newest pause event on the log with nothing left to answer it. The NEXT job then reads it and
   * pauses itself before its first turn, which is a run that never starts and a panel holding a
   * pause nobody asked for.
   */
  it('does not carry a pause request into the job after it', async () => {
    const runner = createRunner(makeCfg({
      adapterForTest: createScriptedAdapter([
        () => { runner.pause(); return streamOf(textTurn('Nothing to do. What would you like instead?')); },
        textTurn('The next order ran clean. Anything else?'),
      ]),
    }));

    runner.send('go');
    await flush();
    expect(deriveView(useAgentSession.getState().log).phase).toBe('idle');

    runner.send('go again');
    await flush();

    const log = useAgentSession.getState().log;
    expect(eventsOf(log).filter((e) => e.kind === 'order')).toHaveLength(2);
    expect(deriveView(log).phase, 'the second order ran to its own settle').toBe('idle');
  });
});

/**
 * A JOB THE LOG SAYS IS RUNNING THAT NO LOOP HOLDS.
 *
 * A reload mid-run, or a session adopted from storage, leaves an `order` with no `jobEnd` on the log:
 * every surface reads that as a running job and the dock draws the pause its phase asks for, while
 * this runner holds no promise and no controller. The request the live path makes would then wait for
 * a boundary that no loop will ever reach, so the press has to act HERE instead.
 */
describe('a job with no loop behind it', () => {
  /** What a reload leaves behind: an order, a checkpoint, and nothing that ends them. */
  function orphan(): void {
    const { log } = useAgentSession.getState();
    append(log, { kind: 'order', text: 'build a fishing village', mapContext: 'Hexia' });
    append(log, { kind: 'checkpoint', undoIndex: 0, label: 'job' });
  }

  it('parks it where it stands, so the press the dock offers actually holds it', () => {
    const runner = createRunner(makeCfg({ adapterForTest: createScriptedAdapter([textTurn('x')]) }));
    orphan();
    const log = useAgentSession.getState().log;
    expect(runner.active(), 'no loop holds it').toBe(false);
    expect(deriveView(log).phase, 'and every surface reads it as running').toBe('thinking');

    runner.pause();

    // Held, not merely requested: there is no boundary coming, so a `pauseRequested` would stand for
    // the rest of the session under a dock reading "Pausing".
    expect(deriveView(log).phase).toBe('paused');
    expect(eventsOf(log).some((e) => e.kind === 'pauseRequested')).toBe(false);
  });

  it('is resumable from that hold, which is the point of parking rather than ending it', async () => {
    const runner = createRunner(makeCfg({
      adapterForTest: createScriptedAdapter([textTurn('picked it up again')]),
    }));
    orphan();
    runner.pause();

    runner.resume();
    await flush();

    const log = useAgentSession.getState().log;
    expect(eventsOf(log).some((e) => e.kind === 'resumed')).toBe(true);
    expect(eventsOf(log)[eventsOf(log).length - 1]).toMatchObject({ kind: 'jobEnd', outcome: 'done' });
  });

  it('is stoppable too, which the dock offers over the same job', () => {
    const runner = createRunner(makeCfg({ adapterForTest: createScriptedAdapter([textTurn('x')]) }));
    orphan();

    runner.stop();

    const log = useAgentSession.getState().log;
    expect(eventsOf(log)[eventsOf(log).length - 1]).toMatchObject({ kind: 'jobEnd', outcome: 'aborted' });
    expect(deriveView(log).phase).toBe('aborted');
  });

  it('leaves a settled session and an already-held job alone', () => {
    const runner = createRunner(makeCfg({ adapterForTest: createScriptedAdapter([textTurn('x')]) }));
    const log = useAgentSession.getState().log;

    runner.pause(); // nothing at all on the log
    expect(eventsOf(log)).toHaveLength(0);

    orphan();
    runner.pause();
    const held = eventsOf(log).length;
    runner.pause(); // already held: a second hold would be a second answer to one press
    expect(eventsOf(log)).toHaveLength(held);
  });
});
