import { describe, it, expect } from 'vitest';
import { EventBus } from '../../../core/commands/event-bus';
import { createDefaultRegistry } from '../../../rules';
import type { EditorEvents } from '../../../state/editing/events';
import { makeState } from '../../_support/map-state';
import type { AgentToolDeps } from '../../../agent/tools';
import { createExecutor, type DelegateOpts } from '../../../agent/exec/executor';
import { wireSchemas } from '../../../agent/tools';
import { createScriptedAdapter, type ScriptedTurn } from '../../_support/agent/scripted-adapter';
import { append, createLog, eventsOf } from '../../../agent/core/log';
import type { SessionLog } from '../../../agent/core/log';
import { answerGate, type Oversight } from '../../../agent/core/gates';
import { runJob, type LoopDeps } from '../../../agent/core/loop';
import { COMPACTION_RESERVE } from '../../../agent/core/compaction';
import { retainedWrite } from '../../../agent/core/tool-result';
import { SUBAGENT_MAX_TURNS } from '../../../agent/core/governor';
import { helperInterrupted, helperResult, type HelperReport } from '../../../agent/core/nudges';
import { executeToolCall } from '../../../agent/tools';
import type { SessionEvent } from '../../../agent/core/types';
import { createExecutor as createCommandExecutor } from '../../../state/executor';

/** Drains the microtask queue: scripted turns resolve through promise chains alone (no timers), so
 *  fifty `await`s run a child job up to its next blocking wait (an open gate). */
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

function setup(region: { x: number; y: number }[] = []) {
  const state = makeState(20, 20);
  const bus = new EventBus<EditorEvents>();
  const exec = createCommandExecutor(state, createDefaultRegistry(), bus);
  const deps: AgentToolDeps = { getState: () => state, getExecutor: () => exec, getRegion: () => region };
  return { state, exec, deps };
}

/** A minimal valid brief over the whole test map, with any field replaced. */
function brief(over: Record<string, unknown> = {}): Record<string, unknown> {
  return { label: 'hill', x1: 0, y1: 0, x2: 19, y2: 19, goal: 'raise a hill', ...over };
}

const WHOLE = { x1: 0, y1: 0, x2: 19, y2: 19 };

/** The result text of a helper whose run the harness measured as `fields`. */
function resultOf(fields: Partial<HelperReport> & Pick<HelperReport, 'status' | 'report'>): string {
  return helperResult({ label: 'hill', bounds: WHOLE, landed: 0, refused: 0, objects: 0, terrain: 0, ...fields });
}

/** A helper raising the ground under a rectangle one level, as a drawing. */
const paint = (callId: string, x1: number, y1: number, x2: number, y2: number) =>
  ({ callId, name: 'draw_area', args: { x: x1, y: y1, reads_as: 'a hill', rows: Array.from({ length: y2 - y1 + 1 }, () => '1'.repeat(x2 - x1 + 1)) } });

const mountainAt = (state: ReturnType<typeof makeState>, x: number, y: number): boolean => state.cells[y]![x]!.terrain !== null;

/** How many cells inside `b` rest on terrain, wholly or in part: a cell rests on the ground from its own index to the next. */
function terrainIn(state: ReturnType<typeof makeState>, b: { x1: number; y1: number; x2: number; y2: number }): number {
  const raised = (x: number, y: number): boolean => Boolean(state.cells[y]?.[x]?.terrain);
  let n = 0;
  for (let y = b.y1; y <= b.y2; y++) for (let x = b.x1; x <= b.x2; x++) {
    if (raised(x, y) || raised(x + 1, y) || raised(x, y + 1) || raised(x + 1, y + 1)) n++;
  }
  return n;
}

/** A `DelegateOpts` wired to a fresh parent log + a supplied scripted child adapter. */
function makeDelegate(
  turns: ScriptedTurn[],
  opts: { oversight?: Oversight; parentLog?: SessionLog; signal?: AbortSignal; capabilities?: DelegateOpts['capabilities'] } = {},
): DelegateOpts & { adapter: ReturnType<typeof createScriptedAdapter> } {
  const adapter = createScriptedAdapter(turns);
  return {
    adapter,
    model: 'scripted-model',
    ...(opts.capabilities ? { capabilities: opts.capabilities } : {}),
    system: 'you are a helper',
    oversight: opts.oversight ?? 'yolo',
    signal: opts.signal ?? new AbortController().signal,
    log: opts.parentLog ?? createLog(),
  };
}

/** A parent job's `LoopDeps` on the real executor, so `delegate_task` reaches the scripted child
 *  adapter through `opts.delegate` as the runner wires it live. */
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
    signal: new AbortController().signal,
    undoStackSize: () => deps.getExecutor().historyDepth(),
  };
}

describe('exec/executor: delegate_task', () => {
  it('runs a child job and returns its report inside the harness result', async () => {
    const { deps } = setup();
    // The first close claims a build it never made, so the child's own delivery nudge answers it
    // once; the close after that is the report the parent receives.
    const delegate = makeDelegate([
      textTurn('Task complete: built a small house.'),
      textTurn('Nothing was built: the plot at (2,2) already carries a house.'),
    ]);
    const executor = createExecutor(deps, { delegate });

    const r = await executor.execute({ callId: 'd1', name: 'delegate_task', args: brief({ goal: 'build a small house at (2,2)' }) });

    expect(r.isError).toBe(false);
    expect(r.content).toBe(resultOf({ status: 'done', report: 'Nothing was built: the plot at (2,2) already carries a house.' }));
    expect(delegate.adapter.requests).toHaveLength(2);
    // The child sees a fresh order carrying the map context, never the parent's own conversation.
    const req = delegate.adapter.requests[0];
    expect(JSON.stringify(req?.messages)).toContain('build a small house at (2,2)');
  });

  it("the helper's order carries every field of the brief", async () => {
    const { deps } = setup();
    const delegate = makeDelegate([textTurn('Nothing to do.'), textTurn('Nothing to do.')]);
    const executor = createExecutor(deps, { delegate });

    await executor.execute({
      callId: 'd0', name: 'delegate_task',
      args: brief({
        label: 'north grove', x1: 3, y1: 4, x2: 9, y2: 12, goal: 'an oak grove around a clearing',
        include: ['six oaks', 'a bench'], preserve: ['the stone path'], interfaces: 'path enters at (3,8), ground level 1',
        skills: ['layout-patterns'], done: ['the clearing is reachable'],
      }),
    });

    const order = JSON.stringify(delegate.adapter.requests[0]?.messages);
    for (const said of [
      'north grove', '(3,4)-(9,12)', 'an oak grove around a clearing', 'six oaks', 'a bench', 'the stone path',
      'path enters at (3,8), ground level 1', 'layout-patterns', 'the clearing is reachable',
    ]) expect(order, said).toContain(said);
  });

  it('refuses a skill name no skill has, before any child job runs', async () => {
    const { deps } = setup();
    const delegate = makeDelegate([textTurn('unused')]);
    const r = await createExecutor(deps, { delegate }).execute({ callId: 'd0', name: 'delegate_task', args: brief({ skills: ['no-such-skill'] }) });
    expect(r.isError).toBe(true);
    expect(delegate.adapter.requests).toHaveLength(0);
  });

  it("budgets the child job against the model's own context window", async () => {
    const { deps } = setup();
    // A brief larger than the window's free space cannot be folded, so the child ends before any request.
    const delegate = makeDelegate([textTurn('Built it.')], { capabilities: { context: COMPACTION_RESERVE + 1_000 } });
    const executor = createExecutor(deps, { delegate });

    await executor.execute({ callId: 'd0', name: 'delegate_task', args: brief({ goal: 'Add a pond by the gate. '.repeat(400) }) });

    expect(delegate.adapter.requests).toHaveLength(0);
  });

  it("the child's write lands ONE undo step on the shared executor, and detail sums its counts", async () => {
    const { exec, deps } = setup();
    const before = exec.historyDepth();
    const delegate = makeDelegate([toolTurn([paint('c1', 2, 2, 4, 4)]), textTurn('Painted the hill.')]);
    const executor = createExecutor(deps, { delegate });

    const r = await executor.execute({ callId: 'd2', name: 'delegate_task', args: brief() });

    expect(r.isError).toBe(false);
    expect(exec.historyDepth()).toBe(before + 1); // one stroke group, on the same executor
    expect(r.detail?.cells).toBeGreaterThan(0);
  });

  it('[ASST-30] refuses a helper write outside its bounds and lands one inside', async () => {
    const { state, deps } = setup();
    const delegate = makeDelegate([
      toolTurn([paint('out', 10, 10, 11, 11)]),
      toolTurn([paint('in', 3, 3, 4, 4)]),
      textTurn('Built inside the bounds.'),
    ]);

    const r = await createExecutor(deps, { delegate }).execute({ callId: 'd', name: 'delegate_task', args: brief({ x1: 2, y1: 2, x2: 6, y2: 6 }) });

    expect(mountainAt(state, 10, 10)).toBe(false);
    expect(mountainAt(state, 3, 3)).toBe(true);
    expect(r.detail?.childOps).toEqual([
      { name: 'draw_area', status: 'error' },
      { name: 'draw_area', status: 'ok' },
    ]);
    // Its map context names the bounds as its selection.
    expect(JSON.stringify(delegate.adapter.requests[0]?.messages)).toContain('25 cells in bbox (2,2)-(6,6)');
  });

  it("[ASST-30] cuts the brief's rectangle to the region the user painted", async () => {
    const painted = Array.from({ length: 100 }, (_, i) => ({ x: i % 10, y: Math.floor(i / 10) }));
    const { state, deps } = setup(painted);
    const delegate = makeDelegate([
      toolTurn([paint('unpainted', 12, 12, 12, 12)]),
      toolTurn([paint('outside-brief', 2, 2, 2, 2)]),
      toolTurn([paint('in', 6, 6, 6, 6)]),
      textTurn('Built inside the painted region.'),
    ]);

    await createExecutor(deps, { delegate }).execute({ callId: 'd', name: 'delegate_task', args: brief({ x1: 5, y1: 5, x2: 15, y2: 15 }) });

    // (12,12) is inside the brief's rectangle and outside what the user painted.
    expect(mountainAt(state, 12, 12)).toBe(false);
    // (2,2) is painted by the user and outside the brief's rectangle.
    expect(mountainAt(state, 2, 2)).toBe(false);
    expect(mountainAt(state, 6, 6)).toBe(true);
    expect(JSON.stringify(delegate.adapter.requests[0]?.messages)).toContain('25 cells in bbox (5,5)-(9,9)');
  });

  it('[ASST-30] refuses bounds that miss the painted region or the map without a model request', async () => {
    const painted = Array.from({ length: 100 }, (_, i) => ({ x: i % 10, y: Math.floor(i / 10) }));
    for (const [region, args] of [
      [painted, brief({ x1: 12, y1: 12, x2: 15, y2: 15 })],
      [[], brief({ x1: 40, y1: 40, x2: 50, y2: 50 })],
    ] as const) {
      const { exec, deps } = setup([...region]);
      const delegate = makeDelegate([toolTurn([paint('c', 13, 13, 13, 13)]), textTurn('unused')]);
      const r = await createExecutor(deps, { delegate }).execute({ callId: 'd', name: 'delegate_task', args });
      expect(r.isError).toBe(true);
      expect(delegate.adapter.requests).toHaveLength(0);
      expect(exec.historyDepth()).toBe(0);
    }
  });

  it("[ASST-30] a helper cannot undo: neither the lead's work nor a step of its own", async () => {
    const { state, exec, deps } = setup();
    const lead = paint('lead', 2, 2, 2, 2);
    await executeToolCall({ id: lead.callId, name: lead.name, input: lead.args }, deps);
    const before = exec.historyDepth();
    const delegate = makeDelegate([
      toolTurn([{ callId: 'u1', name: 'undo', args: { steps: 5 } }]),
      toolTurn([paint('own', 8, 8, 8, 8)]),
      toolTurn([{ callId: 'u2', name: 'undo', args: { steps: 5 } }]),
      textTurn('Raised one cell.'),
      textTurn('Raised one cell.'),
    ]);

    await createExecutor(deps, { delegate }).execute({ callId: 'd', name: 'delegate_task', args: brief() });

    expect(mountainAt(state, 2, 2)).toBe(true);
    expect(mountainAt(state, 8, 8)).toBe(true);
    expect(exec.historyDepth()).toBe(before + 1);
  });

  it('a helper has no undo or redo: a step undone before it started stays undone, and its own step stands', async () => {
    const { state, exec, deps } = setup();
    for (const step of [paint('kept', 2, 2, 2, 2), paint('taken-back', 12, 12, 12, 12)]) {
      await executeToolCall({ id: step.callId, name: step.name, input: step.args }, deps);
    }
    exec.undoEdit();
    const delegate = makeDelegate([
      toolTurn([{ callId: 'r1', name: 'redo', args: { steps: 5 } }]),
      toolTurn([paint('own', 8, 8, 8, 8)]),
      toolTurn([{ callId: 'u1', name: 'undo', args: { steps: 1 } }]),
      toolTurn([{ callId: 'r2', name: 'redo', args: { steps: 5 } }]),
      textTurn('Built one hill.'),
      textTurn('Built one hill.'),
    ]);

    await createExecutor(deps, { delegate }).execute({ callId: 'd', name: 'delegate_task', args: brief() });

    expect(mountainAt(state, 12, 12)).toBe(false);
    expect(mountainAt(state, 8, 8)).toBe(true);
    expect(mountainAt(state, 2, 2)).toBe(true);
  });

  it('caps depth at 1: a scripted child calling delegate_task itself gets the unknown-tool error', async () => {
    const { deps } = setup();
    // A zero-write close after the refusal earns the child's delivery nudge; the close after it is
    // the report the parent receives.
    const delegate = makeDelegate([
      toolTurn([{ callId: 'c1', name: 'delegate_task', args: brief({ label: 'nested' }) }]),
      textTurn('Nested delegation was refused; reporting back.'),
      textTurn('Nothing could be delegated from here, so nothing was built.'),
    ]);
    const executor = createExecutor(deps, { delegate });

    const r = await executor.execute({ callId: 'd3', name: 'delegate_task', args: brief() });

    expect(r.isError).toBe(false);
    // The refused nested call is a write call that did not land.
    expect(r.content).toBe(resultOf({ status: 'partial', refused: 1, report: 'Nothing could be delegated from here, so nothing was built.' }));
    expect(delegate.adapter.requests).toHaveLength(3); // the child continued past the erroring call
    expect(JSON.stringify(delegate.adapter.requests[1]?.messages)).toContain('Unknown tool');
  });

  it("a parent-strict oversight gates the child's write through the mirrored parent gate", async () => {
    const { exec, deps } = setup();
    const before = exec.historyDepth();
    const parentLog = createLog();
    const delegate = makeDelegate(
      [toolTurn([paint('c1', 2, 2, 3, 3)]), textTurn('Painted after approval.')],
      { oversight: 'strict', parentLog },
    );
    const executor = createExecutor(deps, { delegate });

    const resultPromise = executor.execute({ callId: 'd4', name: 'delegate_task', args: brief() });
    await flush();

    // The child's gate asks land on a log nobody sees; only the mirrored copy on the parent log can
    // be answered.
    const mirrored = eventsOf(parentLog).find(
      (e): e is Extract<SessionEvent, { kind: 'gateAsked' }> => e.kind === 'gateAsked',
    );
    expect(mirrored).toBeDefined();
    expect(mirrored?.summary).toContain('Drawing the place');
    expect(exec.historyDepth()).toBe(before); // nothing has run yet: still waiting on the gate

    answerGate(parentLog, mirrored!.gateId, 'allow');
    await flush();

    const r = await resultPromise;
    expect(r.isError).toBe(false);
    expect(exec.historyDepth()).toBe(before + 1);
  });

  it('aborting the parent signal mid-child ends the child and the result reads failed', async () => {
    const { deps } = setup();
    const controller = new AbortController();
    const turns: ScriptedTurn[] = [
      // Aborting before the first event makes the scripted adapter end the turn `stop: 'aborted'`,
      // as a real cancellation mid-stream does.
      () => { controller.abort(); return [{ t: 'text', delta: 'never seen' }, { t: 'done', stop: 'stop' }]; },
    ];
    const delegate = makeDelegate(turns, { signal: controller.signal });
    const executor = createExecutor(deps, { delegate });

    const r = await executor.execute({ callId: 'd5', name: 'delegate_task', args: brief() });

    expect(r.isError).toBe(true);
    expect(r.content.split('\n')).toContain('Status: failed');
  });

  it('a brief with neither goal nor label, or without bounds, is refused before any child job runs', async () => {
    const { deps } = setup();
    const delegate = makeDelegate([textTurn('unused')]);
    const executor = createExecutor(deps, { delegate });
    const { x1: _x1, ...noCorner } = brief();

    for (const args of [brief({ goal: '   ', label: '' }), noCorner, { task: 'raise a hill' }]) {
      const r = await executor.execute({ callId: 'd6', name: 'delegate_task', args });
      expect(r.isError).toBe(true);
    }
    expect(delegate.adapter.requests).toHaveLength(0);
  });

  it('a brief over an area larger than a district is refused before any child job runs', async () => {
    const state = makeState(120, 60);
    const exec = createCommandExecutor(state, createDefaultRegistry(), new EventBus<EditorEvents>());
    const deps: AgentToolDeps = { getState: () => state, getExecutor: () => exec, getRegion: () => [] };
    const delegate = makeDelegate([textTurn('unused')]);
    const r = await createExecutor(deps, { delegate }).execute({ callId: 'd8', name: 'delegate_task', args: brief({ x1: 4, y1: 4, x2: 94, y2: 30 }) });
    expect(r.isError).toBe(true);
    expect(r.content).toContain('91 by 27');
    expect(delegate.adapter.requests).toHaveLength(0);
  });

  it('a brief for an area larger than one place runs a district lead, who hands its places to helpers', async () => {
    const state = makeState(80, 60);
    const exec = createCommandExecutor(state, createDefaultRegistry(), new EventBus<EditorEvents>());
    const deps: AgentToolDeps = { getState: () => state, getExecutor: () => exec, getRegion: () => [] };
    // One script serves the district lead and its helper in the order they ask.
    const delegate = makeDelegate([
      toolTurn([{ callId: 'p1', name: 'delegate_task', args: brief({ label: 'court', x1: 10, y1: 10, x2: 30, y2: 30, goal: 'a raised court' }) }]),
      toolTurn([paint('h1', 12, 12, 14, 14)]),
      textTurn('The court is raised.'),
      textTurn('The district is built: one raised court.'),
      textTurn('The district is built: one raised court.'),
    ]);
    const r = await createExecutor(deps, { delegate }).execute({
      callId: 'd9', name: 'delegate_task', args: brief({ label: 'north', x1: 4, y1: 4, x2: 64, y2: 40, goal: 'a district of courts' }),
    });
    expect(r.isError, r.content).toBe(false);
    expect(mountainAt(state, 13, 13)).toBe(true);
    const asked = delegate.adapter.requests.map((req) => JSON.stringify(req.messages));
    expect(asked[0]).toContain('District brief: north');
    expect(delegate.adapter.requests[0]!.system).toContain('plan-on-map');
    expect(asked[1]).toContain('Helper brief: court');
    // The district lead is offered the lead's tools, its helper a place builder's.
    expect(delegate.adapter.requests[0]!.tools.map((t) => t.name)).toContain('delegate_task');
    expect(delegate.adapter.requests[1]!.tools.map((t) => t.name)).not.toContain('delegate_task');
  });

  it('a district lead hands out places only: its brief over a larger area is refused', async () => {
    const state = makeState(80, 60);
    const exec = createCommandExecutor(state, createDefaultRegistry(), new EventBus<EditorEvents>());
    const deps: AgentToolDeps = { getState: () => state, getExecutor: () => exec, getRegion: () => [] };
    const delegate = makeDelegate([
      toolTurn([{ callId: 'p1', name: 'delegate_task', args: brief({ label: 'half', x1: 4, y1: 4, x2: 60, y2: 30, goal: 'half the district' }) }]),
      textTurn('Could not hand that over.'),
      textTurn('Could not hand that over.'),
      textTurn('Could not hand that over.'),
    ]);
    await createExecutor(deps, { delegate }).execute({
      callId: 'd10', name: 'delegate_task', args: brief({ label: 'north', x1: 4, y1: 4, x2: 64, y2: 40, goal: 'a district of courts' }),
    });
    expect(JSON.stringify(delegate.adapter.requests[1]!.messages)).toContain('a helper builds one place of at most 1600 cells and 56 on a side');
  });

  it('a long narrow place within the cell limit goes to a helper, not to a district lead', async () => {
    const state = makeState(80, 60);
    const exec = createCommandExecutor(state, createDefaultRegistry(), new EventBus<EditorEvents>());
    const deps: AgentToolDeps = { getState: () => state, getExecutor: () => exec, getRegion: () => [] };
    const delegate = makeDelegate([textTurn('Nothing to do.'), textTurn('Nothing to do.')]);
    const r = await createExecutor(deps, { delegate }).execute({ callId: 'd12', name: 'delegate_task', args: brief({ label: 'strip', x1: 4, y1: 4, x2: 24, y2: 50 }) });
    expect(r.isError, r.content).toBe(false);
    expect(JSON.stringify(delegate.adapter.requests[0]!.messages)).toContain('Helper brief: strip');
  });

  it('a brief without a label is not named by a number or an abbreviation that opens its goal', async () => {
    const { deps } = setup();
    const delegate = makeDelegate([textTurn('Nothing to do.'), textTurn('Nothing to do.')]);
    const { label: _label, ...unnamed } = brief({ goal: '1. An oak grove around a clearing' });
    const r = await createExecutor(deps, { delegate }).execute({ callId: 'd11', name: 'delegate_task', args: unnamed });
    expect(r.content.split('\n')[0]).toBe('Helper result: 1. An oak grove around a');
  });

  it('a brief without a label is named by the opening of its goal', async () => {
    const { deps } = setup();
    const delegate = makeDelegate([textTurn('Nothing to do.'), textTurn('Nothing to do.')]);
    const { label: _label, ...unnamed } = brief({ goal: 'An oak grove, around a clearing.' });
    const r = await createExecutor(deps, { delegate }).execute({ callId: 'd7', name: 'delegate_task', args: unnamed });
    expect(r.isError).toBe(false);
    expect(r.content).toContain('Helper result: An oak grove');
  });

  it("detail.childOps records the child's ops in order, with a loaded playbook's identity", async () => {
    const { deps } = setup();
    const delegate = makeDelegate([
      toolTurn([
        { callId: 'c1', name: 'load_skill', args: { name: 'layout-patterns' } },
        { callId: 'c2', name: 'load_skill', args: { name: 'no-such-skill' } },
        paint('c3', 2, 2, 4, 4),
      ]),
      textTurn('Read the site, then raised the hill.'),
    ]);
    const executor = createExecutor(deps, { delegate });

    const r = await executor.execute({ callId: 'd8', name: 'delegate_task', args: brief() });

    expect(r.isError).toBe(false);
    // The child's own log dies with the call; this list is the whole surviving record of its work.
    expect(r.detail?.childOps).toEqual([
      { name: 'load_skill', status: 'ok', skill: { name: 'layout-patterns', kind: 'method', title: 'Layout Patterns' } },
      { name: 'load_skill', status: 'error' },
      { name: 'draw_area', status: 'ok' },
    ]);
    expect(r.detail?.cells).toBeGreaterThan(0);
    expect(r.detail?.childError).toBeUndefined();
  });

  it("a child that ends in an incident reads failed with the error's class, and its ops still stand", async () => {
    const { state, deps } = setup();
    const delegate = makeDelegate([
      toolTurn([paint('c1', 2, 2, 3, 3)]),
      { error: { cls: 'auth', detail: 'The API key was rejected.\nCheck the key in settings.' } },
    ]);
    const executor = createExecutor(deps, { delegate });

    const r = await executor.execute({ callId: 'd9', name: 'delegate_task', args: brief() });

    expect(r.isError).toBe(true);
    expect(r.content).toBe(resultOf({
      status: 'failed', landed: 1, terrain: terrainIn(state, WHOLE), report: helperResultReport(r.content),
      fault: { cls: 'auth', detail: 'The API key was rejected.\nCheck the key in settings.' },
    }));
    // Only the first line of the provider's detail reaches the lead model.
    expect(r.content).not.toContain('Check the key in settings');
    expect(r.detail?.childError).toBe('auth');
    // The edits the child made before the incident are on the map, so the record keeps them.
    expect(r.detail?.childOps).toEqual([{ name: 'draw_area', status: 'ok' }]);
    expect(r.detail?.cells).toBeGreaterThan(0);
  });

  it('keeps a successful child edit visible when another child stroke rolls back', async () => {
    const { state, deps } = setup();
    const delegate = makeDelegate([
      toolTurn([
        { callId: 'hill', name: 'draw_area', args: { x: 2, y: 2, reads_as: 'a hill', rows: ['1'] } },
        { callId: 'pool', name: 'draw_area', args: { x: 10, y: 10, reads_as: 'a pool', rows: ['w'], legend: ['w=water 1'] } },
      ]),
      textTurn('The hill remains. The pool could not be contained.'),
    ]);
    const result = await createExecutor(deps, { delegate }).execute({ callId: 'mixed', name: 'delegate_task', args: brief() });
    // One cell named is the four pieces of ground it rests on.
    expect(result.detail).toMatchObject({ cells: 4, reverted: true, partialRevert: true });
    expect(retainedWrite({ ...result, write: true })).toBe(true);
    expect(state.cells[2]![2]!.terrain?.elevation).toBe(1);
    expect(state.cells[10]![10]!.terrain).toBeNull();
  });

  it('onChildProgress reports rising op counts as the child works, and always clears on exit, even after an incident', async () => {
    const { deps } = setup();
    const calls: ({ task: string; opName?: string; ops: number } | null)[] = [];
    const delegate = makeDelegate([
      toolTurn([paint('c1', 2, 2, 3, 3)]),
      toolTurn([{ callId: 'c2', name: 'inspect_region', args: { x1: 0, y1: 0, x2: 1, y2: 1 } }]),
      { error: { cls: 'auth', detail: 'boom' } },
    ]);
    const rows: string[] = [];
    delegate.onChildProgress = (callId, p) => { rows.push(callId); calls.push(p); };
    const executor = createExecutor(deps, { delegate });

    const r = await executor.execute({ callId: 'd12', name: 'delegate_task', args: brief({ goal: 'raise a hill and look around' }) });

    expect(r.isError).toBe(true);
    const withCounts = calls.filter((c): c is { task: string; opName?: string; ops: number } => c !== null);
    expect(withCounts.map((c) => c.ops)).toEqual(expect.arrayContaining([0, 1, 2]));
    expect(withCounts.every((c) => c.task === 'raise a hill and look around')).toBe(true);
    expect(withCounts.find((c) => c.ops === 1)?.opName).toBe('draw_area');
    expect(withCounts.find((c) => c.ops === 2)?.opName).toBe('inspect_region');
    // The `finally` clears the lane whatever way the child ends, including an incident.
    expect(calls[calls.length - 1]).toBeNull();
    // Every report names the call that started the helper, so the panel can tell helpers apart.
    expect(new Set(rows)).toEqual(new Set(['d12']));
  });

  /** `label` is the panel's short name for the lane; the goal rides beside it as the lane's line. */
  it("carries the brief's label and goal through onChildProgress", async () => {
    const { deps } = setup();
    const calls: ({ task: string; opName?: string; ops: number; label?: string } | null)[] = [];
    const delegate = makeDelegate([toolTurn([{ callId: 'c1', name: 'inspect_region', args: { x1: 0, y1: 0, x2: 1, y2: 1 } }]), textTurn('done')]);
    delegate.onChildProgress = (_callId, p) => calls.push(p);
    const executor = createExecutor(deps, { delegate });

    await executor.execute({
      callId: 'd13', name: 'delegate_task',
      args: brief({ goal: 'plant an oak grove north of the lake', label: 'north grove' }),
    });

    const withCounts = calls.filter((c): c is { task: string; opName?: string; ops: number; label?: string } => c !== null);
    expect(withCounts.length).toBeGreaterThan(0);
    expect(withCounts.every((c) => c.label === 'north grove')).toBe(true);
    expect(withCounts.every((c) => c.task === 'plant an oak grove north of the lake')).toBe(true);
  });

  it('a delegate_task left unresolved by a reload is never re-executed: the resume synthesizes a refusal', async () => {
    const { deps } = setup();
    const parentLog = createLog();
    const delegate = makeDelegate([textTurn('the child must never run')], { parentLog });
    const loopDeps = parentDeps(deps, [textTurn('Understood; I will look at the map first.')], delegate);

    append(parentLog, { kind: 'order', text: 'build a village', mapContext: '' });
    append(parentLog, {
      kind: 'assistant', stop: 'tool-calls',
      parts: [{ kind: 'tool', callId: 'd10', name: 'delegate_task', input: brief(), argsDone: true }],
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
    expect(result?.content).toBe(helperInterrupted());
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
      toolTurn([{ callId: 'd11', name: 'delegate_task', args: brief() }]),
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
    expect(result?.content).toBe(resultOf({ status: 'done', report: 'Helper report: the village already stood; nothing needed building.' }));
  });

  it('with no opts.delegate, delegate_task is an unknown tool', async () => {
    const { deps } = setup();
    const executor = createExecutor(deps);
    const r = await executor.execute({ callId: 'd7', name: 'delegate_task', args: brief() });
    expect(r.isError).toBe(true);
    expect(r.content).toBe('Unknown tool "delegate_task".');
  });
});

/** The helper's closing words as a result carries them: everything after its `Report:` line opens. */
function helperResultReport(content: string): string {
  return content.slice(content.indexOf('\nReport: ') + '\nReport: '.length);
}

describe('exec/executor: what the lead model reads of a helper', () => {
  const BOUNDS = { x1: 2, y1: 2, x2: 8, y2: 8 };

  /** Runs a lead job that hands `BOUNDS` to a helper scripted with `childTurns`, and returns what
   *  the lead's next request carried and the helper's result event. */
  async function handOver(childTurns: ScriptedTurn[]) {
    const { state, deps } = setup();
    const parentLog = createLog();
    const delegate = makeDelegate(childTurns, { parentLog });
    const loopDeps = parentDeps(deps, [
      toolTurn([{ callId: 'd', name: 'delegate_task', args: brief(BOUNDS) }]),
      textTurn('The region is handed over.'),
      textTurn('The region is handed over.'),
    ], delegate);
    append(parentLog, { kind: 'order', text: 'build a village', mapContext: '' });
    await runJob(parentLog, loopDeps);
    const result = eventsOf(parentLog).find(
      (e): e is Extract<SessionEvent, { kind: 'toolResult' }> => e.kind === 'toolResult' && e.callId === 'd',
    );
    return { state, result, next: JSON.stringify(loopDeps.adapter.requests[1]?.messages) };
  }

  /** `text` as it reads inside a JSON-serialized request. */
  const inJson = (text: string): string => JSON.stringify(text).slice(1, -1);

  it('[ASST-30] reports done for a helper that settled with every write landed', async () => {
    const { state, result, next } = await handOver([toolTurn([paint('c1', 3, 3, 4, 4)]), textTurn('Raised the hill.'), textTurn('Raised the hill.')]);

    const expected = helperResult({
      label: 'hill', status: 'done', bounds: BOUNDS, landed: 1, refused: 0, objects: 0, terrain: terrainIn(state, BOUNDS),
      report: 'Raised the hill.',
    });
    expect(terrainIn(state, BOUNDS)).toBeGreaterThan(0);
    expect(result).toMatchObject({ content: expected, isError: false });
    expect(next).toContain(inJson(expected));
  });

  it('[ASST-30] reports partial for a helper that settled with a refused write', async () => {
    const { state, result, next } = await handOver([
      toolTurn([paint('in', 3, 3, 4, 4), paint('out', 12, 12, 13, 13)]),
      textTurn('Raised the hill; the second one was out of bounds.'),
      textTurn('Raised the hill; the second one was out of bounds.'),
    ]);

    const expected = helperResult({
      label: 'hill', status: 'partial', bounds: BOUNDS, landed: 1, refused: 1, objects: 0, terrain: terrainIn(state, BOUNDS),
      report: 'Raised the hill; the second one was out of bounds.',
    });
    expect(result).toMatchObject({ content: expected, isError: false });
    expect(next).toContain(inJson(expected));
  });

  it('[ASST-30] reports capped, as a failure, for a helper that ran out of turns', async () => {
    const looks = Array.from({ length: SUBAGENT_MAX_TURNS - 1 }, (_, i) =>
      toolTurn([i === 0 ? paint('c0', 3, 3, 4, 4) : { callId: `c${i}`, name: 'inspect_region', args: { x1: i % 10, y1: 0, x2: 10 + (i % 9), y2: 5 } }]));
    const { state, result, next } = await handOver([...looks, textTurn('Ran out of turns after the hill.')]);

    const expected = helperResult({
      label: 'hill', status: 'capped', bounds: BOUNDS, landed: 1, refused: 0, objects: 0, terrain: terrainIn(state, BOUNDS),
      report: 'Ran out of turns after the hill.',
    });
    expect(result).toMatchObject({ content: expected, isError: true });
    expect(next).toContain(inJson(expected));
  });
});
