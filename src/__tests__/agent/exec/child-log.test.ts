/** A job's own log keeps each child's result; the child-log hook hands over the child's whole run. */
import { describe, expect, it } from 'vitest';
import { EventBus } from '../../../core/commands/event-bus';
import { createDefaultRegistry } from '../../../rules';
import type { EditorEvents } from '../../../state/editing/events';
import { makeState } from '../../_support/map-state';
import { createExecutor, type DelegateOpts } from '../../../agent/exec/executor';
import { wireSchemas, type AgentToolDeps } from '../../../agent/tools';
import { createScriptedAdapter, type ScriptedTurn } from '../../_support/agent/scripted-adapter';
import { append, createLog, eventsOf, type SessionLog } from '../../../agent/core/log';
import { runJob } from '../../../agent/core/loop';
import { createExecutor as createCommandExecutor } from '../../../state/executor';

const text = (said: string): ScriptedTurn => ({ events: [{ t: 'text', delta: said }, { t: 'done', stop: 'stop' }] });
const calls = (list: { callId: string; name: string; args: Record<string, unknown> }[]): ScriptedTurn => ({
  events: [{ t: 'done', stop: 'tool-calls', final: list.map((c) => ({ ...c, rawArgs: JSON.stringify(c.args) })) }],
});

describe('the child-log hook', () => {
  it('hands over each helper\'s whole run under its label', async () => {
    const state = makeState(30, 20);
    const exec = createCommandExecutor(state, createDefaultRegistry(), new EventBus<EditorEvents>());
    const deps: AgentToolDeps = { getState: () => state, getExecutor: () => exec, getRegion: () => [] };
    const parentLog = createLog();
    const children: { label: string; log: SessionLog }[] = [];
    const delegate: DelegateOpts = {
      adapter: createScriptedAdapter([
        calls([{ callId: 'h1', name: 'draw_area', args: { x: 4, y: 4, reads_as: 'a bed', rows: ['11', '11'] } }]),
        text('The bed is raised.'),
      ]),
      model: 'scripted-model', system: 'you are a helper', oversight: 'yolo', signal: new AbortController().signal, log: parentLog,
      onChildLog: (label, log) => children.push({ label, log }),
    };
    const lead = createScriptedAdapter([
      calls([{ callId: 'd1', name: 'delegate_task', args: { label: 'west bed', x1: 0, y1: 0, x2: 14, y2: 14, goal: 'raise a bed' } }]),
      text('Done.'),
    ]);
    append(parentLog, { kind: 'order', text: 'raise a bed', mapContext: '' });
    expect(await runJob(parentLog, {
      adapter: lead, model: 'scripted-model', system: 'you are the lead', tools: wireSchemas(),
      executor: createExecutor(deps, { delegate }), oversight: 'yolo', sameModel: true,
      signal: new AbortController().signal, undoStackSize: () => exec.historyDepth(),
    })).toBe('done');

    expect(children.map((c) => c.label)).toEqual(['west bed']);
    const kinds = eventsOf(children[0]!.log).map((e) => e.kind);
    expect(kinds).toContain('order');
    expect(kinds).toContain('toolResult');
    expect(eventsOf(parentLog).filter((e) => e.kind === 'toolResult')).toHaveLength(1);
  });
});
