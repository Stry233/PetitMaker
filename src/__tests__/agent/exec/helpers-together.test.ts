/**
 * Helpers briefed in one turn work at the same time: each starts before another has finished, their
 * edits reach the map one at a time, and each result is filed against its own call.
 */
import { describe, expect, it } from 'vitest';
import { EventBus } from '../../../core/commands/event-bus';
import { createDefaultRegistry } from '../../../rules';
import type { EditorEvents } from '../../../state/editing/events';
import { makeState } from '../../_support/map-state';
import { createExecutor, type DelegateOpts } from '../../../agent/exec/executor';
import { wireSchemas, type AgentToolDeps } from '../../../agent/tools';
import { createScriptedAdapter, type ScriptedTurn } from '../../_support/agent/scripted-adapter';
import { append, createLog, eventsOf } from '../../../agent/core/log';
import { runJob, type LoopDeps } from '../../../agent/core/loop';
import { answerGate } from '../../../agent/core/gates';
import type { SessionEvent } from '../../../agent/core/types';
import { createExecutor as createCommandExecutor } from '../../../state/executor';

const text = (said: string): ScriptedTurn => ({ events: [{ t: 'text', delta: said }, { t: 'done', stop: 'stop' }] });
const calls = (list: { callId: string; name: string; args: Record<string, unknown> }[]): ScriptedTurn => ({
  events: [{ t: 'done', stop: 'tool-calls', final: list.map((c) => ({ ...c, rawArgs: JSON.stringify(c.args) })) }],
});
const raise = (callId: string, x1: number, x2: number) =>
  ({ callId, name: 'draw_area', args: { x: x1, y: 4, reads_as: 'a bed', rows: Array.from({ length: 5 }, () => '1'.repeat(x2 - x1 + 1)) } });

describe('helpers briefed in one turn', () => {
  it('work at the same time, each inside its own bounds', async () => {
    const state = makeState(40, 20);
    const exec = createCommandExecutor(state, createDefaultRegistry(), new EventBus<EditorEvents>());
    const deps: AgentToolDeps = { getState: () => state, getExecutor: () => exec, getRegion: () => [] };
    const parentLog = createLog();
    // One script serves both helpers in the order they ask. Working in turn, the first helper would
    // take both paint turns and be refused the second, which lies in the other's bounds.
    const helpers = createScriptedAdapter([
      calls([raise('a1', 4, 8)]), calls([raise('b1', 26, 30)]),
      text('West terrace raised.'), text('East terrace raised.'), text('West terrace raised.'), text('East terrace raised.'),
    ]);
    const delegate: DelegateOpts = {
      adapter: helpers, model: 'scripted-model', system: 'you are a helper', oversight: 'yolo',
      signal: new AbortController().signal, log: parentLog,
    };
    const lead = createScriptedAdapter([
      calls([
        { callId: 'west', name: 'delegate_task', args: { label: 'west', x1: 0, y1: 0, x2: 18, y2: 19, goal: 'raise a terrace' } },
        { callId: 'east', name: 'delegate_task', args: { label: 'east', x1: 20, y1: 0, x2: 39, y2: 19, goal: 'raise a terrace' } },
      ]),
      text('Both terraces are raised.'),
    ]);
    const loopDeps: LoopDeps = {
      adapter: lead, model: 'scripted-model', system: 'you are the lead', tools: wireSchemas(),
      executor: createExecutor(deps, { delegate }), oversight: 'yolo', sameModel: true,
      signal: new AbortController().signal, undoStackSize: () => exec.historyDepth(),
    };
    append(parentLog, { kind: 'order', text: 'raise two terraces', mapContext: '' });

    expect(await runJob(parentLog, loopDeps)).toBe('done');

    expect(state.cells[6]![6]!.terrain).not.toBeNull();
    expect(state.cells[6]![28]!.terrain).not.toBeNull();
    const results = eventsOf(parentLog).filter((e): e is Extract<SessionEvent, { kind: 'toolResult' }> => e.kind === 'toolResult');
    expect(results.map((r) => [r.callId, r.isError])).toEqual([['west', false], ['east', false]]);
    expect(results[0]!.content).toContain('West terrace raised.');
    expect(results[1]!.content).toContain('East terrace raised.');
  });

  it('do not start when a pause arrives while the turn is still being admitted, and run when the job resumes', async () => {
    const state = makeState(40, 20);
    const exec = createCommandExecutor(state, createDefaultRegistry(), new EventBus<EditorEvents>());
    const deps: AgentToolDeps = { getState: () => state, getExecutor: () => exec, getRegion: () => [] };
    const parentLog = createLog();
    const helpers = createScriptedAdapter([
      calls([raise('a1', 4, 8)]), calls([raise('b1', 26, 30)]),
      text('West terrace raised.'), text('East terrace raised.'), text('West terrace raised.'), text('East terrace raised.'),
    ]);
    // Under checkpoint oversight every hand-over waits for the user's yes.
    const delegate: DelegateOpts = {
      adapter: helpers, model: 'scripted-model', system: 'you are a helper', oversight: 'yolo',
      signal: new AbortController().signal, log: parentLog,
    };
    const lead = createScriptedAdapter([
      calls([
        { callId: 'west', name: 'delegate_task', args: { label: 'west', x1: 0, y1: 0, x2: 18, y2: 19, goal: 'raise a terrace' } },
        { callId: 'east', name: 'delegate_task', args: { label: 'east', x1: 20, y1: 0, x2: 39, y2: 19, goal: 'raise a terrace' } },
      ]),
      text('Both terraces are raised.'), text('Both terraces are raised.'),
    ]);
    const loopDeps: LoopDeps = {
      adapter: lead, model: 'scripted-model', system: 'you are the lead', tools: wireSchemas(),
      executor: createExecutor(deps, { delegate }), oversight: 'checkpoint', sameModel: true,
      signal: new AbortController().signal, undoStackSize: () => exec.historyDepth(),
    };
    append(parentLog, { kind: 'order', text: 'raise two terraces', mapContext: '' });
    const gates = () => eventsOf(parentLog).filter((e): e is Extract<SessionEvent, { kind: 'gateAsked' }> => e.kind === 'gateAsked');
    const settle = async () => { for (let i = 0; i < 80; i++) await Promise.resolve(); };

    const first = runJob(parentLog, loopDeps);
    await settle();
    answerGate(parentLog, gates()[0]!.gateId, 'allow');
    await settle();
    // The pause lands while the second hand-over still waits for its yes.
    append(parentLog, { kind: 'pauseRequested' });
    answerGate(parentLog, gates()[1]!.gateId, 'allow');
    expect(await first).toBe('paused');
    expect(helpers.requests).toHaveLength(0);
    expect(state.cells[6]![6]!.terrain).toBeNull();

    append(parentLog, { kind: 'resumed' });
    expect(await runJob(parentLog, loopDeps)).toBe('done');
    expect(state.cells[6]![6]!.terrain).not.toBeNull();
    expect(state.cells[6]![28]!.terrain).not.toBeNull();
  });

  it('are not offered undo, which would reach another helper\'s step', () => {
    const offered = wireSchemas({ subagent: true }).map((t) => t.name);
    expect(offered).not.toContain('undo');
    expect(offered).not.toContain('redo');
    expect(wireSchemas().map((t) => t.name)).toContain('undo');
  });
});
