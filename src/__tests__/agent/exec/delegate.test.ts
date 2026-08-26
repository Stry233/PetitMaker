import { describe, it, expect } from 'vitest';
import { CommandExecutor } from '../../../core/commands/command-executor';
import { EventBus } from '../../../core/commands/event-bus';
import { createDefaultRegistry } from '../../../rules';
import type { EditorEvents } from '../../../core/model/types';
import { makeState } from '../../rules/_helpers';
import { roadLookup } from '../../../state/object-index';
import type { AgentToolDeps } from '../../../agent/tools/tools';
import { createExecutor, wireSchemas, type DelegateOpts } from '../../../agent/exec/executor';
import { createScriptedAdapter, type ScriptedTurn } from '../../../agent/eval/scripted-adapter';
import { append, createLog, eventsOf } from '../../../agent/core/log';
import type { SessionLog } from '../../../agent/core/log';
import { answerGate, type Oversight } from '../../../agent/core/gates';
import { runJob, type LoopDeps } from '../../../agent/core/loop';
import type { SessionEvent } from '../../../agent/core/types';

/** Drains the microtask queue: every scripted turn here resolves through promise chains alone
 *  (no real timers), so a fixed, generous number of `await`s is enough to run a child job up to
 *  its next genuinely blocking wait (an open gate). Mirrors runner.test.ts's own helper. */
async function flush(): Promise<void> {
  for (let i = 0; i < 50; i++) await Promise.resolve();
}

function textTurn(text: string): ScriptedTurn {
  return { events: [{ t: 'text', delta: text }, { t: 'done', stop: 'stop' }] };
}
function toolTurn(calls: { callId: string; name: string; args?: Record<string, unknown> }[]): ScriptedTurn {
  return {
    events: [{
      t: 'done', stop: 'tool-calls',
      final: calls.map((c) => ({ callId: c.callId, name: c.name, args: c.args, rawArgs: JSON.stringify(c.args ?? {}) })),
    }],
  };
}

function setup(w = 20, h = 20) {
  const state = makeState(w, h);
  const bus = new EventBus<EditorEvents>();
  const exec = new CommandExecutor(state, bus, createDefaultRegistry(), roadLookup(state));
  const deps: AgentToolDeps = { getState: () => state, getExecutor: () => exec, getRegion: () => [] };
  return { state, exec, deps };
}

/** A `DelegateOpts` wired to a fresh parent log + a supplied scripted child adapter. */
function makeDelegate(
  turns: ScriptedTurn[], opts: { oversight?: Oversight; parentLog?: SessionLog; signal?: AbortSignal } = {},
): DelegateOpts & { adapter: ReturnType<typeof createScriptedAdapter> } {
  const adapter = createScriptedAdapter(turns);
  return {
    adapter,
    model: 'scripted-model',
    system: 'you are a helper',
    oversight: opts.oversight ?? 'yolo',
    signal: opts.signal ?? new AbortController().signal,
    log: opts.parentLog ?? createLog(),
  };
}

/** A PARENT job's `LoopDeps`, wired to the real executor (so `delegate_task` reaches the scripted
 *  child adapter through `opts.delegate`, exactly as the runner wires it live). */
function parentDeps(
  deps: AgentToolDeps, parentTurns: ScriptedTurn[], delegate: DelegateOpts,
): LoopDeps & { adapter: ReturnType<typeof createScriptedAdapter> } {
  const adapter = createScriptedAdapter(parentTurns);
  return {
    adapter,
    model: 'scripted-model',
    system: 'you are the lead',
    tools: wireSchemas(),
    executor: createExecutor(deps, { delegate }),
    oversight: 'yolo',
    sameModel: true,
    budgetTokens: 100_000,
    signal: new AbortController().signal,
    undoStackSize: () => deps.getExecutor().getUndoStackSize(),
  };
}

describe('exec/executor: delegate_task', () => {
  it('runs a child job and returns its final text', async () => {
    const { deps } = setup();
    // The first close claims a build it never made, so the child's own delivery nudge answers it
    // once; the close after that is the final text the parent receives.
    const delegate = makeDelegate([
      textTurn('Task complete: built a small house.'),
      textTurn('Nothing was built: the plot at (2,2) already carries a house.'),
    ]);
    const executor = createExecutor(deps, { delegate });

    const r = await executor.execute({ callId: 'd1', name: 'delegate_task', args: { task: 'build a small house at (2,2)' } });

    expect(r.isError).toBe(false);
    expect(r.content).toBe('Nothing was built: the plot at (2,2) already carries a house.');
    expect(delegate.adapter.requests).toHaveLength(2);
    // The child sees a fresh order carrying the map context, never the parent's own conversation.
    const req = delegate.adapter.requests[0];
    expect(JSON.stringify(req?.messages)).toContain('build a small house at (2,2)');
  });

  it("the child's write lands ONE undo step on the shared executor, and detail sums its counts", async () => {
    const { exec, deps } = setup();
    const before = exec.getUndoStackSize();
    const delegate = makeDelegate([
      toolTurn([{ callId: 'c1', name: 'paint_terrain', args: { rect: { x1: 2, y1: 2, x2: 4, y2: 4 }, terrain: 'mountain', elevation: 1 } }]),
      textTurn('Painted the hill.'),
    ]);
    const executor = createExecutor(deps, { delegate });

    const r = await executor.execute({ callId: 'd2', name: 'delegate_task', args: { task: 'raise a hill' } });

    expect(r.isError).toBe(false);
    expect(r.content).toBe('Painted the hill.');
    expect(exec.getUndoStackSize()).toBe(before + 1); // one stroke group, on the SAME executor
    expect(r.detail?.cells).toBeGreaterThan(0);
  });

  it('caps depth at 1: a scripted child calling delegate_task itself gets the unknown-tool error', async () => {
    const { deps } = setup();
    // A zero-write close after the refusal earns the child's delivery nudge; the close after it is
    // the report the parent receives.
    const delegate = makeDelegate([
      toolTurn([{ callId: 'c1', name: 'delegate_task', args: { task: 'nested' } }]),
      textTurn('Nested delegation was refused; reporting back.'),
      textTurn('Nothing could be delegated from here, so nothing was built.'),
    ]);
    const executor = createExecutor(deps, { delegate });

    const r = await executor.execute({ callId: 'd3', name: 'delegate_task', args: { task: 'try to nest a delegate' } });

    expect(r.isError).toBe(false);
    expect(r.content).toBe('Nothing could be delegated from here, so nothing was built.');
    expect(delegate.adapter.requests).toHaveLength(3); // the child continued past the erroring call
    expect(JSON.stringify(delegate.adapter.requests[1]?.messages)).toContain('Unknown tool');
  });

  it("a parent-strict oversight gates the child's write through the mirrored parent gate", async () => {
    const { exec, deps } = setup();
    const before = exec.getUndoStackSize();
    const parentLog = createLog();
    const delegate = makeDelegate(
      [
        toolTurn([{ callId: 'c1', name: 'paint_terrain', args: { rect: { x1: 2, y1: 2, x2: 3, y2: 3 }, terrain: 'mountain', elevation: 1 } }]),
        textTurn('Painted after approval.'),
      ],
      { oversight: 'strict', parentLog },
    );
    const executor = createExecutor(deps, { delegate });

    const resultPromise = executor.execute({ callId: 'd4', name: 'delegate_task', args: { task: 'raise a small hill' } });
    await flush();

    // The child's own gate asks land on a log the caller never sees directly; only the mirrored
    // copy on the PARENT log is what a human (or this test) can answer.
    const mirrored = eventsOf(parentLog).find(
      (e): e is Extract<SessionEvent, { kind: 'gateAsked' }> => e.kind === 'gateAsked',
    );
    expect(mirrored).toBeDefined();
    expect(mirrored?.summary).toContain('paint_terrain');
    expect(exec.getUndoStackSize()).toBe(before); // nothing has run yet: still waiting on the gate

    answerGate(parentLog, mirrored!.gateId, 'allow');
    await flush();

    const r = await resultPromise;
    expect(r.isError).toBe(false);
    expect(r.content).toBe('Painted after approval.');
    expect(exec.getUndoStackSize()).toBe(before + 1);
  });

  it('aborting the parent signal mid-child ends the child aborted and the delegate result reflects it', async () => {
    const { deps } = setup();
    const controller = new AbortController();
    const turns: ScriptedTurn[] = [
      // Aborts the SAME signal the child adapter streams under, synchronously before it ever
      // yields an event: the scripted adapter's own abort check then turns this into a
      // `stop: 'aborted'` turn, exactly what a real cancellation mid-stream looks like.
      () => { controller.abort(); return [{ t: 'text', delta: 'never seen' }, { t: 'done', stop: 'stop' }]; },
    ];
    const delegate = makeDelegate(turns, { signal: controller.signal });
    const executor = createExecutor(deps, { delegate });

    const r = await executor.execute({ callId: 'd5', name: 'delegate_task', args: { task: 'anything' } });

    expect(r.isError).toBe(true);
    expect(r.content).toContain('aborted');
  });

  it('an empty task string is refused before any child job runs', async () => {
    const { deps } = setup();
    const delegate = makeDelegate([textTurn('unused')]);
    const executor = createExecutor(deps, { delegate });

    const r = await executor.execute({ callId: 'd6', name: 'delegate_task', args: { task: '   ' } });

    expect(r.isError).toBe(true);
    expect(delegate.adapter.requests).toHaveLength(0);
  });

  it("detail.childOps records the child's ops in order, with a loaded playbook's identity", async () => {
    const { deps } = setup();
    const delegate = makeDelegate([
      toolTurn([
        { callId: 'c1', name: 'load_skill', args: { name: 'site-analysis' } },
        { callId: 'c2', name: 'load_skill', args: { name: 'no-such-skill' } },
        { callId: 'c3', name: 'paint_terrain', args: { rect: { x1: 2, y1: 2, x2: 4, y2: 4 }, terrain: 'mountain', elevation: 1 } },
      ]),
      textTurn('Read the site, then raised the hill.'),
    ]);
    const executor = createExecutor(deps, { delegate });

    const r = await executor.execute({ callId: 'd8', name: 'delegate_task', args: { task: 'raise a hill by the book' } });

    expect(r.isError).toBe(false);
    // The child's own log dies with the call; this list is the whole surviving record of its work.
    expect(r.detail?.childOps).toEqual([
      { name: 'load_skill', status: 'ok', skill: { name: 'site-analysis', kind: 'method', title: 'Site Analysis' } },
      { name: 'load_skill', status: 'error' },
      { name: 'paint_terrain', status: 'ok' },
    ]);
    expect(r.detail?.cells).toBeGreaterThan(0);
    expect(r.detail?.childError).toBeUndefined();
  });

  it("a child that ends in an incident keeps the error's class and names it, and its ops still stand", async () => {
    const { deps } = setup();
    const delegate = makeDelegate([
      toolTurn([{ callId: 'c1', name: 'paint_terrain', args: { rect: { x1: 2, y1: 2, x2: 3, y2: 3 }, terrain: 'mountain', elevation: 1 } }]),
      { error: { cls: 'auth', detail: 'The API key was rejected.\nCheck the key in settings.' } },
    ]);
    const executor = createExecutor(deps, { delegate });

    const r = await executor.execute({ callId: 'd9', name: 'delegate_task', args: { task: 'raise a hill' } });

    expect(r.isError).toBe(true);
    expect(r.content).toBe(
      '(system) The helper run failed (auth): The API key was rejected. Delegate a fresh task or ask the user.',
    );
    expect(r.detail?.childError).toBe('auth');
    // The edits the child made before the incident are on the map, so the record keeps them.
    expect(r.detail?.childOps).toEqual([{ name: 'paint_terrain', status: 'ok' }]);
    expect(r.detail?.cells).toBeGreaterThan(0);
  });

  it('onChildProgress reports rising op counts as the child works, and always clears on exit, even after an incident', async () => {
    const { deps } = setup();
    const calls: ({ task: string; opName?: string; ops: number } | null)[] = [];
    const delegate = makeDelegate([
      toolTurn([{ callId: 'c1', name: 'paint_terrain', args: { rect: { x1: 2, y1: 2, x2: 3, y2: 3 }, terrain: 'mountain', elevation: 1 } }]),
      toolTurn([{ callId: 'c2', name: 'inspect_region', args: { x1: 0, y1: 0, x2: 1, y2: 1 } }]),
      { error: { cls: 'auth', detail: 'boom' } },
    ]);
    delegate.onChildProgress = (p) => calls.push(p);
    const executor = createExecutor(deps, { delegate });

    const r = await executor.execute({ callId: 'd12', name: 'delegate_task', args: { task: 'raise a hill and look around' } });

    expect(r.isError).toBe(true);
    const withCounts = calls.filter((c): c is { task: string; opName?: string; ops: number } => c !== null);
    expect(withCounts.map((c) => c.ops)).toEqual(expect.arrayContaining([0, 1, 2]));
    expect(withCounts.every((c) => c.task === 'raise a hill and look around')).toBe(true);
    expect(withCounts.find((c) => c.ops === 1)?.opName).toBe('paint_terrain');
    expect(withCounts.find((c) => c.ops === 2)?.opName).toBe('inspect_region');
    // The `finally` clears the lane whatever way the child ends, including an incident.
    expect(calls[calls.length - 1]).toBeNull();
  });

  /** `label` is the schema's short name for the panel; when the model supplies one it rides beside
   *  `task` on every progress report unchanged (the lane picks between them, not the executor —
   *  `task` still carries the full self-contained instructions a resumed/replayed job would want). */
  it('carries an optional label through onChildProgress unchanged, task included in full', async () => {
    const { deps } = setup();
    const calls: ({ task: string; opName?: string; ops: number; label?: string } | null)[] = [];
    const delegate = makeDelegate([toolTurn([{ callId: 'c1', name: 'inspect_region', args: { x1: 0, y1: 0, x2: 1, y2: 1 } }]), textTurn('done')]);
    delegate.onChildProgress = (p) => calls.push(p);
    const executor = createExecutor(deps, { delegate });

    await executor.execute({
      callId: 'd13', name: 'delegate_task',
      args: { task: 'plant an oak grove north of the lake at (10,10)-(40,40)', label: 'north grove' },
    });

    const withCounts = calls.filter((c): c is { task: string; opName?: string; ops: number; label?: string } => c !== null);
    expect(withCounts.length).toBeGreaterThan(0);
    expect(withCounts.every((c) => c.label === 'north grove')).toBe(true);
    expect(withCounts.every((c) => c.task === 'plant an oak grove north of the lake at (10,10)-(40,40)')).toBe(true);
  });

  /** No label at all: the field is simply absent, not an empty string forced onto every report. */
  it('omits label from onChildProgress when the model gave none', async () => {
    const { deps } = setup();
    const calls: ({ task: string; opName?: string; ops: number; label?: string } | null)[] = [];
    const delegate = makeDelegate([textTurn('done')]);
    delegate.onChildProgress = (p) => calls.push(p);
    const executor = createExecutor(deps, { delegate });

    await executor.execute({ callId: 'd14', name: 'delegate_task', args: { task: 'raise a hill' } });

    const withCounts = calls.filter((c): c is { task: string; opName?: string; ops: number; label?: string } => c !== null);
    expect(withCounts.length).toBeGreaterThan(0);
    expect(withCounts.every((c) => c.label === undefined)).toBe(true);
  });

  it('a delegate_task left unresolved by a reload is never re-executed: the resume synthesizes a refusal', async () => {
    const { deps } = setup();
    const parentLog = createLog();
    const delegate = makeDelegate([textTurn('the child must never run')], { parentLog });
    const loopDeps = parentDeps(deps, [textTurn('Understood; I will look at the map first.')], delegate);

    append(parentLog, { kind: 'order', text: 'build a village', mapContext: '' });
    append(parentLog, {
      kind: 'assistant', stop: 'tool-calls',
      parts: [{ kind: 'tool', callId: 'd10', name: 'delegate_task', input: { task: 'build the village' }, argsDone: true }],
    });
    append(parentLog, { kind: 'paused' });
    append(parentLog, { kind: 'resumed' });

    const outcome = await runJob(parentLog, loopDeps);

    expect(outcome).toBe('done');
    expect(delegate.adapter.requests).toHaveLength(0); // the child never ran a second time
    const result = eventsOf(parentLog).find(
      (e): e is Extract<SessionEvent, { kind: 'toolResult' }> => e.kind === 'toolResult' && e.callId === 'd10',
    );
    expect(result?.isError).toBe(true);
    expect(result?.content).toBe(
      '(system) The helper run was interrupted by a reload. Edits it already made are on the map; '
      + 'look at the map, then delegate a fresh task for what remains.',
    );
    // A call that will never run is never put in front of the user for approval either.
    expect(eventsOf(parentLog).some((e) => e.kind === 'gateAsked')).toBe(false);
  });

  it('the reload guard is resume-only: a first-run delegate_task executes as normal', async () => {
    const { deps } = setup();
    const parentLog = createLog();
    // The child's zero-write close is nudged once; the second close is its report.
    const delegate = makeDelegate([
      textTurn('Helper report: the village is in.'),
      textTurn('Helper report: the village already stood; nothing needed building.'),
    ], { parentLog });
    const loopDeps = parentDeps(deps, [
      toolTurn([{ callId: 'd11', name: 'delegate_task', args: { task: 'build the village' } }]),
      textTurn('The helper is done.'),
    ], delegate);
    append(parentLog, { kind: 'order', text: 'build a village', mapContext: '' });

    const outcome = await runJob(parentLog, loopDeps);

    expect(outcome).toBe('done');
    expect(delegate.adapter.requests).toHaveLength(2);
    const result = eventsOf(parentLog).find(
      (e): e is Extract<SessionEvent, { kind: 'toolResult' }> => e.kind === 'toolResult' && e.callId === 'd11',
    );
    expect(result?.isError).toBe(false);
    expect(result?.content).toBe('Helper report: the village already stood; nothing needed building.');
  });

  it('with no opts.delegate, delegate_task still reports itself unwired (pre-T4 behavior preserved)', async () => {
    const { deps } = setup();
    const executor = createExecutor(deps);
    const r = await executor.execute({ callId: 'd7', name: 'delegate_task', args: { task: 'x' } });
    expect(r.isError).toBe(true);
    expect(r.content).toBe('Delegation is not wired yet.');
  });
});
