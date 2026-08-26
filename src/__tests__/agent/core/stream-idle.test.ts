import { afterEach, describe, expect, it, vi } from 'vitest';
import { isRetryable } from '../../../agent/core/errors';
import { append, createLog, eventsOf, type SessionLog } from '../../../agent/core/log';
import { runJob, type LoopDeps, type ToolExecutor } from '../../../agent/core/loop';
import {
  BETWEEN_EVENT_IDLE_MS, FIRST_EVENT_IDLE_MS, withIdleTimeout,
} from '../../../agent/core/stream-idle';
import type { StreamEvent } from '../../../agent/core/types';
import { createScriptedAdapter } from '../../../agent/eval/scripted-adapter';
import type { Adapter, AdapterRequest } from '../../../agent/providers/types';

/** A stream that stops sending without ending: the shape a proxy dropping a connection, a gateway
 *  holding a socket open, or a provider stalling mid-turn leaves behind. Nothing rejects and
 *  nothing closes, so without a bound the job waits on it forever. */
function forever(): Promise<never> {
  return new Promise<never>(() => {});
}

async function* neverYields(): AsyncGenerator<StreamEvent> {
  await forever();
}

async function* oneThenHangs(): AsyncGenerator<StreamEvent> {
  yield { t: 'text', delta: 'thinking out loud' };
  await forever();
}

async function* prompt(events: StreamEvent[]): AsyncGenerator<StreamEvent> {
  for (const ev of events) yield ev;
}

/** Consumes a wrapped stream in the background so a test can advance the clock while it waits. */
function collect(stream: AsyncGenerator<StreamEvent>): { events: StreamEvent[]; done: Promise<void> } {
  const events: StreamEvent[] = [];
  const done = (async () => { for await (const ev of stream) events.push(ev); })();
  return { events, done };
}

function makeExecutor(): ToolExecutor {
  return {
    async execute(call) { return { content: `did ${call.name}`, isError: false }; },
    isWrite: () => false,
    isWide: () => false,
    describe: (call) => `run ${call.name}`,
  };
}

function makeDeps(overrides: Partial<LoopDeps> & { adapter: Adapter }): LoopDeps {
  return {
    model: 'scripted-model',
    system: 'system prompt',
    tools: [],
    executor: makeExecutor(),
    oversight: 'yolo',
    sameModel: true,
    budgetTokens: 100_000,
    signal: new AbortController().signal,
    undoStackSize: () => 0,
    sleep: async () => {}, // the retry ladder's own wait, resolved at once: this suite times the STREAM
    ...overrides,
  };
}

function seedOrder(log: SessionLog): void {
  append(log, { kind: 'order', text: 'go', mapContext: '' });
}

/** An adapter whose FIRST turn goes silent forever and whose second answers normally, recording the
 *  signal each turn was handed so a test can see which of them the idle trip cancelled. */
function stallsThenAnswers(text: string): Adapter & { requests: AdapterRequest[]; signals: AbortSignal[] } {
  const requests: AdapterRequest[] = [];
  const signals: AbortSignal[] = [];
  let turn = 0;
  return {
    requests,
    signals,
    async *stream(req: AdapterRequest, signal: AbortSignal): AsyncGenerator<StreamEvent> {
      requests.push(req);
      signals.push(signal);
      if (turn++ === 0) { await forever(); return; }
      yield { t: 'text', delta: text };
      yield { t: 'done', stop: 'stop' };
    },
    async listModels(): Promise<string[]> { return ['scripted-model']; },
  };
}

afterEach(() => { vi.useRealTimers(); });

describe('withIdleTimeout', () => {
  it('1. a stream that never sends anything ends as one retryable network error, and says so to its caller', async () => {
    vi.useFakeTimers();
    let idled = 0;
    const { events, done } = collect(withIdleTimeout(neverYields(), { onIdle: () => { idled++; } }));

    await vi.advanceTimersByTimeAsync(FIRST_EVENT_IDLE_MS - 1);
    expect(events).toHaveLength(0); // the first wait is the GENEROUS one: a hidden-CoT turn is still thinking
    expect(idled).toBe(0);

    await vi.advanceTimersByTimeAsync(1);
    await done;

    expect(idled).toBe(1);
    expect(events).toHaveLength(1);
    const only = events[0];
    expect(only?.t).toBe('error');
    const cls = only?.t === 'error' ? only.error.cls : 'unknown';
    expect(cls).toBe('network'); // a NAMED class the banner can caption, never the uncaptioned 'unknown'
    expect(isRetryable(cls)).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('2. once the stream has proven alive, the next wait is the shorter between-event bound', async () => {
    vi.useFakeTimers();
    const { events, done } = collect(withIdleTimeout(oneThenHangs()));

    await vi.advanceTimersByTimeAsync(BETWEEN_EVENT_IDLE_MS - 1);
    expect(events).toHaveLength(1); // only the text so far

    await vi.advanceTimersByTimeAsync(1);
    await done;

    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({ t: 'text', delta: 'thinking out loud' });
    expect(events[1]?.t).toBe('error');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('3. a stream that answers passes through untouched and leaves no timer behind', async () => {
    vi.useFakeTimers();
    const script: StreamEvent[] = [
      { t: 'reasoning', delta: 'weighing it' },
      { t: 'text', delta: 'Ridge raised.' },
      { t: 'done', stop: 'stop' },
    ];
    const { events, done } = collect(withIdleTimeout(prompt(script.slice())));
    await done;

    expect(events).toEqual(script);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('4. a consumer that stops early takes the timer with it', async () => {
    vi.useFakeTimers();
    const wrapped = withIdleTimeout(oneThenHangs());
    const first = await wrapped.next();
    expect(first.value).toEqual({ t: 'text', delta: 'thinking out loud' });

    await wrapped.return(undefined);

    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('runJob over a stalled stream', () => {
  it('5. the idle trip cancels that turn\'s own fetch and reaches the ordinary retry ladder, never an uncaptioned incident', async () => {
    vi.useFakeTimers();
    const log = createLog(() => 0);
    seedOrder(log);
    const adapter = stallsThenAnswers('Ridge raised.');

    const running = runJob(log, makeDeps({ adapter }));
    await vi.advanceTimersByTimeAsync(FIRST_EVENT_IDLE_MS);
    const outcome = await running;

    expect(outcome).toBe('done');
    expect(adapter.requests).toHaveLength(2);
    expect(adapter.signals[0]?.aborted).toBe(true); // the stalled fetch was actually cancelled
    expect(adapter.signals[1]?.aborted).toBe(false); // and the retry got a fresh one, not the tripped one
    const retries = eventsOf(log).filter((e) => e.kind === 'retry');
    expect(retries).toHaveLength(1);
    expect(retries[0]).toMatchObject({ attempt: 1, cls: 'network' });
    expect(eventsOf(log).some((e) => e.kind === 'incident')).toBe(false);
    expect(eventsOf(log).find((e) => e.kind === 'jobEnd')).toMatchObject({ outcome: 'done' });
  });

  it('6. a user abort still reads as an abort, not as a stall', async () => {
    const log = createLog(() => 0);
    seedOrder(log);
    const controller = new AbortController();
    const adapter = createScriptedAdapter([
      { events: [{ t: 'text', delta: 'partial reply' }, { t: 'text', delta: ' never sent' }, { t: 'done', stop: 'stop' }] },
    ]);
    let aborted = false;
    const deps = makeDeps({
      adapter,
      signal: controller.signal,
      onLive: (parts) => { if (parts && parts.length > 0 && !aborted) { aborted = true; controller.abort(); } },
    });

    const outcome = await runJob(log, deps);

    expect(outcome).toBe('aborted');
    expect(adapter.requests).toHaveLength(1);
    const assistants = eventsOf(log).filter((e) => e.kind === 'assistant');
    expect(assistants).toHaveLength(1);
    expect(assistants[0]).toMatchObject({ stop: 'aborted' });
    expect(eventsOf(log).find((e) => e.kind === 'jobEnd')).toMatchObject({ outcome: 'aborted' });
    expect(eventsOf(log).some((e) => e.kind === 'retry')).toBe(false);
  });
});
