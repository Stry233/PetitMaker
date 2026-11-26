import { afterEach, beforeEach, describe, expect } from 'vitest';
import { spec } from '../../_support/spec';
import { useEditorStore } from '../../../state/store';
import { createDefaultRegistry } from '../../../rules';
import { makeTemplate } from '../../_support/map-state';
import { agentSessionPort } from '../../../agent/exec/session-port';
import { makeToolDeps } from '../../../agent/exec/tool-deps';
import { createExecutor } from '../../../agent/exec/executor';
import { buildMapContext, wireSchemas, type AgentToolDeps } from '../../../agent/tools';
import { createScriptedAdapter } from '../../_support/agent/scripted-adapter';
import { append, createLog, eventsOf, type SessionLog } from '../../../agent/core/log';
import { pendingGate, type Oversight } from '../../../agent/core/gates';
import { runJob } from '../../../agent/core/loop';
import { listCommands, runCommand, type Command, type CommandEffect } from '../../../editor/commands/run';
import { translate } from '../../../i18n/context';

const s = () => useEditorStore.getState();

async function flush(): Promise<void> {
  for (let i = 0; i < 100; i++) await Promise.resolve();
}

const EFFECTS = ['answer', 'change', 'outward', 'destroy'] as const satisfies readonly CommandEffect[];

/** One command over the app per effect and one that changes the map, each recording that it ran. */
function probes(ran: string[]): Command[] {
  const probe = (name: string, effect: CommandEffect, target: Command['target']): Command => ({
    id: `probe.${name}`, effect, target, description: `A ${name} probe.`, labelKey: 'modal.settings_title', args: [],
    invoke: () => { ran.push(name); return 'done'; },
  });
  return [...EFFECTS.map((effect) => probe(effect, effect, 'app')), probe('map', 'change', 'map')];
}

/** The live dependencies over `commands` in the editor's place. */
function depsOver(commands: Command[]): AgentToolDeps {
  return {
    ...makeToolDeps({ vision: false, session: agentSessionPort }),
    listAppActions: () => listCommands(commands),
    runAppAction: (id, args) => runCommand(id, args, undefined, commands),
  };
}

let stop: AbortController;
beforeEach(() => {
  s().initMap(makeTemplate(30, 30), createDefaultRegistry());
  s().setRegion([], 'agent');
  stop = new AbortController();
});
afterEach(() => stop.abort());

/** Runs one job whose only call is `run_app_action` with `input`, until it settles or waits at a gate. */
async function order(deps: AgentToolDeps, oversight: Oversight, input: Record<string, unknown>): Promise<SessionLog> {
  const adapter = createScriptedAdapter([
    { events: [{ t: 'done', stop: 'tool-calls', final: [{ callId: 'c1', name: 'run_app_action', args: input, rawArgs: JSON.stringify(input) }] }] },
    { events: [{ t: 'text', delta: 'Done.' }, { t: 'done', stop: 'stop' }] },
  ]);
  const log = createLog();
  append(log, { kind: 'order', text: 'Do it', mapContext: buildMapContext(s().gridState!, [], deps) });
  void runJob(log, {
    adapter, model: 'scripted-model', system: 'system', tools: wireSchemas(), executor: createExecutor(deps),
    oversight, sameModel: true, signal: stop.signal, undoStackSize: () => deps.getExecutor().historyDepth(), sleep: async () => {},
  });
  await flush();
  return log;
}

describe('app actions and approval', () => {
  const ASKED = {
    answer: [],
    change: ['strict'],
    outward: ['strict', 'checkpoint'],
  } as const satisfies Partial<Record<CommandEffect, readonly Oversight[]>>;

  for (const level of ['answer', 'change', 'outward'] as const) {
    for (const oversight of ['strict', 'checkpoint', 'yolo'] as const) {
      const asks = (ASKED[level] as readonly Oversight[]).includes(oversight);
      spec('ASST-33', `${level === 'outward' ? 'an' : 'a'} ${level === 'answer' ? 'answering' : level} action ${asks ? 'asks first' : 'runs unasked'} under ${oversight}`, async () => {
        const ran: string[] = [];
        const log = await order(depsOver(probes(ran)), oversight, { id: `probe.${level}` });
        expect(pendingGate(log) !== undefined).toBe(asks);
        expect(ran).toEqual(asks ? [] : [level]);
      });
    }
  }

  for (const name of ['destroy', 'map'] as const) {
    spec('ASST-31', `a command that ${name === 'map' ? 'edits the map' : 'destroys stored work'} is neither listed nor run, and asks nothing`, async () => {
      const ran: string[] = [];
      const deps = depsOver(probes(ran));
      const listed = await createExecutor(deps).execute({ callId: 'l', name: 'list_app_actions', args: {} });
      expect((JSON.parse(listed.content) as { id: string }[]).map((row) => row.id)).toEqual(['probe.answer', 'probe.change', 'probe.outward']);
      const log = await order(deps, 'strict', { id: `probe.${name}` });
      expect(pendingGate(log)).toBeUndefined();
      expect(eventsOf(log).find((e) => e.kind === 'toolResult')).toMatchObject({ isError: true });
      expect(ran).toEqual([]);
    });
  }

  spec('ASST-31', 'the keyboard\'s map-editing commands are not offered: Undo is refused and the history stands', async () => {
    const deps = makeToolDeps({ vision: false, session: agentSessionPort });
    const listed = await createExecutor(deps).execute({ callId: 'l', name: 'list_app_actions', args: {} });
    const ids = (JSON.parse(listed.content) as { id: string }[]).map((row) => row.id);
    for (const id of ['history.undo', 'history.redo', 'selection.delete', 'selection.paste', 'tool.brush']) expect(ids, id).not.toContain(id);
    const depth = deps.getExecutor().historyDepth();
    const log = await order(deps, 'yolo', { id: 'history.undo' });
    expect(eventsOf(log).find((e) => e.kind === 'toolResult')).toMatchObject({ isError: true });
    expect(deps.getExecutor().historyDepth()).toBe(depth);
  });

  spec('ASST-33', 'an id the table lacks is refused without a question, even under Strict', async () => {
    const deps = makeToolDeps({ vision: false, session: agentSessionPort });
    const log = await order(deps, 'strict', { id: 'settings.erase_everything' });
    expect(pendingGate(log)).toBeUndefined();
    expect(eventsOf(log).find((e) => e.kind === 'toolResult')).toMatchObject({ isError: true });
  });

  spec('ASST-33', 'a setting change is no edit of the map: no undo step, no job checkpoint, no write stamp', async () => {
    const deps = makeToolDeps({ vision: false, session: agentSessionPort });
    const depth = deps.getExecutor().historyDepth();
    const on = !s().showChunkBounds;
    const log = await order(deps, 'yolo', { id: 'overlay.chunks', args: { on } });
    expect(s().showChunkBounds).toBe(on);
    expect(deps.getExecutor().historyDepth()).toBe(depth);
    const events = eventsOf(log);
    expect(events.filter((e) => e.kind === 'checkpoint')).toEqual([]);
    expect(events.find((e) => e.kind === 'toolResult')).toMatchObject({ isError: false, write: false });
    expect(events.some((e) => e.kind === 'jobEnd' && e.outcome === 'done')).toBe(true);
  });

  spec('ASST-17', 'the question names the setting and its value as the interface does', async () => {
    const deps = makeToolDeps({ vision: false, session: agentSessionPort });
    const log = await order(deps, 'strict', { id: 'overlay.grid', args: { value: 'off' } });
    const summary = pendingGate(log)!.summary;
    expect(summary).toContain(translate('agent.verb_run_app_action'));
    expect(summary).toContain(translate('shortcut.toggle_grid'));
    expect(summary).toContain(translate('modal.settings_grid_off'));
    expect(summary).not.toMatch(/run_app_action|overlay\.grid|[{}]/);
  });

  spec('ASST-31', 'the assistant lists the app actions with their effects and present values, and a helper is offered neither tool', async () => {
    const deps = makeToolDeps({ vision: false, session: agentSessionPort });
    const listed = await createExecutor(deps).execute({ callId: 'l', name: 'list_app_actions', args: {} });
    const rows = JSON.parse(listed.content) as { id: string; effect: string; current?: unknown }[];
    expect(rows.map((row) => row.id)).toEqual(listCommands().filter((command) => command.target === 'app' && command.effect !== 'destroy').map((command) => command.id));
    for (const id of ['settings.language', 'window.open', 'app.export_image', 'camera.fit']) expect(rows.map((row) => row.id), id).toContain(id);
    for (const id of ['app.reset_local_data', 'keymap.reset']) expect(rows.map((row) => row.id), id).not.toContain(id);
    expect(rows.find((row) => row.id === 'overlay.chunks')).toMatchObject({ effect: 'change', current: s().showChunkBounds });
    const helper = wireSchemas({ subagent: true }).map((schema) => schema.name);
    expect(helper).not.toContain('list_app_actions');
    expect(helper).not.toContain('run_app_action');
  });

  spec('ASST-31', 'an export is prepared and left for the user: the window opens and the result says it waits for them', async () => {
    const deps = makeToolDeps({ vision: false, session: agentSessionPort });
    const result = await createExecutor(deps).execute({ callId: 'e', name: 'run_app_action', args: { id: 'app.export_image', args: { preset: 'plain' } } });
    expect(result.isError).toBe(false);
    expect(result.content).toMatch(/confirm/);
    expect(s().modals.share).toBe(true);
    s().setModal('share', false);
  });
});
