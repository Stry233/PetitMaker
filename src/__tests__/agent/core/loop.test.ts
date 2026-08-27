import { describe, expect, it } from 'vitest';
import { createScriptedAdapter, type ScriptedTurn } from '../../../agent/eval/scripted-adapter';
import { answerGate, pendingGate } from '../../../agent/core/gates';
import { deliveryNudge, reviewNudge, REVIEW_MIN_TURNS_LEFT, REVIEW_MIN_WRITES } from '../../../agent/core/governor';
import { append, createLog, eventsOf, type SessionLog } from '../../../agent/core/log';
import type { LoopDeps, ExecutedResult, ToolExecutor } from '../../../agent/core/loop';
import { BUILD_BEAT_MS, runJob } from '../../../agent/core/loop';
import { deriveView } from '../../../agent/core/project-view';
import { deserializeLog, serializeLog } from '../../../agent/session/persist';
import { queueSteer } from '../../../agent/core/steering';
import type { Part } from '../../../agent/core/types';
import { TOOL_SCHEMAS } from '../../../agent/tools';

/** Drains the microtask queue: everything in this file resolves through promise chains alone
 *  (no real timers), so a fixed, generous number of `await`s is enough to run the loop up to its
 *  next genuinely blocking wait (an unanswered gate). */
async function flush(): Promise<void> {
  for (let i = 0; i < 50; i++) await Promise.resolve();
}

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

/** Stand-ins for the ordinary PARENT job's two ungated control tools: `processCalls` special-cases
 *  `update_plan`/`suggest_reply` only when `deps.tools` advertises them by name (a subagent wired
 *  via `wireSchemas({subagent:true})` excludes both), so the default fixture here must carry them
 *  for every test below that exercises either call under the parent path. */
const PARENT_CONTROL_TOOLS = [
  { name: 'update_plan', description: 'stand-in', parameters: {} },
  { name: 'suggest_reply', description: 'stand-in', parameters: {} },
];

function makeDeps(overrides: Partial<LoopDeps> & { adapter: LoopDeps['adapter']; executor: ToolExecutor }): LoopDeps {
  return {
    model: 'scripted-model',
    system: 'system prompt',
    tools: PARENT_CONTROL_TOOLS,
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

/** A turn that SAYS something and calls tools in the same breath (the closing-message shape). */
function sayingToolTurn(text: string, calls: { callId: string; name: string; args?: Record<string, unknown> }[]): ScriptedTurn {
  return {
    events: [
      { t: 'text', delta: text },
      {
        t: 'done', stop: 'tool-calls',
        final: calls.map((c) => ({ callId: c.callId, name: c.name, args: c.args, rawArgs: JSON.stringify(c.args ?? {}) })),
      },
    ],
  };
}

/** Neither text nor a tool call: what the empty-turn nudge and the three-in-a-row giveup count. */
const EMPTY_TURN: ScriptedTurn = { events: [{ t: 'done', stop: 'stop' }] };

function seedOrder(log: SessionLog, text = 'go'): void {
  append(log, { kind: 'order', text, mapContext: '' });
}

describe('runJob core flows', () => {
  it('a text-only turn ends the job done, appending assistant then jobEnd, with the executor untouched', async () => {
    const log = createLog(() => 0);
    seedOrder(log, 'build a house');
    const adapter = createScriptedAdapter([textTurn('All done.')]);
    const executor = makeExecutor();
    const deps = makeDeps({ adapter, executor });

    const outcome = await runJob(log, deps);

    expect(outcome).toBe('done');
    expect(executor.calls).toHaveLength(0);
    expect(eventsOf(log).map((e) => e.kind)).toEqual(['order', 'assistant', 'jobEnd']);
    const events1 = eventsOf(log);
    expect(events1[events1.length - 1]).toMatchObject({ kind: 'jobEnd', outcome: 'done' });
  });

  /**
   * A NORMALIZED PROSE CALL IS A CALL, all the way down.
   *
   * The events here are exactly what `providers/openai.ts` delivers for a gateway that types the
   * call into its message body: no text part, a tool part, `stop: 'tool-calls'` and the turn's own
   * quirk marker. Unnormalized the same wire ended the job `done` with the JSON as its summary and
   * the executor never touched — a silent turn wearing a receipt.
   */
  it('runs a turn the adapter normalized out of prose, records the quirk, and does not settle on it', async () => {
    const log = createLog(() => 0);
    seedOrder(log, 'find flat ground');
    const adapter = createScriptedAdapter([
      {
        events: [
          { t: 'tool-start', callId: 'call-prose-0', name: 'find_flat_areas' },
          { t: 'tool-args', callId: 'call-prose-0', delta: '{"limit":5}' },
          {
            t: 'done', stop: 'tool-calls', quirks: ['tool-call-as-prose'],
            final: [{ callId: 'call-prose-0', name: 'find_flat_areas', args: { limit: 5 }, rawArgs: '{"limit":5}' }],
          },
        ],
      },
      textTurn('three spots, all near the shore'),
    ]);
    const executor = makeExecutor({ result: () => ({ content: '3 areas', isError: false }) });
    const deps = makeDeps({ adapter, executor });

    const outcome = await runJob(log, deps);

    expect(outcome).toBe('done');
    expect(executor.calls).toEqual([{ callId: 'call-prose-0', name: 'find_flat_areas', args: { limit: 5 } }]);
    const [, firstTurn] = eventsOf(log);
    expect(firstTurn).toMatchObject({ kind: 'assistant', quirks: ['tool-call-as-prose'] });
    expect(firstTurn?.kind === 'assistant' && firstTurn.parts.map((p) => p.kind)).toEqual(['tool']);
    const events = eventsOf(log);
    const end = events[events.length - 1];
    expect(end, 'the words that settle the job are the LATER turn\'s').toMatchObject({
      kind: 'jobEnd', outcome: 'done', summary: 'three spots, all near the shore',
    });
  });

  it('a tool turn then a text turn appends the toolResult between the two assistants and feeds it back on the next request', async () => {
    const log = createLog(() => 0);
    seedOrder(log, 'place a tree');
    const adapter = createScriptedAdapter([
      toolTurn([{ callId: 'c1', name: 'place_object', args: { id: 'tree' } }]),
      textTurn('placed it'),
    ]);
    const executor = makeExecutor({ result: () => ({ content: 'placed tree', isError: false }) });
    const deps = makeDeps({ adapter, executor });

    const outcome = await runJob(log, deps);

    expect(outcome).toBe('done');
    expect(executor.calls).toEqual([{ callId: 'c1', name: 'place_object', args: { id: 'tree' } }]);
    expect(eventsOf(log).map((e) => e.kind)).toEqual(['order', 'assistant', 'toolResult', 'assistant', 'jobEnd']);

    expect(adapter.requests).toHaveLength(2);
    const secondMessages = adapter.requests[1]?.messages ?? [];
    expect(secondMessages.some((m) => m.role === 'tool' && m.results.some((r) => r.content === 'placed tree'))).toBe(true);
  });

  it('a third plan filing is churn the loop refuses itself, keeping the second plan standing', async () => {
    const log = createLog(() => 0);
    append(log, { kind: 'order', text: 'build', mapContext: '' });
    const adapter = createScriptedAdapter([
      toolTurn([{ callId: 'p1', name: 'update_plan', args: { stages: [{ label: 'streets' }] } }]),
      toolTurn([{ callId: 'p2', name: 'update_plan', args: { stages: [{ label: 'streets' }, { label: 'courts' }] } }]),
      toolTurn([{ callId: 'p3', name: 'update_plan', args: { stages: [{ label: 'again' }] } }]),
      textTurn('building on'),
    ]);
    const executor = makeExecutor({ result: () => ({ content: 'ok', isError: false }) });
    const deps = makeDeps({ adapter, executor, oversight: 'yolo' });

    await runJob(log, deps);

    const plans = eventsOf(log).filter((e) => e.kind === 'plan');
    expect(plans).toHaveLength(2); // the plan and one revision; the third filing landed no event
    const refusal = eventsOf(log).find((e) => e.kind === 'toolResult' && e.callId === 'p3');
    expect(refusal?.kind === 'toolResult' && refusal.isError).toBe(true);
    expect(refusal?.kind === 'toolResult' && refusal.content).toContain('commitment');
    expect(refusal?.kind === 'toolResult' && refusal.detail?.damper).toBe(true);
    expect(executor.calls).toEqual([]); // no filing ever reached the executor
  });

  it('update_plan gates first under checkpoint oversight; allow approves the plan and a later wide tool does not gate', async () => {
    const log = createLog(() => 0);
    seedOrder(log, 'build a town');
    const adapter = createScriptedAdapter([
      toolTurn([{ callId: 'plan-1', name: 'update_plan', args: { stages: [{ label: 'streets' }] } }]),
      toolTurn([{ callId: 'c2', name: 'build_road_network', args: {} }]),
      textTurn('done'),
    ]);
    const executor = makeExecutor({ writeNames: new Set(['build_road_network']), wideNames: new Set(['build_road_network']) });
    const deps = makeDeps({ adapter, executor, oversight: 'checkpoint' });

    const promise = runJob(log, deps);
    await flush();
    const gate = pendingGate(log);
    expect(gate?.scope).toBe('plan');
    answerGate(log, gate!.gateId, 'allow');

    const outcome = await promise;

    expect(outcome).toBe('done');
    expect(eventsOf(log).some((e) => e.kind === 'plan')).toBe(true);
    expect(eventsOf(log).some((e) => e.kind === 'gateAsked' && e.scope === 'tool')).toBe(false);
    expect(executor.calls).toEqual([{ callId: 'c2', name: 'build_road_network', args: {} }]);
  });

  it('strict oversight gates a write; skip executes nothing (the projection synthesizes the result) and allow executes', async () => {
    const log = createLog(() => 0);
    seedOrder(log, 'paint a mountain');
    const adapter = createScriptedAdapter([
      toolTurn([{ callId: 'c1', name: 'paint_terrain', args: {} }]),
      toolTurn([{ callId: 'c2', name: 'paint_terrain', args: {} }]),
      textTurn('done'),
    ]);
    const executor = makeExecutor({ writeNames: new Set(['paint_terrain']) });
    const deps = makeDeps({ adapter, executor, oversight: 'strict' });

    const promise = runJob(log, deps);
    await flush();
    const gate1 = pendingGate(log);
    expect(gate1?.scope).toBe('tool');
    answerGate(log, gate1!.gateId, 'skip');

    await flush();
    const gate2 = pendingGate(log);
    expect(gate2).toBeDefined();
    answerGate(log, gate2!.gateId, 'allow');

    const outcome = await promise;

    expect(outcome).toBe('done');
    expect(executor.calls).toEqual([{ callId: 'c2', name: 'paint_terrain', args: {} }]);
    expect(eventsOf(log).some((e) => e.kind === 'toolResult' && e.callId === 'c1')).toBe(false);
    const secondMessages = adapter.requests[1]?.messages ?? [];
    expect(secondMessages.some((m) => m.role === 'tool' && m.results.some((r) => r.callId === 'c1' && !r.isError))).toBe(true);
  });

  it('a steer queued mid-turn is delivered before the next request', async () => {
    const log = createLog(() => 0);
    seedOrder(log, 'build something');
    const adapter = createScriptedAdapter([
      toolTurn([{ callId: 'c1', name: 'place_object', args: {} }]),
      textTurn('done'),
    ]);
    let steerSeq = -1;
    const executor = makeExecutor({
      result: () => {
        steerSeq = queueSteer(log, 'go wider');
        return { content: 'placed', isError: false };
      },
    });
    const deps = makeDeps({ adapter, executor });

    const outcome = await runJob(log, deps);

    expect(outcome).toBe('done');
    const delivered = eventsOf(log).find((e) => e.kind === 'steerDelivered');
    expect(delivered).toBeDefined();
    expect(delivered?.steerSeq).toBe(steerSeq);
    const secondAssistant = eventsOf(log).filter((e) => e.kind === 'assistant')[1];
    expect(delivered!.seq).toBeLessThan(secondAssistant!.seq);
    const secondMessages = adapter.requests[1]?.messages ?? [];
    expect(secondMessages.some((m) => m.role === 'user' && m.text === 'go wider')).toBe(true);
  });

  it('the first write in the job appends a checkpoint with the injected undoStackSize value', async () => {
    const log = createLog(() => 0);
    seedOrder(log, 'place a tree');
    const adapter = createScriptedAdapter([
      toolTurn([{ callId: 'c1', name: 'place_object', args: {} }]),
      textTurn('done'),
    ]);
    const executor = makeExecutor({ writeNames: new Set(['place_object']) });
    const deps = makeDeps({ adapter, executor, undoStackSize: () => 7 });

    await runJob(log, deps);

    const checkpoint = eventsOf(log).find((e) => e.kind === 'checkpoint');
    expect(checkpoint).toMatchObject({ label: 'job', undoIndex: 7 });
  });

  /**
   * THE SETTLE BANKS ITS OWN DEPTH, which is the upper half of the pair the panel's take-back reads:
   * the first checkpoint says where the job's writes began, this says where they ended, so anything
   * above it is the user's own later work and a rewind can name the two apart.
   */
  it('stamps the undo depth the job settled at on every jobEnd, aborts included', async () => {
    const log = createLog(() => 0);
    seedOrder(log, 'place a tree');
    const adapter = createScriptedAdapter([
      toolTurn([{ callId: 'c1', name: 'place_object', args: {} }]),
      textTurn('done'),
    ]);
    const executor = makeExecutor({ writeNames: new Set(['place_object']) });
    let depth = 3;
    const deps = makeDeps({ adapter, executor, undoStackSize: () => depth });

    await runJob(log, deps);
    // The write moved the stack; the settle reads it where it stands.
    depth = 7;
    const end = eventsOf(log).find((e) => e.kind === 'jobEnd');
    expect(end).toMatchObject({ outcome: 'done', undoIndex: 3 });
  });

  it('stamps it on a CAPPED settle too, so a capped receipt can name its own share', async () => {
    const log = createLog(() => 0);
    seedOrder(log, 'keep building');
    const adapter = createScriptedAdapter([textTurn('one'), textTurn('two')]);
    const deps = makeDeps({ adapter, executor: makeExecutor({}), undoStackSize: () => 12, maxTurns: 1 });

    await runJob(log, deps);

    const end = eventsOf(log).find((e) => e.kind === 'jobEnd');
    expect(end).toMatchObject({ outcome: 'capped', undoIndex: 12 });
  });

  it('pauseRequested between calls finishes the in-flight call and pauses; runJob after resumed continues into the next turn', async () => {
    const log = createLog(() => 0);
    seedOrder(log, 'place two things');
    const adapter = createScriptedAdapter([
      toolTurn([{ callId: 'c1', name: 'place_object', args: {} }, { callId: 'c2', name: 'place_object', args: {} }]),
      textTurn('done'),
    ]);
    const order: string[] = [];
    const executor = makeExecutor({
      result: (call) => {
        order.push(call.callId);
        if (call.callId === 'c1') append(log, { kind: 'pauseRequested' });
        return { content: `placed ${call.callId}`, isError: false };
      },
    });
    const deps = makeDeps({ adapter, executor });

    const outcome1 = await runJob(log, deps);
    expect(outcome1).toBe('paused');
    expect(order).toEqual(['c1']);
    expect(eventsOf(log).some((e) => e.kind === 'paused')).toBe(true);

    append(log, { kind: 'resumed' });
    const outcome2 = await runJob(log, deps);

    expect(outcome2).toBe('done');
    expect(order).toEqual(['c1', 'c2']);
    expect(adapter.requests).toHaveLength(2);
  });

  it('onLive receives streaming snapshots during a turn and null once the assistant event lands', async () => {
    const log = createLog(() => 0);
    seedOrder(log, 'go');
    const adapter = createScriptedAdapter([
      { events: [{ t: 'text', delta: 'hi' }, { t: 'text', delta: ' there' }, { t: 'done', stop: 'stop' }] },
    ]);
    const executor = makeExecutor();
    const snapshots: (readonly Part[] | null)[] = [];
    const deps = makeDeps({ adapter, executor, onLive: (parts) => snapshots.push(parts) });

    await runJob(log, deps);

    expect(snapshots.length).toBeGreaterThanOrEqual(2);
    expect(snapshots[snapshots.length - 1]).toBeNull();
    const lastLive = snapshots[snapshots.length - 2];
    expect(lastLive).not.toBeNull();
    expect((lastLive as Part[]).some((p) => p.kind === 'text')).toBe(true);
  });

  it('re-enters an already-pending unanswered gate on resume without asking a second time', async () => {
    const log = createLog(() => 0);
    seedOrder(log, 'paint');
    append(log, {
      kind: 'assistant', stop: 'tool-calls',
      parts: [{ kind: 'tool', callId: 'c1', name: 'paint_terrain', input: {}, argsDone: true }],
    });
    append(log, { kind: 'gateAsked', gateId: 'gate-99', scope: 'tool', callId: 'c1', summary: 'paint something' });
    // No gateAnswered yet: this simulates resuming a job that reloaded mid-wait.

    const adapter = createScriptedAdapter([textTurn('done')]);
    const executor = makeExecutor({ writeNames: new Set(['paint_terrain']) });
    const deps = makeDeps({ adapter, executor, oversight: 'strict' });

    const promise = runJob(log, deps);
    await flush();

    expect(eventsOf(log).filter((e) => e.kind === 'gateAsked')).toHaveLength(1);

    answerGate(log, 'gate-99', 'allow');
    const outcome = await promise;

    expect(outcome).toBe('done');
    expect(executor.calls).toEqual([{ callId: 'c1', name: 'paint_terrain', args: {} }]);
  });

  it('a length-truncated batch gets a reissue toolResult per call, executes nothing, and continues to the next turn', async () => {
    const log = createLog(() => 0);
    seedOrder(log, 'go');
    const adapter = createScriptedAdapter([
      toolTurn([{ callId: 'c1', name: 'paint_terrain', args: { x: 1 } }], 'length'),
      textTurn('ok'),
    ]);
    const executor = makeExecutor();
    const deps = makeDeps({ adapter, executor });

    const outcome = await runJob(log, deps);

    expect(outcome).toBe('done');
    expect(executor.calls).toHaveLength(0);
    const results = eventsOf(log).filter((e) => e.kind === 'toolResult');
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ isError: true });
    expect(results[0]?.kind === 'toolResult' && results[0].content).toMatch(/Reissue the calls with complete arguments/);
    expect(adapter.requests).toHaveLength(2);
  });

  it('resume honors a gate already answered before the call ran (reload between approval and execution): executes once, no second ask', async () => {
    const log = createLog(() => 0);
    seedOrder(log, 'paint');
    append(log, {
      kind: 'assistant', stop: 'tool-calls',
      parts: [{ kind: 'tool', callId: 'c1', name: 'paint_terrain', input: {}, argsDone: true }],
    });
    append(log, { kind: 'gateAsked', gateId: 'gate-7', scope: 'tool', callId: 'c1', summary: 'paint something' });
    append(log, { kind: 'gateAnswered', gateId: 'gate-7', answer: 'allow' });
    // No toolResult yet: the reload landed after the user approved but before the call ran.

    const adapter = createScriptedAdapter([textTurn('done')]);
    const executor = makeExecutor({ writeNames: new Set(['paint_terrain']) });
    const deps = makeDeps({ adapter, executor, oversight: 'strict' });

    const outcome = await runJob(log, deps);

    expect(outcome).toBe('done');
    expect(executor.calls).toEqual([{ callId: 'c1', name: 'paint_terrain', args: {} }]);
    expect(eventsOf(log).filter((e) => e.kind === 'gateAsked')).toHaveLength(1);
  });

  it('an aborted signal between batch calls stops the next call from executing', async () => {
    const log = createLog(() => 0);
    seedOrder(log, 'place two things');
    const controller = new AbortController();
    const adapter = createScriptedAdapter([
      toolTurn([{ callId: 'c1', name: 'place_object', args: {} }, { callId: 'c2', name: 'place_object', args: {} }]),
      textTurn('done'),
    ]);
    const executor = makeExecutor({
      result: (call) => {
        if (call.callId === 'c1') controller.abort();
        return { content: `placed ${call.callId}`, isError: false };
      },
    });
    const deps = makeDeps({ adapter, executor, signal: controller.signal });

    const outcome = await runJob(log, deps);

    expect(outcome).toBe('aborted');
    expect(executor.calls).toEqual([{ callId: 'c1', name: 'place_object', args: {} }]);
    expect(eventsOf(log).filter((e) => e.kind === 'jobEnd')).toHaveLength(1);
    expect(eventsOf(log).filter((e) => e.kind === 'jobEnd')[0]).toMatchObject({ outcome: 'aborted' });
  });

  it('a throwing executor lands an isError toolResult and the job continues, never stranding an active job', async () => {
    const log = createLog(() => 0);
    seedOrder(log, 'go');
    const adapter = createScriptedAdapter([
      toolTurn([{ callId: 'c1', name: 'place_object', args: {} }]),
      textTurn('done'),
    ]);
    const executor = makeExecutor({
      result: () => { throw new Error('boom: sk-abcdefghijklmnopqrstuvwx leaked'); },
    });
    const deps = makeDeps({ adapter, executor });

    const outcome = await runJob(log, deps);

    expect(outcome).toBe('done');
    const result = eventsOf(log).find((e) => e.kind === 'toolResult' && e.callId === 'c1');
    expect(result).toMatchObject({ isError: true });
    const content = result?.kind === 'toolResult' ? result.content : '';
    expect(content).toMatch(/The tool crashed/);
    expect(content).not.toMatch(/sk-abcdefghijklmnopqrstuvwx/);
    expect(eventsOf(log).some((e) => e.kind === 'jobEnd')).toBe(true);
  });

  /**
   * THE ADVERTISED SCHEMA AND THIS PARSER ARE ONE CONTRACT, and nothing else in the tree holds them
   * together: the loop intercepts `update_plan` before the executor, so no handler's own validation
   * stands between the two. Drifted apart — a schema demanding `{title, status}` while the parser
   * reads `label` — every plan a well-behaved model sends is refused and the tool cannot succeed
   * once. The stage here is BUILT FROM THE SCHEMA's own
   * `required` list rather than written out, so moving one without the other fails this.
   */
  it("accepts a stage of exactly the shape update_plan's own schema requires", async () => {
    const schema = TOOL_SCHEMAS.find((s) => s.name === 'update_plan');
    const items = ((schema?.inputSchema as any).properties.stages.items) as
      { properties: Record<string, { type: string }>; required: string[] };
    const stage: Record<string, unknown> = {};
    for (const key of items.required) {
      const type = items.properties[key]?.type;
      expect(type, `update_plan's schema requires "${key}" but describes no type for it`).toBeDefined();
      stage[key] = type === 'boolean' ? true : type === 'string' ? `stage ${key}` : 1;
    }

    const log = createLog(() => 0);
    seedOrder(log, 'build a town');
    const adapter = createScriptedAdapter([
      toolTurn([{ callId: 'plan-1', name: 'update_plan', args: { stages: [stage] } }]),
      textTurn('done'),
    ]);
    const deps = makeDeps({ adapter, executor: makeExecutor(), oversight: 'yolo' });

    await runJob(log, deps);

    const plan = eventsOf(log).find((e) => e.kind === 'plan');
    expect(plan, 'the schema the model is given produced no plan event').toBeDefined();
    expect(plan?.kind === 'plan' ? plan.stages : []).toHaveLength(1);
    const result = eventsOf(log).find((e) => e.kind === 'toolResult' && e.callId === 'plan-1');
    expect(result).toMatchObject({ isError: false });
  });

  it('a malformed update_plan stages payload gets an isError result asking for a valid plan, and no plan event', async () => {
    const log = createLog(() => 0);
    seedOrder(log, 'build a town');
    const adapter = createScriptedAdapter([
      toolTurn([{ callId: 'plan-1', name: 'update_plan', args: { stages: [{ notLabel: 'oops' }] } }]),
      textTurn('done'),
    ]);
    const executor = makeExecutor();
    const deps = makeDeps({ adapter, executor, oversight: 'strict' });

    const outcome = await runJob(log, deps);

    expect(outcome).toBe('done');
    expect(eventsOf(log).some((e) => e.kind === 'plan')).toBe(false);
    expect(eventsOf(log).some((e) => e.kind === 'gateAsked')).toBe(false);
    const result = eventsOf(log).find((e) => e.kind === 'toolResult' && e.callId === 'plan-1');
    expect(result).toMatchObject({ isError: true });
    const content = result?.kind === 'toolResult' ? result.content : '';
    expect(content).toMatch(/valid plan/);
    expect(content).toContain('stages: [{"label":'); // teaches the schema shape, not just the rule
  });

  it('a subagent-scoped run (deps.tools excludes update_plan) does not special-case the call: no plan gate, no plan event, and the call reaches the executor', async () => {
    const log = createLog(() => 0);
    seedOrder(log, 'build a town');
    const adapter = createScriptedAdapter([
      toolTurn([{ callId: 'plan-1', name: 'update_plan', args: { stages: [{ label: 'streets' }] } }]),
      textTurn('done'),
    ]);
    // Mirrors createExecutor's real behavior for a name outside its wired `allowed` set
    // (exec/executor.ts): an unadvertised tool answers with its own unknown-tool error rather
    // than ever reaching the loop's update_plan interception.
    const executor = makeExecutor({
      result: (call) => (call.name === 'update_plan'
        ? { content: 'Unknown tool "update_plan".', isError: true }
        : { content: `did ${call.name}`, isError: false }),
    });
    const subagentTools = [{ name: 'paint_terrain', description: 'stand-in', parameters: {} }]; // no update_plan/suggest_reply
    const deps = makeDeps({ adapter, executor, tools: subagentTools, oversight: 'checkpoint' });

    const outcome = await runJob(log, deps);

    expect(outcome).toBe('done');
    expect(eventsOf(log).some((e) => e.kind === 'plan')).toBe(false);
    expect(eventsOf(log).some((e) => e.kind === 'gateAsked' && e.scope === 'plan')).toBe(false);
    expect(executor.calls).toEqual([{ callId: 'plan-1', name: 'update_plan', args: { stages: [{ label: 'streets' }] } }]);
    const result = eventsOf(log).find((e) => e.kind === 'toolResult' && e.callId === 'plan-1');
    expect(result).toMatchObject({ isError: true, content: 'Unknown tool "update_plan".' });
  });

  it('a subagent-scoped run (deps.tools excludes suggest_reply) does not synthesize "Noted.": the call reaches the executor', async () => {
    const log = createLog(() => 0);
    seedOrder(log, 'build a town');
    const adapter = createScriptedAdapter([
      toolTurn([{ callId: 'sr-1', name: 'suggest_reply', args: { reply: 'Yes, add the bridge' } }]),
      textTurn('done'),
    ]);
    const executor = makeExecutor({
      result: (call) => (call.name === 'suggest_reply'
        ? { content: 'Unknown tool "suggest_reply".', isError: true }
        : { content: `did ${call.name}`, isError: false }),
    });
    const subagentTools = [{ name: 'paint_terrain', description: 'stand-in', parameters: {} }]; // no update_plan/suggest_reply
    const deps = makeDeps({ adapter, executor, tools: subagentTools });

    const outcome = await runJob(log, deps);

    expect(outcome).toBe('done');
    expect(executor.calls).toEqual([{ callId: 'sr-1', name: 'suggest_reply', args: { reply: 'Yes, add the bridge' } }]);
    const result = eventsOf(log).find((e) => e.kind === 'toolResult' && e.callId === 'sr-1');
    expect(result).toMatchObject({ isError: true, content: 'Unknown tool "suggest_reply".' });
    expect(result?.kind === 'toolResult' ? result.content : '').not.toBe('Noted.');
  });

  it('the ordinary parent path: suggest_reply IS advertised (default deps.tools) and still synthesizes "Noted." without reaching the executor', async () => {
    const log = createLog(() => 0);
    seedOrder(log, 'build a town');
    const adapter = createScriptedAdapter([
      toolTurn([{ callId: 'sr-1', name: 'suggest_reply', args: { reply: 'Yes, add the bridge' } }]),
      textTurn('done'),
    ]);
    const executor = makeExecutor();
    const deps = makeDeps({ adapter, executor }); // default tools: PARENT_CONTROL_TOOLS, advertises suggest_reply

    const outcome = await runJob(log, deps);

    expect(outcome).toBe('done');
    expect(executor.calls).toEqual([]); // never reaches the executor
    const result = eventsOf(log).find((e) => e.kind === 'toolResult' && e.callId === 'sr-1');
    expect(result).toMatchObject({ isError: false, content: 'Noted.' });
  });

  it('a callId repeated across turns (e.g. a colliding synthesized id) gets its own gate: skipping turn 1 does not resolve turn 2', async () => {
    const log = createLog(() => 0);
    seedOrder(log, 'paint two things');
    const adapter = createScriptedAdapter([
      toolTurn([{ callId: 'call-0-0', name: 'paint_terrain', args: { x: 1 } }]),
      toolTurn([{ callId: 'call-0-0', name: 'paint_terrain', args: { x: 2 } }]),
      textTurn('done'),
    ]);
    const executor = makeExecutor({ writeNames: new Set(['paint_terrain']) });
    const deps = makeDeps({ adapter, executor, oversight: 'strict' });

    const promise = runJob(log, deps);
    await flush();
    const gate1 = pendingGate(log);
    expect(gate1?.scope).toBe('tool');
    answerGate(log, gate1!.gateId, 'skip');

    await flush();
    const gate2 = pendingGate(log);
    expect(gate2).toBeDefined();
    expect(gate2!.gateId).not.toBe(gate1!.gateId);
    answerGate(log, gate2!.gateId, 'allow');

    const outcome = await promise;

    expect(outcome).toBe('done');
    expect(eventsOf(log).filter((e) => e.kind === 'gateAsked')).toHaveLength(2);
    expect(executor.calls).toEqual([{ callId: 'call-0-0', name: 'paint_terrain', args: { x: 2 } }]);
  });

  it('a callId repeated across turns gets its own gate AND execution when both are allowed: exactly two toolResults', async () => {
    const log = createLog(() => 0);
    seedOrder(log, 'paint two things');
    const adapter = createScriptedAdapter([
      toolTurn([{ callId: 'call-0-0', name: 'paint_terrain', args: { x: 1 } }]),
      toolTurn([{ callId: 'call-0-0', name: 'paint_terrain', args: { x: 2 } }]),
      textTurn('done'),
    ]);
    const executor = makeExecutor({ writeNames: new Set(['paint_terrain']) });
    const deps = makeDeps({ adapter, executor, oversight: 'strict' });

    const promise = runJob(log, deps);
    await flush();
    const gate1 = pendingGate(log);
    answerGate(log, gate1!.gateId, 'allow');

    await flush();
    const gate2 = pendingGate(log);
    expect(gate2).toBeDefined();
    expect(gate2!.gateId).not.toBe(gate1!.gateId);
    answerGate(log, gate2!.gateId, 'allow');

    const outcome = await promise;

    expect(outcome).toBe('done');
    expect(executor.calls).toEqual([
      { callId: 'call-0-0', name: 'paint_terrain', args: { x: 1 } },
      { callId: 'call-0-0', name: 'paint_terrain', args: { x: 2 } },
    ]);
    expect(eventsOf(log).filter((e) => e.kind === 'toolResult')).toHaveLength(2);
  });
});

/**
 * WRITE-NESS AND THE MINTING TURN ARE STAMPED AT EXECUTE TIME, on every `toolResult` the loop
 * appends and on every `gateAsked` it asks. The projection then answers "was this a build or an
 * answer?" and "which turn does this call belong to?" from the log alone, with no side channel:
 * `isWrite` is the executor's fact and the executor is not in scope at fold time, and a callId is
 * only unique WITHIN one assistant turn, so the seq of the turn that minted the occurrence is the
 * only durable key for it.
 */
describe('a result carries its own write-ness and the turn that minted it', () => {
  function assistantSeqs(log: SessionLog): number[] {
    return eventsOf(log).filter((e) => e.kind === 'assistant').map((e) => e.seq);
  }

  function resultFor(log: SessionLog, callId: string) {
    return eventsOf(log).find((e) => e.kind === 'toolResult' && e.callId === callId);
  }

  it('stamps write: true on a write result and write: false on a read one, both with the minting assistant seq', async () => {
    const log = createLog(() => 0);
    seedOrder(log, 'paint then look');
    const adapter = createScriptedAdapter([
      toolTurn([
        { callId: 'w1', name: 'paint_terrain', args: { x: 1 } },
        { callId: 'r1', name: 'view_map', args: {} },
      ]),
      textTurn('done'),
    ]);
    const executor = makeExecutor({ writeNames: new Set(['paint_terrain']) });

    expect(await runJob(log, makeDeps({ adapter, executor }))).toBe('done');

    const turnSeq = assistantSeqs(log)[0];
    expect(turnSeq).toBeDefined();
    expect(resultFor(log, 'w1')).toMatchObject({ write: true, turnSeq });
    expect(resultFor(log, 'r1')).toMatchObject({ write: false, turnSeq });
  });

  it('stamps the reissue result for a bad-args call', async () => {
    const log = createLog(() => 0);
    seedOrder(log, 'go');
    const adapter = createScriptedAdapter([
      toolTurn([{ callId: 'c1', name: 'paint_terrain', args: { x: 1 } }], 'length'),
      textTurn('ok'),
    ]);
    const executor = makeExecutor({ writeNames: new Set(['paint_terrain']) });

    expect(await runJob(log, makeDeps({ adapter, executor }))).toBe('done');

    expect(resultFor(log, 'c1')).toMatchObject({ isError: true, write: true, turnSeq: assistantSeqs(log)[0] });
  });

  it("stamps suggest_reply's synthesized \"Noted.\" as a non-write of its own turn", async () => {
    const log = createLog(() => 0);
    seedOrder(log, 'go');
    const adapter = createScriptedAdapter([
      toolTurn([{ callId: 'sr-1', name: 'suggest_reply', args: { reply: 'Yes, add the bridge' } }]),
      textTurn('done'),
    ]);

    expect(await runJob(log, makeDeps({ adapter, executor: makeExecutor() }))).toBe('done');

    expect(resultFor(log, 'sr-1')).toMatchObject({ content: 'Noted.', write: false, turnSeq: assistantSeqs(log)[0] });
  });

  it("stamps update_plan's own results, approved and malformed alike, as non-writes of their turn", async () => {
    const approved = createLog(() => 0);
    seedOrder(approved, 'build a town');
    const okAdapter = createScriptedAdapter([
      toolTurn([{ callId: 'plan-1', name: 'update_plan', args: { stages: [{ label: 'streets' }] } }]),
      textTurn('done'),
    ]);
    expect(await runJob(approved, makeDeps({ adapter: okAdapter, executor: makeExecutor() }))).toBe('done');
    expect(resultFor(approved, 'plan-1')).toMatchObject({
      content: 'Plan set.', write: false, turnSeq: assistantSeqs(approved)[0],
    });

    const malformed = createLog(() => 0);
    seedOrder(malformed, 'build a town');
    const badAdapter = createScriptedAdapter([
      toolTurn([{ callId: 'plan-1', name: 'update_plan', args: { stages: [{ notLabel: 'oops' }] } }]),
      textTurn('done'),
    ]);
    expect(await runJob(malformed, makeDeps({ adapter: badAdapter, executor: makeExecutor() }))).toBe('done');
    expect(resultFor(malformed, 'plan-1')).toMatchObject({
      isError: true, write: false, turnSeq: assistantSeqs(malformed)[0],
    });
  });

  it('stamps a result the SECOND turn minted with the second turn, so a repeated callId stays distinguishable', async () => {
    const log = createLog(() => 0);
    seedOrder(log, 'paint twice');
    const adapter = createScriptedAdapter([
      toolTurn([{ callId: 'call-0-0', name: 'paint_terrain', args: { x: 1 } }]),
      toolTurn([{ callId: 'call-0-0', name: 'paint_terrain', args: { x: 2 } }]),
      textTurn('done'),
    ]);
    const executor = makeExecutor({ writeNames: new Set(['paint_terrain']) });

    expect(await runJob(log, makeDeps({ adapter, executor }))).toBe('done');

    const seqs = assistantSeqs(log);
    const stamped = eventsOf(log).filter((e) => e.kind === 'toolResult').map((e) => e.turnSeq);
    expect(stamped).toEqual([seqs[0], seqs[1]]);
  });

  it('stamps a call resumed from an earlier run with the seq of the assistant event that minted it', async () => {
    const log = createLog(() => 0);
    seedOrder(log, 'paint');
    const minting = append(log, {
      kind: 'assistant', stop: 'tool-calls',
      parts: [{ kind: 'tool', callId: 'c1', name: 'paint_terrain', input: {}, argsDone: true }],
    });
    const adapter = createScriptedAdapter([textTurn('done')]);
    const executor = makeExecutor({ writeNames: new Set(['paint_terrain']) });

    expect(await runJob(log, makeDeps({ adapter, executor }))).toBe('done');

    expect(resultFor(log, 'c1')).toMatchObject({ write: true, turnSeq: minting.seq });
  });

  it('a tool-scope gate carries the minting assistant seq', async () => {
    const log = createLog(() => 0);
    seedOrder(log, 'paint a mountain');
    const adapter = createScriptedAdapter([
      toolTurn([{ callId: 'c1', name: 'paint_terrain', args: {} }]),
      textTurn('done'),
    ]);
    const executor = makeExecutor({ writeNames: new Set(['paint_terrain']) });
    const promise = runJob(log, makeDeps({ adapter, executor, oversight: 'strict' }));
    await flush();

    const asked = eventsOf(log).find((e) => e.kind === 'gateAsked');
    expect(asked).toMatchObject({ scope: 'tool', turnSeq: eventsOf(log).find((e) => e.kind === 'assistant')?.seq });

    answerGate(log, asked!.gateId, 'allow');
    expect(await promise).toBe('done');
  });

  /* A GATE SURVIVES A RELOAD, AND THE RESUME IS WHAT RE-RAISES IT. The projection withholds
   * `view.gate` while the phase is paused (nothing is asking), so this is the other half of that
   * contract: the ask has to come BACK, with a loop behind it, the moment the job is resumed. */
  it('re-enters a gate left unanswered by a reload, and the answer then runs the call', async () => {
    const log = createLog(() => 0);
    seedOrder(log, 'raise the ridge');
    append(log, {
      kind: 'assistant', stop: 'tool-calls',
      parts: [{ kind: 'tool', callId: 'c1', name: 'paint_terrain', input: { x: 1 }, argsDone: true }],
    });
    append(log, { kind: 'gateAsked', gateId: 'g1', scope: 'tool', callId: 'c1', summary: 'raise 86 cells' });
    append(log, { kind: 'paused' }); // the synthetic tail `loadLog` adds to an active restored log
    // While held, the question is not offered: there is nothing to answer it.
    expect(deriveView(log).gate).toBeUndefined();

    append(log, { kind: 'resumed' }); // the user presses Resume
    const executor = makeExecutor({ writeNames: new Set(['paint_terrain']) });
    const promise = runJob(log, makeDeps({
      adapter: createScriptedAdapter([textTurn('done')]), executor, oversight: 'strict',
    }));
    await flush();

    // The SAME gate, not a second one, and now surfaced.
    expect(eventsOf(log).filter((e) => e.kind === 'gateAsked')).toHaveLength(1);
    expect(deriveView(log).gate).toMatchObject({ gateId: 'g1', callId: 'c1' });
    expect(executor.calls).toEqual([]);

    answerGate(log, 'g1', 'allow');
    expect(await promise).toBe('done');
    expect(executor.calls).toEqual([{ callId: 'c1', name: 'paint_terrain', args: { x: 1 } }]);
  });

  it('a plan-scope gate carries the minting assistant seq', async () => {
    const log = createLog(() => 0);
    seedOrder(log, 'build a town');
    const adapter = createScriptedAdapter([
      toolTurn([{ callId: 'plan-1', name: 'update_plan', args: { stages: [{ label: 'streets' }] } }]),
      textTurn('done'),
    ]);
    const promise = runJob(log, makeDeps({ adapter, executor: makeExecutor(), oversight: 'strict' }));
    await flush();

    const asked = eventsOf(log).find((e) => e.kind === 'gateAsked');
    expect(asked).toMatchObject({ scope: 'plan', turnSeq: eventsOf(log).find((e) => e.kind === 'assistant')?.seq });

    answerGate(log, asked!.gateId, 'allow');
    expect(await promise).toBe('done');
  });
});

describe('a governor nudge that escalates a result stamps it as dampered', () => {
  function resultFor(log: SessionLog, callId: string) {
    return eventsOf(log).find((e) => e.kind === 'toolResult' && e.callId === callId);
  }

  it('flags the SECOND identical failure with detail.damper when a write in between let it execute, leaving the first unflagged', async () => {
    const log = createLog(() => 0);
    seedOrder(log, 'paint the same spot twice');
    const adapter = createScriptedAdapter([
      toolTurn([{ callId: 'c1', name: 'paint_terrain', args: { x: 1 } }]),
      toolTurn([{ callId: 'w1', name: 'place_object', args: { x: 5 } }]),
      toolTurn([{ callId: 'c2', name: 'paint_terrain', args: { x: 1 } }]),
      textTurn('done'),
    ]);
    const executor = makeExecutor({
      writeNames: new Set(['paint_terrain', 'place_object']),
      result: (call) => call.name === 'paint_terrain'
        ? { content: 'refused', isError: true }
        : { content: 'placed', isError: false },
    });

    expect(await runJob(log, makeDeps({ adapter, executor }))).toBe('done');

    expect(resultFor(log, 'c1')).not.toHaveProperty('detail.damper');
    expect(resultFor(log, 'c2')).toMatchObject({ detail: { damper: true } });
    expect(resultFor(log, 'c2')).not.toHaveProperty('detail.repeatRefused');
    expect(executor.calls.map((c) => c.callId)).toEqual(['c1', 'w1', 'c2']);
  });

  it('flags the SECOND revert of the same tool with detail.damper, preserving its other detail fields', async () => {
    const log = createLog(() => 0);
    seedOrder(log, 'raise the same ridge twice');
    const adapter = createScriptedAdapter([
      toolTurn([{ callId: 'c1', name: 'paint_terrain', args: { x: 1 } }]),
      toolTurn([{ callId: 'c2', name: 'paint_terrain', args: { x: 2 } }]),
      textTurn('done'),
    ]);
    const executor = makeExecutor({
      result: () => ({ content: 'reverted', isError: false, detail: { reverted: true, cells: 3 } }),
    });

    expect(await runJob(log, makeDeps({ adapter, executor }))).toBe('done');

    expect(resultFor(log, 'c1')).not.toHaveProperty('detail.damper');
    expect(resultFor(log, 'c2')).toMatchObject({ detail: { reverted: true, cells: 3, damper: true } });
  });

  it('a failure that never escalates carries no damper flag at all', async () => {
    const log = createLog(() => 0);
    seedOrder(log, 'paint once');
    const adapter = createScriptedAdapter([
      toolTurn([{ callId: 'c1', name: 'paint_terrain', args: { x: 1 } }]),
      textTurn('done'),
    ]);
    const executor = makeExecutor({ result: () => ({ content: 'refused', isError: true }) });

    expect(await runJob(log, makeDeps({ adapter, executor }))).toBe('done');

    expect(resultFor(log, 'c1')).not.toHaveProperty('detail.damper');
  });
});

/**
 * A REFUSED CALL, RESENT UNCHANGED, IS REFUSED WITHOUT RUNNING. The identical arguments against
 * the same map earn the identical error, so the loop answers with that error itself instead of
 * spending an execution; a success with those args, or any successful write since the failure,
 * reopens the ground.
 */
describe('an identical retry of a just-failed call is refused without running', () => {
  const PAINT = { name: 'paint_terrain', args: { terrain: 'water', elevation: 2 } };
  const ARG_ERROR = 'Arguments: no cells given, pass shape ("rect", "circle", or "line") with its flat coordinates, or cells.';

  function resultFor(log: SessionLog, callId: string) {
    return eventsOf(log).find((e) => e.kind === 'toolResult' && e.callId === callId);
  }

  function failingExecutor() {
    return makeExecutor({
      writeNames: new Set(['paint_terrain', 'place_object']),
      result: (call) => call.name === 'paint_terrain'
        ? { content: ARG_ERROR, isError: true }
        : { content: 'placed', isError: false },
    });
  }

  it('answers the first repeat with the same error and runs nothing; further repeats escalate once', async () => {
    const log = createLog(() => 0);
    seedOrder(log, 'flood the terrace');
    const adapter = createScriptedAdapter([
      toolTurn([{ callId: 'c1', ...PAINT }]),
      toolTurn([{ callId: 'c2', ...PAINT }]),
      toolTurn([{ callId: 'c3', ...PAINT }]),
      textTurn('giving up'),
    ]);
    const executor = failingExecutor();

    expect(await runJob(log, makeDeps({ adapter, executor }))).toBe('done');

    expect(executor.calls.map((c) => c.callId)).toEqual(['c1']);
    const second = resultFor(log, 'c2');
    expect(second).toMatchObject({ isError: true, detail: { damper: true, repeatRefused: true } });
    expect(second).toMatchObject({ content: expect.stringContaining('just failed') });
    expect(second).toMatchObject({ content: expect.stringContaining(ARG_ERROR) });
    expect(second).toMatchObject({ content: expect.stringContaining('will not run') });
    expect(second).not.toMatchObject({ content: expect.stringMatching(/inspect_region|load_skill/) });
    const third = resultFor(log, 'c3');
    expect(third).toMatchObject({ isError: true, detail: { damper: true, repeatRefused: true } });
    expect(third).toMatchObject({ content: expect.stringMatching(/inspect_region/) });
    expect(third).toMatchObject({ content: expect.stringMatching(/load_skill/) });
  });

  it('an identical call that SUCCEEDED runs again: only failures open the damper', async () => {
    const log = createLog(() => 0);
    seedOrder(log, 'place two spots');
    const adapter = createScriptedAdapter([
      toolTurn([{ callId: 'c1', name: 'place_object', args: { x: 5 } }]),
      toolTurn([{ callId: 'c2', name: 'place_object', args: { x: 5 } }]),
      textTurn('done'),
    ]);
    const executor = failingExecutor();

    expect(await runJob(log, makeDeps({ adapter, executor }))).toBe('done');

    expect(executor.calls.map((c) => c.callId)).toEqual(['c1', 'c2']);
    expect(resultFor(log, 'c2')).not.toHaveProperty('detail.repeatRefused');
  });

  it('a successful write between the failure and the retry reopens the ground: the retry executes', async () => {
    const log = createLog(() => 0);
    seedOrder(log, 'flood the terrace');
    const adapter = createScriptedAdapter([
      toolTurn([{ callId: 'c1', ...PAINT }]),
      toolTurn([{ callId: 'w1', name: 'place_object', args: { x: 5 } }]),
      toolTurn([{ callId: 'c2', ...PAINT }]),
      textTurn('done'),
    ]);
    const executor = failingExecutor();

    expect(await runJob(log, makeDeps({ adapter, executor }))).toBe('done');

    expect(executor.calls.map((c) => c.callId)).toEqual(['c1', 'w1', 'c2']);
    expect(resultFor(log, 'c2')).not.toHaveProperty('detail.repeatRefused');
  });

  it('different arguments never trip it', async () => {
    const log = createLog(() => 0);
    seedOrder(log, 'flood the terrace');
    const adapter = createScriptedAdapter([
      toolTurn([{ callId: 'c1', ...PAINT }]),
      toolTurn([{ callId: 'c2', name: PAINT.name, args: { ...PAINT.args, rect: { x1: 1, y1: 1, x2: 4, y2: 4 } } }]),
      textTurn('done'),
    ]);
    const executor = failingExecutor();

    expect(await runJob(log, makeDeps({ adapter, executor }))).toBe('done');

    expect(executor.calls.map((c) => c.callId)).toEqual(['c1', 'c2']);
  });

  it('a refused repeat never asks a gate: a call that will not run costs no approval', async () => {
    const log = createLog(() => 0);
    seedOrder(log, 'flood the terrace');
    const adapter = createScriptedAdapter([
      toolTurn([{ callId: 'c1', ...PAINT }]),
      toolTurn([{ callId: 'c2', ...PAINT }]),
      textTurn('done'),
    ]);
    const executor = failingExecutor();
    const promise = runJob(log, makeDeps({ adapter, executor, oversight: 'strict' }));
    await flush();

    const firstGate = eventsOf(log).find((e) => e.kind === 'gateAsked');
    expect(firstGate).toBeDefined();
    answerGate(log, firstGate!.gateId, 'allow');
    expect(await promise).toBe('done');

    expect(eventsOf(log).filter((e) => e.kind === 'gateAsked')).toHaveLength(1);
    expect(executor.calls.map((c) => c.callId)).toEqual(['c1']);
    expect(resultFor(log, 'c2')).toMatchObject({ detail: { repeatRefused: true } });
  });

  it('the refusal shows honestly in the projection: an error row whose summary names it, and a damper stamp on the job', async () => {
    const log = createLog(() => 0);
    seedOrder(log, 'flood the terrace');
    const adapter = createScriptedAdapter([
      toolTurn([{ callId: 'c1', ...PAINT }]),
      toolTurn([{ callId: 'c2', ...PAINT }]),
      textTurn('done'),
    ]);
    const executor = failingExecutor();

    expect(await runJob(log, makeDeps({ adapter, executor }))).toBe('done');

    const view = deriveView(log);
    const op = view.jobs[0]!.ops.find((o) => o.callId === 'c2')!;
    expect(op.status).toBe('error');
    expect(op.summary).toMatch(/[Nn]ot run/);
    expect(view.jobs[0]!.stamps).toContainEqual(expect.objectContaining({ kind: 'damper' }));
  });
});

/**
 * THE PLAN RAIL HAS TO MOVE. The rail renders `plan.currentIndex`/`doneCount`, which fold from the
 * `stage` event; with nothing emitting it the rail would show every stage pending for a whole
 * job. The loop is the emitter, at the boundary the workflow prompt already names: "call
 * evaluate_map as you finish each stage". These tests hold that reading against the two calls the
 * SAME prompt asks for that are not boundaries (the baseline before any building, a re-measurement
 * after a fix), since a rule that advanced on either would run the rail ahead of the work.
 */
describe('the plan rail advances at a stage boundary', () => {
  const PLAN_ARGS = { stages: [{ label: 'streets' }, { label: 'houses' }, { label: 'gardens' }] };
  const evalCall = (n: number) => ({ callId: `ev-${n}`, name: 'evaluate_map' });
  const writeCall = (n: number) => ({ callId: `w-${n}`, name: 'paint_terrain', args: { x: n } });

  function planExecutor() {
    return makeExecutor({ writeNames: new Set(['paint_terrain']) });
  }

  function stageIndices(log: SessionLog): number[] {
    return eventsOf(log).flatMap((e) => (e.kind === 'stage' ? [e.index] : []));
  }

  it('a baseline evaluate_map before any write leaves the rail on stage 0', async () => {
    const log = createLog(() => 0);
    seedOrder(log, 'build a town');
    const adapter = createScriptedAdapter([
      toolTurn([{ callId: 'plan-1', name: 'update_plan', args: PLAN_ARGS }]),
      toolTurn([evalCall(1)]),
      textTurn('measured first'),
    ]);

    await runJob(log, makeDeps({ adapter, executor: planExecutor() }));

    expect(stageIndices(log)).toEqual([]);
    expect(deriveView(log).jobs[0]?.plan).toMatchObject({ currentIndex: 0, doneCount: 0 });
  });

  it('a write then evaluate_map advances one stage, and a re-measurement with no write between does not advance again', async () => {
    const log = createLog(() => 0);
    seedOrder(log, 'build a town');
    const adapter = createScriptedAdapter([
      toolTurn([{ callId: 'plan-1', name: 'update_plan', args: PLAN_ARGS }]),
      toolTurn([writeCall(1), evalCall(1)]),
      toolTurn([evalCall(2)]),
      textTurn('still on houses'),
    ]);

    await runJob(log, makeDeps({ adapter, executor: planExecutor() }));

    expect(stageIndices(log)).toEqual([1]);
    expect(deriveView(log).jobs[0]?.plan).toMatchObject({ currentIndex: 1, doneCount: 1 });
  });

  it('each further stage advances on its own write-then-measure pair, and the last stage never advances past itself', async () => {
    const log = createLog(() => 0);
    seedOrder(log, 'build a town');
    const adapter = createScriptedAdapter([
      toolTurn([{ callId: 'plan-1', name: 'update_plan', args: PLAN_ARGS }]),
      toolTurn([writeCall(1), evalCall(1)]),
      toolTurn([writeCall(2), evalCall(2)]),
      toolTurn([writeCall(3), evalCall(3)]),
      textTurn('all three built'),
    ]);

    await runJob(log, makeDeps({ adapter, executor: planExecutor() }));

    // Three boundaries, three stages: the third measurement finds the rail already on the last
    // stage and appends nothing.
    expect(stageIndices(log)).toEqual([1, 2]);
    expect(deriveView(log).jobs[0]?.plan).toMatchObject({ currentIndex: 2, doneCount: 2 });
  });

  it('a FAILED evaluate_map is not a boundary', async () => {
    const log = createLog(() => 0);
    seedOrder(log, 'build a town');
    const adapter = createScriptedAdapter([
      toolTurn([{ callId: 'plan-1', name: 'update_plan', args: PLAN_ARGS }]),
      toolTurn([writeCall(1), evalCall(1)]),
      textTurn('measurement failed'),
    ]);
    const executor = makeExecutor({
      writeNames: new Set(['paint_terrain']),
      result: (call) => call.name === 'evaluate_map'
        ? { content: 'could not read the map', isError: true }
        : { content: `did ${call.name}`, isError: false },
    });

    await runJob(log, makeDeps({ adapter, executor }));

    expect(stageIndices(log)).toEqual([]);
  });

  it('a planless job never emits a stage event, however many times it measures', async () => {
    const log = createLog(() => 0);
    seedOrder(log, 'dig one pond');
    const adapter = createScriptedAdapter([
      toolTurn([writeCall(1), evalCall(1)]),
      toolTurn([writeCall(2), evalCall(2)]),
      textTurn('dug it'),
    ]);

    await runJob(log, makeDeps({ adapter, executor: planExecutor() }));

    expect(stageIndices(log)).toEqual([]);
  });

  it('each advance banks its own stage checkpoint at the next step boundary, carrying the stage index the record rewinds to', async () => {
    const log = createLog(() => 0);
    seedOrder(log, 'build a town');
    const adapter = createScriptedAdapter([
      toolTurn([{ callId: 'plan-1', name: 'update_plan', args: PLAN_ARGS }]),
      toolTurn([writeCall(1), evalCall(1)]),
      toolTurn([writeCall(2), evalCall(2)]),
      textTurn('built'),
    ]);
    let undo = 0;
    const deps = makeDeps({ adapter, executor: planExecutor(), undoStackSize: () => ++undo });

    await runJob(log, deps);

    const staged = deriveView(log).jobs[0]?.checkpoints.filter((c) => c.label === 'stage') ?? [];
    expect(staged.map((c) => c.stageIndex)).toEqual([1, 2]);
  });

  it('a serialized then restored log folds to the same rail position', async () => {
    const log = createLog(() => 0);
    seedOrder(log, 'build a town');
    const adapter = createScriptedAdapter([
      toolTurn([{ callId: 'plan-1', name: 'update_plan', args: PLAN_ARGS }]),
      toolTurn([writeCall(1), evalCall(1)]),
      toolTurn([writeCall(2), evalCall(2)]),
      textTurn('built'),
    ]);

    await runJob(log, makeDeps({ adapter, executor: planExecutor() }));

    const restored = deserializeLog(serializeLog(log), () => 0);
    expect(restored).not.toBeNull();
    expect(deriveView(restored!).jobs[0]?.plan).toEqual(deriveView(log).jobs[0]?.plan);
    expect(deriveView(restored!).jobs[0]?.plan).toMatchObject({ currentIndex: 2, doneCount: 2 });
  });
});

/**
 * THE CLOSING WORDS SURVIVE THE SETTLE. A `jobEnd` carrying an outcome and nothing else would
 * leave the answer card no text to show, and every finished job would read alike. The settle
 * carries the closing text as `summary` and marks it when it ENDS IN A QUESTION, which is the fact
 * the done.question state and the celebrate hold both read. A quiet giveup carries neither: no
 * words were said, and inventing some would put a sentence in the model's mouth.
 *
 * The words ride EVERY outcome that has them (a cap was told to wrap up; an abort still said what
 * it said), and the question mark rides only the ones the MODEL ended: a truncated fragment or a
 * cut-off sentence that happens to stop on "?" must never leave the job waiting on an answer to a
 * question nobody asked.
 */
describe('the closing words settle into the record', () => {
  function lastEnd(log: SessionLog) {
    const ends = eventsOf(log).filter((e) => e.kind === 'jobEnd');
    return ends[ends.length - 1];
  }

  it('a text-only closing turn settles the whole text, joined across parts and trimmed', async () => {
    const log = createLog(() => 0);
    seedOrder(log, 'raise a ridge');
    const adapter = createScriptedAdapter([{
      events: [
        { t: 'text', delta: 'I raised the ridge ' },
        { t: 'text', delta: 'and planted pines.\n' },
        { t: 'done', stop: 'stop' },
      ],
    }]);

    expect(await runJob(log, makeDeps({ adapter, executor: makeExecutor() }))).toBe('done');

    expect(lastEnd(log)).toMatchObject({
      outcome: 'done', summary: 'I raised the ridge and planted pines.',
    });
  });

  it('a closing question is marked, a closing statement is not, and a fullwidth question mark counts', async () => {
    const asked = createLog(() => 0);
    seedOrder(asked, 'plant something');
    expect(await runJob(asked, makeDeps({
      adapter: createScriptedAdapter([textTurn('The ridge is up. Should I add the pines? ')]),
      executor: makeExecutor(),
    }))).toBe('done');
    expect(lastEnd(asked)).toMatchObject({ summary: 'The ridge is up. Should I add the pines?', question: true });

    const stated = createLog(() => 0);
    seedOrder(stated, 'plant something');
    expect(await runJob(stated, makeDeps({
      adapter: createScriptedAdapter([textTurn('Done.')]), executor: makeExecutor(),
    }))).toBe('done');
    expect(lastEnd(stated)).toMatchObject({ summary: 'Done.' });
    expect(lastEnd(stated)).not.toHaveProperty('question');

    const fullwidth = createLog(() => 0);
    seedOrder(fullwidth, 'plant something');
    expect(await runJob(fullwidth, makeDeps({
      adapter: createScriptedAdapter([textTurn('山脊已经立好，要再种一片松林吗？')]), executor: makeExecutor(),
    }))).toBe('done');
    expect(lastEnd(fullwidth)).toMatchObject({ question: true });
  });

  it('a closing turn whose only call is suggest_reply settles right after "Noted.", costing no second round', async () => {
    const log = createLog(() => 0);
    seedOrder(log, 'raise a ridge');
    const adapter = createScriptedAdapter([
      sayingToolTurn('The ridge is up. Add the pines?', [{ callId: 'sr-1', name: 'suggest_reply', args: { reply: 'Yes, add them' } }]),
      textTurn('(a second round nobody asked for)'),
    ]);
    const executor = makeExecutor();

    expect(await runJob(log, makeDeps({ adapter, executor }))).toBe('done');

    expect(adapter.requests).toHaveLength(1);
    expect(executor.calls).toEqual([]);
    expect(eventsOf(log).map((e) => e.kind)).toEqual(['order', 'assistant', 'toolResult', 'jobEnd']);
    expect(lastEnd(log)).toMatchObject({
      outcome: 'done', summary: 'The ridge is up. Add the pines?', question: true,
    });
  });

  it('a suggest_reply mixed with a real call does not settle the turn: the real call decides it', async () => {
    const log = createLog(() => 0);
    seedOrder(log, 'raise a ridge');
    const adapter = createScriptedAdapter([
      sayingToolTurn('Raising it now, then I will ask.', [
        { callId: 'sr-1', name: 'suggest_reply', args: { reply: 'Yes' } },
        { callId: 'w1', name: 'paint_terrain', args: { x: 1 } },
      ]),
      textTurn('Ridge raised.'),
    ]);
    const executor = makeExecutor({ writeNames: new Set(['paint_terrain']) });

    expect(await runJob(log, makeDeps({ adapter, executor }))).toBe('done');

    expect(adapter.requests).toHaveLength(2);
    expect(executor.calls).toEqual([{ callId: 'w1', name: 'paint_terrain', args: { x: 1 } }]);
    expect(lastEnd(log)).toMatchObject({ summary: 'Ridge raised.' });
  });

  it('a suggest_reply with no words is not a closing turn: the loop asks for the next one', async () => {
    const log = createLog(() => 0);
    seedOrder(log, 'raise a ridge');
    const adapter = createScriptedAdapter([
      toolTurn([{ callId: 'sr-1', name: 'suggest_reply', args: { reply: 'Yes' } }]),
      textTurn('Ridge raised.'),
    ]);

    expect(await runJob(log, makeDeps({ adapter, executor: makeExecutor() }))).toBe('done');

    expect(adapter.requests).toHaveLength(2);
    expect(lastEnd(log)).toMatchObject({ summary: 'Ridge raised.' });
  });

  it('three empty turns give up quietly: done with no summary at all', async () => {
    const log = createLog(() => 0);
    seedOrder(log, 'go');
    const adapter = createScriptedAdapter([EMPTY_TURN, EMPTY_TURN, EMPTY_TURN]);

    expect(await runJob(log, makeDeps({ adapter, executor: makeExecutor() }))).toBe('done');

    expect(adapter.requests).toHaveLength(3);
    expect(lastEnd(log)).toMatchObject({ outcome: 'done' });
    expect(lastEnd(log)).not.toHaveProperty('summary');
    expect(lastEnd(log)).not.toHaveProperty('question');
  });

  it('a capped job carries its closing words: the model was told to wrap up, so the text IS the closing one', async () => {
    const log = createLog(() => 0);
    seedOrder(log, 'build a town');
    const adapter = createScriptedAdapter([textTurn('I got the streets in. Should I keep going next time?')]);

    expect(await runJob(log, makeDeps({ adapter, executor: makeExecutor(), maxTurns: 1 }))).toBe('capped');

    expect(lastEnd(log)).toMatchObject({
      outcome: 'capped', summary: 'I got the streets in. Should I keep going next time?', question: true,
    });
  });

  it('a mid-stream abort keeps what was said but never marks it a question: the cut chose the ending, not the model', async () => {
    const log = createLog(() => 0);
    seedOrder(log, 'raise a ridge');
    const controller = new AbortController();
    const adapter = createScriptedAdapter([{
      events: [
        { t: 'text', delta: 'I was raising the ridge. Keep going?' },
        { t: 'text', delta: ' (never streamed)' },
        { t: 'done', stop: 'stop' },
      ],
    }]);
    const deps = makeDeps({
      adapter, executor: makeExecutor(), signal: controller.signal,
      onLive: (parts) => { if (parts?.some((p) => p.kind === 'text')) controller.abort(); },
    });

    expect(await runJob(log, deps)).toBe('aborted');

    expect(lastEnd(log)).toMatchObject({ outcome: 'aborted', summary: 'I was raising the ridge. Keep going?' });
    expect(lastEnd(log)).not.toHaveProperty('question');
  });

  it('a provider-truncated turn keeps its fragment as the summary and is never read as a question', async () => {
    const log = createLog(() => 0);
    seedOrder(log, 'raise a ridge');
    const adapter = createScriptedAdapter([{
      events: [
        { t: 'text', delta: 'The ridge is up, and next I would' },
        { t: 'done', stop: 'length' },
      ],
    }]);

    expect(await runJob(log, makeDeps({ adapter, executor: makeExecutor() }))).toBe('done');

    expect(lastEnd(log)).toMatchObject({ outcome: 'done', summary: 'The ridge is up, and next I would' });
    expect(lastEnd(log)).not.toHaveProperty('question');

    // The same fragment ending ON a question mark is still no question: the cut landed there.
    const cutOnMark = createLog(() => 0);
    seedOrder(cutOnMark, 'raise a ridge');
    expect(await runJob(cutOnMark, makeDeps({
      adapter: createScriptedAdapter([{
        events: [{ t: 'text', delta: 'The ridge is up. Should I?' }, { t: 'done', stop: 'length' }],
      }]),
      executor: makeExecutor(),
    }))).toBe('done');
    expect(lastEnd(cutOnMark)).toMatchObject({ summary: 'The ridge is up. Should I?' });
    expect(lastEnd(cutOnMark)).not.toHaveProperty('question');
  });

  it('an incident settles with no words at all: the error class is what carries the trouble', async () => {
    const log = createLog(() => 0);
    seedOrder(log, 'raise a ridge');
    const adapter = createScriptedAdapter([() => [
      { t: 'text', delta: 'Halfway up the ridge. Keep going?' },
      { t: 'error', error: { cls: 'auth', detail: 'the key was refused' } },
    ]]);

    expect(await runJob(log, makeDeps({ adapter, executor: makeExecutor() }))).toBe('incident');

    expect(eventsOf(log).some((e) => e.kind === 'incident')).toBe(true);
    expect(lastEnd(log)).toMatchObject({ outcome: 'incident' });
    expect(lastEnd(log)).not.toHaveProperty('summary');
    expect(lastEnd(log)).not.toHaveProperty('question');
  });

  it('the settled summary reaches the projection as JobView.summary, across a serialize round-trip', async () => {
    const log = createLog(() => 0);
    seedOrder(log, 'raise a ridge');
    const adapter = createScriptedAdapter([textTurn('The ridge is up. Add the pines?')]);

    expect(await runJob(log, makeDeps({ adapter, executor: makeExecutor() }))).toBe('done');

    expect(deriveView(log).jobs[0]).toMatchObject({ summary: 'The ridge is up. Add the pines?' });
    const restored = deserializeLog(serializeLog(log), () => 0);
    expect(restored).not.toBeNull();
    expect(deriveView(restored!).jobs[0]?.summary).toBe('The ridge is up. Add the pines?');
  });
});

/**
 * THE CONSTRUCTION BEAT: a real pause between consecutive WRITES, so the work is watchable.
 *
 * A batch of writes lands in one microtask burst, which on the glass is the map jumping to its
 * finished state with the working animation never having played a frame. The beat is spent in the
 * LOOP rather than in a renderer: a render delay would hold the panel's own report back too, and the
 * edits would already have landed either way. Reads are unpaced (nothing lands for them to show), the
 * first write of a batch is unpaced (there is nothing to pace it against), and the wait is the
 * injected `sleep` — the runner's skippable one — so a stop cuts straight through it.
 */
describe('the construction beat', () => {
  const WRITES = new Set(['paint_terrain']);

  /** The sleeps the loop asked for, resolved at once so the test stays synchronous in promise time.
   *  The signal is recorded too: a beat nothing can interrupt outlives the stop meant to end it. */
  function sleepSpy(): { calls: { ms: number; signal: AbortSignal }[]; sleep: NonNullable<LoopDeps['sleep']> } {
    const calls: { ms: number; signal: AbortSignal }[] = [];
    return {
      calls,
      sleep: (ms, signal) => { calls.push({ ms, signal }); return Promise.resolve(); },
    };
  }

  it('paces every write after the first, and no read', async () => {
    const log = createLog();
    append(log, { kind: 'order', text: 'build three things', mapContext: 'Hexia' });
    const spy = sleepSpy();
    const executor = makeExecutor({ writeNames: WRITES });
    const deps = makeDeps({
      adapter: createScriptedAdapter([
        toolTurn([
          { callId: 'c1', name: 'paint_terrain' },
          { callId: 'c2', name: 'inspect_region' },
          { callId: 'c3', name: 'paint_terrain' },
          { callId: 'c4', name: 'paint_terrain' },
        ]),
        textTurn('built'),
      ]),
      executor,
      sleep: spy.sleep,
    });

    await runJob(log, deps);

    // c1 is the batch's first write and c2 is a read: neither is paced. c3 and c4 each follow a write.
    expect(spy.calls.map((c) => c.ms)).toEqual([BUILD_BEAT_MS, BUILD_BEAT_MS]);
    expect(spy.calls.every((c) => c.signal === deps.signal)).toBe(true);
    expect(executor.calls.map((c) => c.callId)).toEqual(['c1', 'c2', 'c3', 'c4']);
  });

  it('paces nothing for a batch of reads alone', async () => {
    const log = createLog();
    append(log, { kind: 'order', text: 'look around', mapContext: 'Hexia' });
    const spy = sleepSpy();
    const deps = makeDeps({
      adapter: createScriptedAdapter([
        toolTurn([
          { callId: 'r1', name: 'inspect_region' },
          { callId: 'r2', name: 'inspect_region' },
        ]),
        textTurn('had a look'),
      ]),
      executor: makeExecutor({ writeNames: WRITES }),
      sleep: spy.sleep,
    });

    await runJob(log, deps);

    expect(spy.calls).toEqual([]);
  });

  /** A SKIPPED WRITE IS NOT A WRITE. Nothing landed on the map for the next one to be paced against,
   *  so a batch the user declined runs at its own speed. */
  it('paces nothing after a write the user declined', async () => {
    const log = createLog();
    append(log, { kind: 'order', text: 'build two things', mapContext: 'Hexia' });
    const spy = sleepSpy();
    const deps = makeDeps({
      adapter: createScriptedAdapter([
        toolTurn([
          { callId: 'c1', name: 'paint_terrain' },
          { callId: 'c2', name: 'paint_terrain' },
        ]),
        textTurn('one of them, then'),
      ]),
      executor: makeExecutor({ writeNames: WRITES }),
      oversight: 'strict',
      sleep: spy.sleep,
    });

    const run = runJob(log, deps);
    await flush();
    answerGate(log, pendingGate(log)!.gateId, 'skip');
    await flush();
    answerGate(log, pendingGate(log)!.gateId, 'allow');
    await run;

    expect(spy.calls, 'the first write never landed').toEqual([]);
  });

  /** A STOP CUTS THROUGH THE BEAT. The wait carries the job's own signal, so an abort inside it ends
   *  the job there rather than after the pause it was waiting out. */
  it('ends the job where the beat was, when the stop lands inside it', async () => {
    const log = createLog();
    append(log, { kind: 'order', text: 'build two things', mapContext: 'Hexia' });
    const controller = new AbortController();
    const deps = makeDeps({
      adapter: createScriptedAdapter([
        toolTurn([
          { callId: 'c1', name: 'paint_terrain' },
          { callId: 'c2', name: 'paint_terrain' },
        ]),
        textTurn('never runs'),
      ]),
      executor: makeExecutor({ writeNames: WRITES }),
      signal: controller.signal,
      sleep: (_ms, signal) => new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        controller.abort();
      }),
    });

    const outcome = await runJob(log, deps);

    expect(outcome).toBe('aborted');
    expect(eventsOf(log).some((e) => e.kind === 'toolResult' && e.callId === 'c1')).toBe(true);
    expect(eventsOf(log).some((e) => e.kind === 'toolResult' && e.callId === 'c2')).toBe(false);
    expect(eventsOf(log)[eventsOf(log).length - 1]).toMatchObject({ kind: 'jobEnd', outcome: 'aborted' });
  });

  /** MAX, NOT SUM. The inter-turn courtesy wait and the beat are two answers to the same question
   *  (how fast may this job go), and they cover different gaps: the beat is inside a batch, the
   *  courtesy is between turns. A batch of one write therefore adds nothing to a turn boundary. */
  it('adds nothing to a turn boundary, which the courtesy wait already owns', async () => {
    const log = createLog();
    append(log, { kind: 'order', text: 'build one thing', mapContext: 'Hexia' });
    const spy = sleepSpy();
    const deps = makeDeps({
      adapter: createScriptedAdapter([
        toolTurn([{ callId: 'c1', name: 'paint_terrain' }]),
        toolTurn([{ callId: 'c2', name: 'paint_terrain' }]),
        textTurn('done'),
      ]),
      executor: makeExecutor({ writeNames: WRITES }),
      sleep: spy.sleep,
    });

    await runJob(log, deps);

    expect(spy.calls, 'one write per turn is one write per batch').toEqual([]);
  });
});

/**
 * THE DELIVERY NUDGE: finishing means delivering. A closing turn (text, no real tool call) on a job
 * that COULD write but landed nothing is answered once with the delivery contract instead of
 * settling — build the order's intent on the map as it stands, or state plainly that it cannot be
 * done. The note is a `systemNote` log event, so it reaches the model through the ordinary replay
 * and survives into the record; the close after it is final whatever it says, which is what bounds
 * the nudge to one extra turn per job.
 */
describe('the delivery nudge', () => {
  /** The default fixture tools plus one advertised WRITE verb: the nudge asks for an edit, so it
   *  only speaks to a job whose tool set could land one. */
  const BUILD_TOOLS = [
    ...PARENT_CONTROL_TOOLS,
    { name: 'paint_terrain', description: 'stand-in', parameters: {} },
  ];
  const writeExecutor = () => makeExecutor({ writeNames: new Set(['paint_terrain']) });

  function systemNotes(log: SessionLog) {
    return eventsOf(log).filter((e) => e.kind === 'systemNote');
  }

  it('answers the first zero-write close with the contract, and the next close settles the job', async () => {
    const log = createLog(() => 0);
    seedOrder(log, 'bridge the river and bring the road to both banks');
    const adapter = createScriptedAdapter([
      textTurn('The bridge and the road are in place.'),
      textTurn('There is no river on this map, so there was no crossing to build.'),
    ]);
    const deps = makeDeps({ adapter, executor: writeExecutor(), tools: BUILD_TOOLS });

    const outcome = await runJob(log, deps);

    expect(outcome).toBe('done');
    expect(eventsOf(log).map((e) => e.kind)).toEqual(['order', 'assistant', 'systemNote', 'assistant', 'jobEnd']);
    const note = systemNotes(log)[0];
    expect(note?.kind === 'systemNote' && note.note).toBe('delivery');
    expect(note?.kind === 'systemNote' && note.text).toBe(deliveryNudge());

    // The note reaches the model as the trailing user message of the next request.
    expect(adapter.requests).toHaveLength(2);
    const messages = adapter.requests[1]?.messages ?? [];
    expect(messages[messages.length - 1]).toEqual({ role: 'user', text: deliveryNudge() });

    // The words that settle the job are the SECOND close's.
    const end = eventsOf(log)[eventsOf(log).length - 1];
    expect(end).toMatchObject({
      kind: 'jobEnd', outcome: 'done',
      summary: 'There is no river on this map, so there was no crossing to build.',
    });
  });

  it('the second close is final whatever it says: still zero writes, still the same words, no second nudge', async () => {
    const log = createLog(() => 0);
    seedOrder(log, 'repair the storm damage');
    const adapter = createScriptedAdapter([textTurn('Done.'), textTurn('Done.')]);
    const deps = makeDeps({ adapter, executor: writeExecutor(), tools: BUILD_TOOLS });

    const outcome = await runJob(log, deps);

    expect(outcome).toBe('done');
    expect(systemNotes(log)).toHaveLength(1);
    expect(adapter.requests).toHaveLength(2);
    expect(eventsOf(log)[eventsOf(log).length - 1]).toMatchObject({ kind: 'jobEnd', outcome: 'done', summary: 'Done.' });
  });

  it('never fires on a job whose write landed', async () => {
    const log = createLog(() => 0);
    seedOrder(log, 'raise a hill');
    const adapter = createScriptedAdapter([
      toolTurn([{ callId: 'c1', name: 'paint_terrain', args: { shape: 'rect' } }]),
      textTurn('The hill stands.'),
    ]);
    const deps = makeDeps({ adapter, executor: writeExecutor(), tools: BUILD_TOOLS });

    const outcome = await runJob(log, deps);

    expect(outcome).toBe('done');
    expect(systemNotes(log)).toHaveLength(0);
    expect(adapter.requests).toHaveLength(2);
  });

  it('a reverted write is not delivery: the close is still nudged', async () => {
    const log = createLog(() => 0);
    seedOrder(log, 'raise a hill');
    const adapter = createScriptedAdapter([
      toolTurn([{ callId: 'c1', name: 'paint_terrain', args: { shape: 'rect' } }]),
      textTurn('The hill stands.'),
      textTurn('The hill kept reverting, so nothing stands; the slope needs a wider base than this plot has.'),
    ]);
    const executor = makeExecutor({
      writeNames: new Set(['paint_terrain']),
      result: () => ({ content: 'REVERTED: the mound would float', isError: false, detail: { reverted: true } }),
    });
    const deps = makeDeps({ adapter, executor, tools: BUILD_TOOLS });

    const outcome = await runJob(log, deps);

    expect(outcome).toBe('done');
    expect(systemNotes(log)).toHaveLength(1);
  });

  it('a close that ends by asking the user something is waiting on them, not nudged', async () => {
    const log = createLog(() => 0);
    seedOrder(log, 'bridge the river');
    const adapter = createScriptedAdapter([textTurn('There is no river here. Should I carve one first?')]);
    const deps = makeDeps({ adapter, executor: writeExecutor(), tools: BUILD_TOOLS });

    const outcome = await runJob(log, deps);

    expect(outcome).toBe('done');
    expect(systemNotes(log)).toHaveLength(0);
    expect(adapter.requests).toHaveLength(1);
    expect(eventsOf(log)[eventsOf(log).length - 1]).toMatchObject({ kind: 'jobEnd', question: true });
  });

  it('a job whose advertised tools include no write verb settles at once: it was never asked to build', async () => {
    const log = createLog(() => 0);
    seedOrder(log, 'what is on this map');
    const adapter = createScriptedAdapter([textTurn('A plaza and open grass, nothing else.')]);
    const deps = makeDeps({ adapter, executor: writeExecutor() }); // default tools: no write among them

    const outcome = await runJob(log, deps);

    expect(outcome).toBe('done');
    expect(systemNotes(log)).toHaveLength(0);
    expect(adapter.requests).toHaveLength(1);
  });

  it('a suggest_reply-only close with nothing landed is nudged like a bare one', async () => {
    const log = createLog(() => 0);
    seedOrder(log, 'repair the broken road');
    const adapter = createScriptedAdapter([
      sayingToolTurn('All patched up.', [{ callId: 'sr1', name: 'suggest_reply', args: { reply: 'Thanks' } }]),
      textTurn('Nothing was actually broken; the road already runs whole.'),
    ]);
    const deps = makeDeps({ adapter, executor: writeExecutor(), tools: BUILD_TOOLS });

    const outcome = await runJob(log, deps);

    expect(outcome).toBe('done');
    expect(systemNotes(log)).toHaveLength(1);
    expect(eventsOf(log)[eventsOf(log).length - 1]).toMatchObject({
      kind: 'jobEnd', summary: 'Nothing was actually broken; the road already runs whole.',
    });
  });

  it('the nudge is scoped per job: a fresh order on the same log earns its own', async () => {
    const log = createLog(() => 0);
    seedOrder(log, 'build a pier');
    const first = makeDeps({
      adapter: createScriptedAdapter([textTurn('Pier done.'), textTurn('No shoreline here to pier against.')]),
      executor: writeExecutor(), tools: BUILD_TOOLS,
    });
    expect(await runJob(log, first)).toBe('done');

    seedOrder(log, 'build a cabin');
    const second = makeDeps({
      adapter: createScriptedAdapter([textTurn('Cabin done.'), textTurn('The plot is locked; no cabin can stand there.')]),
      executor: writeExecutor(), tools: BUILD_TOOLS,
    });
    expect(await runJob(log, second)).toBe('done');

    expect(systemNotes(log)).toHaveLength(2);
  });
});

/**
 * THE REVIEW BEAT: the review serves the order. The first closing turn of a job whose build LANDED
 * (`REVIEW_MIN_WRITES` writes or more) is answered once with an invitation to re-read the order,
 * judge the map against its own words alone, and fix the one thing IT asked for that is weakest,
 * before the close stands. It is the delivery nudge's complement, and the two grounds are disjoint
 * at any one close: zero landed writes is delivery's, a landed build is this one's, and a couple of
 * aimed edits in between is neither's. Each fires at most once per job, so a job is answered at most
 * twice however it closes, and the close after a note is always final.
 */
describe('the review beat', () => {
  const BUILD_TOOLS = [
    ...PARENT_CONTROL_TOOLS,
    { name: 'paint_terrain', description: 'stand-in', parameters: {} },
  ];
  const writeExecutor = () => makeExecutor({ writeNames: new Set(['paint_terrain']) });
  /** The write batches below would otherwise spend a real construction beat between every landed
   *  write; what is under test here is the close, not the pace. */
  const instantSleep: NonNullable<LoopDeps['sleep']> = () => Promise.resolve();

  function systemNotes(log: SessionLog) {
    return eventsOf(log).filter((e) => e.kind === 'systemNote');
  }

  /** One batch of `n` landed writes, distinct args so no damper mistakes them for retries. */
  function writeBatch(n: number, idPrefix = 'w'): ScriptedTurn {
    return toolTurn(Array.from({ length: n }, (_, i) => ({
      callId: `${idPrefix}${i}`, name: 'paint_terrain', args: { x: i },
    })));
  }

  it('answers the first close of a landed build with the invitation, and the next close settles the job', async () => {
    const log = createLog(() => 0);
    seedOrder(log, 'build a hamlet at dusk');
    const adapter = createScriptedAdapter([
      writeBatch(REVIEW_MIN_WRITES),
      textTurn('The hamlet is built.'),
      toolTurn([{ callId: 'fix0', name: 'paint_terrain', args: { x: 99 } }]),
      textTurn('The arrival was the weakest part; the entry road now frames the square.'),
    ]);
    const deps = makeDeps({ adapter, executor: writeExecutor(), tools: BUILD_TOOLS, sleep: instantSleep });

    const outcome = await runJob(log, deps);

    expect(outcome).toBe('done');
    const notes = systemNotes(log);
    expect(notes).toHaveLength(1);
    expect(notes[0]?.kind === 'systemNote' && notes[0].note).toBe('review');
    expect(notes[0]?.kind === 'systemNote' && notes[0].text).toBe(reviewNudge());

    // The note reaches the model as the trailing user message of the next request.
    expect(adapter.requests).toHaveLength(4);
    const messages = adapter.requests[2]?.messages ?? [];
    expect(messages[messages.length - 1]).toEqual({ role: 'user', text: reviewNudge() });

    // The words that settle the job are the reviewed close's.
    const end = eventsOf(log)[eventsOf(log).length - 1];
    expect(end).toMatchObject({
      kind: 'jobEnd', outcome: 'done',
      summary: 'The arrival was the weakest part; the entry road now frames the square.',
    });
  });

  it('never fires on a zero-write close: that ground is the delivery nudge\'s', async () => {
    const log = createLog(() => 0);
    seedOrder(log, 'repair the storm damage');
    const adapter = createScriptedAdapter([textTurn('Done.'), textTurn('Nothing here was broken.')]);
    const deps = makeDeps({ adapter, executor: writeExecutor(), tools: BUILD_TOOLS, sleep: instantSleep });

    await runJob(log, deps);

    const notes = systemNotes(log);
    expect(notes).toHaveLength(1);
    expect(notes[0]?.kind === 'systemNote' && notes[0].note).toBe('delivery');
  });

  it('fires once per job: the close after it stands whatever it says, even unchanged', async () => {
    const log = createLog(() => 0);
    seedOrder(log, 'build a hamlet');
    const adapter = createScriptedAdapter([
      writeBatch(REVIEW_MIN_WRITES),
      textTurn('Built.'),
      textTurn('Built.'),
    ]);
    const deps = makeDeps({ adapter, executor: writeExecutor(), tools: BUILD_TOOLS, sleep: instantSleep });

    const outcome = await runJob(log, deps);

    expect(outcome).toBe('done');
    expect(systemNotes(log)).toHaveLength(1);
    expect(adapter.requests).toHaveLength(3);
    expect(eventsOf(log)[eventsOf(log).length - 1]).toMatchObject({ kind: 'jobEnd', outcome: 'done', summary: 'Built.' });
  });

  it('a small build closes clean: fewer landed writes than the threshold earn no beat', async () => {
    const log = createLog(() => 0);
    seedOrder(log, 'move the bench');
    const adapter = createScriptedAdapter([
      writeBatch(REVIEW_MIN_WRITES - 1),
      textTurn('The bench sits by the pond now.'),
    ]);
    const deps = makeDeps({ adapter, executor: writeExecutor(), tools: BUILD_TOOLS, sleep: instantSleep });

    const outcome = await runJob(log, deps);

    expect(outcome).toBe('done');
    expect(systemNotes(log)).toHaveLength(0);
    expect(adapter.requests).toHaveLength(2);
  });

  it('an errored or reverted write is not a landed one', async () => {
    const log = createLog(() => 0);
    seedOrder(log, 'terrace the slope');
    const adapter = createScriptedAdapter([
      writeBatch(REVIEW_MIN_WRITES + 1),
      textTurn('One terrace held.'),
      textTurn('The slope only carries one step; the rest reverted.'),
    ]);
    const results: Record<string, ExecutedResult> = {
      w0: { content: 'ok', isError: false },
      w1: { content: 'no ground', isError: true },
      w2: { content: 'REVERTED: floats', isError: false, detail: { reverted: true } },
      w3: { content: 'no ground', isError: true },
    };
    const executor = makeExecutor({
      writeNames: new Set(['paint_terrain']),
      result: (call) => results[call.callId] ?? { content: 'ok', isError: false },
    });
    const deps = makeDeps({ adapter, executor, tools: BUILD_TOOLS, sleep: instantSleep });

    await runJob(log, deps);

    // One write landed: under the threshold, and not zero either, so neither note fires.
    expect(systemNotes(log)).toHaveLength(0);
  });

  it('composes with the delivery nudge: two different debts, each answered once, then the job settles', async () => {
    const log = createLog(() => 0);
    seedOrder(log, 'bridge the river');
    const adapter = createScriptedAdapter([
      textTurn('The bridge is in place.'),
      writeBatch(REVIEW_MIN_WRITES),
      textTurn('Carved the channel and bridged it.'),
      textTurn('The far bank was the weakest side; it has its own landing now.'),
    ]);
    const deps = makeDeps({ adapter, executor: writeExecutor(), tools: BUILD_TOOLS, sleep: instantSleep });

    const outcome = await runJob(log, deps);

    expect(outcome).toBe('done');
    const notes = systemNotes(log).map((e) => e.kind === 'systemNote' && e.note);
    expect(notes).toEqual(['delivery', 'review']);
    expect(adapter.requests).toHaveLength(4);
    expect(eventsOf(log)[eventsOf(log).length - 1]).toMatchObject({
      kind: 'jobEnd', outcome: 'done',
      summary: 'The far bank was the weakest side; it has its own landing now.',
    });
  });

  /** A review pass needs room: a look, the fixes (whose calls never run on the final turn), a
   *  refusal answered, and a close that can still settle done. Inside that window the beat would
   *  only convert a done into a capped re-summary, so the close stands. The two scripts below close
   *  on their second turn, so `2 + REVIEW_MIN_TURNS_LEFT` turns is the least cap the beat fits under. */
  it('leaves the cap window alone: a close with too few turns left settles instead of spending them', async () => {
    const log = createLog(() => 0);
    seedOrder(log, 'build a hamlet');
    const adapter = createScriptedAdapter([
      writeBatch(REVIEW_MIN_WRITES),
      textTurn('Built with no room to spare.'),
    ]);
    const deps = makeDeps({ adapter, executor: writeExecutor(), tools: BUILD_TOOLS, sleep: instantSleep, maxTurns: 2 + REVIEW_MIN_TURNS_LEFT - 1 });

    const outcome = await runJob(log, deps);

    expect(outcome).toBe('done');
    expect(systemNotes(log)).toHaveLength(0);
    expect(adapter.requests).toHaveLength(2);
  });

  it('fires at exactly the last close the whole pass still fits after', async () => {
    const log = createLog(() => 0);
    seedOrder(log, 'build a hamlet');
    const adapter = createScriptedAdapter([
      writeBatch(REVIEW_MIN_WRITES),
      textTurn('Built.'),
      toolTurn([{ callId: 'fix0', name: 'paint_terrain', args: { x: 99 } }]),
      textTurn('Weakest thing fixed; closing.'),
    ]);
    const deps = makeDeps({ adapter, executor: writeExecutor(), tools: BUILD_TOOLS, sleep: instantSleep, maxTurns: 2 + REVIEW_MIN_TURNS_LEFT });

    const outcome = await runJob(log, deps);

    expect(outcome).toBe('done');
    expect(systemNotes(log)).toHaveLength(1);
    expect(eventsOf(log)[eventsOf(log).length - 1]).toMatchObject({
      kind: 'jobEnd', outcome: 'done', summary: 'Weakest thing fixed; closing.',
    });
  });

  it('a close that ends by asking the user something is waiting on them, not reviewed', async () => {
    const log = createLog(() => 0);
    seedOrder(log, 'build a hamlet');
    const adapter = createScriptedAdapter([
      writeBatch(REVIEW_MIN_WRITES),
      textTurn('The hamlet stands. Shall I add the orchard?'),
    ]);
    const deps = makeDeps({ adapter, executor: writeExecutor(), tools: BUILD_TOOLS, sleep: instantSleep });

    await runJob(log, deps);

    expect(systemNotes(log)).toHaveLength(0);
    expect(eventsOf(log)[eventsOf(log).length - 1]).toMatchObject({ kind: 'jobEnd', question: true });
  });

  it('a job whose advertised tools include no write verb is never invited to review', async () => {
    const log = createLog(() => 0);
    seedOrder(log, 'lay out three plots');
    const adapter = createScriptedAdapter([
      writeBatch(REVIEW_MIN_WRITES),
      textTurn('Three plots laid.'),
    ]);
    const deps = makeDeps({ adapter, executor: writeExecutor(), sleep: instantSleep }); // default tools: no write among them

    await runJob(log, deps);

    expect(systemNotes(log)).toHaveLength(0);
    expect(adapter.requests).toHaveLength(2);
  });

  it('a suggest_reply-only close of a landed build is reviewed like a bare one', async () => {
    const log = createLog(() => 0);
    seedOrder(log, 'build a hamlet');
    const adapter = createScriptedAdapter([
      writeBatch(REVIEW_MIN_WRITES),
      sayingToolTurn('The hamlet stands.', [{ callId: 'sr1', name: 'suggest_reply', args: { reply: 'Thanks' } }]),
      textTurn('Looked it over; the square reads as the center now.'),
    ]);
    const deps = makeDeps({ adapter, executor: writeExecutor(), tools: BUILD_TOOLS, sleep: instantSleep });

    await runJob(log, deps);

    const notes = systemNotes(log);
    expect(notes).toHaveLength(1);
    expect(notes[0]?.kind === 'systemNote' && notes[0].note).toBe('review');
  });

  it('the beat is scoped per job: a fresh order\'s own landed build earns its own', async () => {
    const log = createLog(() => 0);
    seedOrder(log, 'build a hamlet');
    const first = makeDeps({
      adapter: createScriptedAdapter([writeBatch(REVIEW_MIN_WRITES), textTurn('Built.'), textTurn('Reviewed and closed.')]),
      executor: writeExecutor(), tools: BUILD_TOOLS, sleep: instantSleep,
    });
    expect(await runJob(log, first)).toBe('done');

    seedOrder(log, 'build a mill');
    const second = makeDeps({
      adapter: createScriptedAdapter([writeBatch(REVIEW_MIN_WRITES, 'm'), textTurn('Milled.'), textTurn('Reviewed and closed.')]),
      executor: writeExecutor(), tools: BUILD_TOOLS, sleep: instantSleep,
    });
    expect(await runJob(log, second)).toBe('done');

    const notes = systemNotes(log).map((e) => e.kind === 'systemNote' && e.note);
    expect(notes).toEqual(['review', 'review']);
  });
});
