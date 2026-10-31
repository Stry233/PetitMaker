import { beforeEach, describe, expect } from 'vitest';
import { spec } from '../../_support/spec';
import { useEditorStore } from '../../../state/store';
import { createDefaultRegistry } from '../../../rules';
import { makeTemplate } from '../../_support/map-state';
import { agentSessionPort } from '../../../agent/exec/session-port';
import { makeToolDeps } from '../../../agent/exec/tool-deps';
import { createExecutor } from '../../../agent/exec/executor';
import { buildMapContext, executeToolCall, wireSchemas, type AgentToolDeps } from '../../../agent/tools';
import { createScriptedAdapter, type ScriptedTurn } from '../../_support/agent/scripted-adapter';
import { append, createLog, eventsOf } from '../../../agent/core/log';
import { pendingGate } from '../../../agent/core/gates';
import { runJob } from '../../../agent/core/loop';
import { approvedTexts, recordTextVerdict } from '../../../state/text-verdicts';

const s = () => useEditorStore.getState();
let deps: AgentToolDeps;
const run = (name: string, input: Record<string, unknown> = {}) => executeToolCall({ id: 'call', name, input }, deps);
const notes = () => s().gridState!.annotations?.items ?? [];

async function flush(): Promise<void> {
  for (let i = 0; i < 100; i++) await Promise.resolve();
}

const toolTurn = (calls: { callId: string; name: string; args: Record<string, unknown> }[]): ScriptedTurn =>
  ({ events: [{ t: 'done', stop: 'tool-calls', final: calls.map((c) => ({ ...c, rawArgs: JSON.stringify(c.args) })) }] });

beforeEach(() => {
  s().initMap(makeTemplate(30, 30), createDefaultRegistry());
  s().setRegion([]);
  deps = makeToolDeps({ vision: false, session: agentSessionPort });
});

describe('plans on the map', () => {
  spec('ASST-21', 'under Checkpoint the plan asks approval with its layout already standing on the map', async () => {
    const adapter = createScriptedAdapter([
      toolTurn([
        { callId: 'a1', name: 'set_annotation', args: { tag: 'entrance', shapes: [{ type: 'band', points: [{ x: 0, y: 15 }, { x: 29, y: 15 }], width: 3 }] } },
        { callId: 'a2', name: 'set_annotation', args: { tag: 'homes', shapes: [{ type: 'rect', x1: 2, y1: 2, x2: 27, y2: 13 }] } },
      ]),
      toolTurn([{ callId: 'p', name: 'update_plan', args: { stages: [{ label: 'Paths 1' }, { label: 'Homes 2' }] } }]),
    ]);
    const log = createLog();
    append(log, { kind: 'order', text: 'Plan a village, then build it', mapContext: buildMapContext(s().gridState!, [], deps) });
    void runJob(log, {
      adapter, model: 'scripted-model', system: 'system', tools: wireSchemas(), executor: createExecutor(deps),
      oversight: 'checkpoint', sameModel: true, signal: new AbortController().signal, undoStackSize: () => 0, sleep: async () => {},
    });
    await flush();
    expect(pendingGate(log)).toMatchObject({ scope: 'plan' });
    expect(eventsOf(log).filter((e) => e.kind === 'gateAsked')).toHaveLength(1);
    expect(notes().map((n) => n.kind === 'zone' && n.tag)).toEqual(['entrance', 'homes']);
  });

  spec('ASST-21', 'a plan drawn on the map and closed with a question in text is asked once to be filed instead', async () => {
    const adapter = createScriptedAdapter([
      toolTurn([{ callId: 'a1', name: 'set_annotation', args: { tag: 'homes', shapes: [{ type: 'rect', x1: 2, y1: 2, x2: 27, y2: 13 }] } }]),
      { events: [{ t: 'text', delta: 'The plan is drawn. Shall I build it?' }, { t: 'done', stop: 'stop' }] },
      { events: [{ t: 'text', delta: 'The plan is drawn. Shall I build it?' }, { t: 'done', stop: 'stop' }] },
    ]);
    const log = createLog();
    append(log, { kind: 'order', text: 'Plan a village', mapContext: buildMapContext(s().gridState!, [], deps) });
    const outcome = await runJob(log, {
      adapter, model: 'scripted-model', system: 'system', tools: wireSchemas(), executor: createExecutor(deps),
      oversight: 'yolo', sameModel: true, signal: new AbortController().signal, undoStackSize: () => 0, sleep: async () => {},
    });
    expect(outcome).toBe('done');
    const notes = eventsOf(log).filter((e) => e.kind === 'systemNote');
    expect(notes.map((e) => e.kind === 'systemNote' && e.note)).toEqual(['plan-sketch']);
    expect(adapter.requests).toHaveLength(3);
  });

  spec('ASST-22', "the user's zones reach the order and a shape-drawn zone leaves their cells to them", async () => {
    s().addAnnotation({ kind: 'zone', id: 'mine', num: 1, tag: 'water', color: '#38BDF8', cells: [{ x: 5, y: 5 }, { x: 6, y: 5 }] });
    expect(buildMapContext(s().gridState!, [], deps)).toMatch(/#1 water #38BDF8 id=mine: 2 cells \(5,5\)-\(6,5\)/);
    expect((await run('set_annotation', { tag: 'garden', shapes: [{ type: 'rect', x1: 0, y1: 0, x2: 10, y2: 10 }] })).isError).toBe(false);
    const mine = notes().find((n) => n.id === 'mine')!;
    const garden = notes().find((n) => n.id !== 'mine')!;
    expect(mine).toMatchObject({ cells: [{ x: 5, y: 5 }, { x: 6, y: 5 }] });
    expect(garden.kind === 'zone' && garden.cells.some((c) => c.y === 5 && (c.x === 5 || c.x === 6))).toBe(false);
  });

  spec('ASST-23', 'plan annotations outlast terrain undo and fall to the Annotations undo, and a hidden layer takes none', async () => {
    await run('set_annotation', { tag: 'homes', shapes: [{ type: 'rect', x1: 2, y1: 2, x2: 8, y2: 8 }] });
    expect((await run('paint_terrain', { shape: 'rect', x1: 20, y1: 20, x2: 22, y2: 22, terrain: 'water', elevation: 0 })).isError).toBe(false);
    expect((await run('undo')).isError).toBe(false);
    expect(s().gridState!.cells[21]![21]!.terrain).toBeFalsy();
    expect(notes()).toHaveLength(1);
    s().undoAnnotation();
    expect(notes()).toHaveLength(0);
    s().setAnnotationsVisible(false);
    expect((await run('set_annotation', { tag: 'homes', shapes: [{ type: 'rect', x1: 2, y1: 2, x2: 8, y2: 8 }] })).isError).toBe(true);
    expect(notes()).toHaveLength(0);
  });

  spec('ASST-24', 'a custom tag the assistant names is not drawn before the text check approves it', async () => {
    await run('set_annotation', { customTag: 'Tide Library', shapes: [{ type: 'rect', x1: 2, y1: 2, x2: 8, y2: 8 }] });
    const tags = s().gridState!.annotations!.customTags!;
    expect(tags.map((t) => t.text)).toEqual(['Tide Library']);
    expect(approvedTexts(tags)).toEqual([]);
    recordTextVerdict('Tide Library', true);
    expect(approvedTexts(tags)).toEqual(tags);
  });

  const userZone = (num: number, tag: string, [x1, y1, x2, y2]: number[]) => {
    const cells = [];
    for (let y = y1!; y <= y2!; y++) for (let x = x1!; x <= x2!; x++) cells.push({ x, y });
    s().addAnnotation({ kind: 'zone', id: `user-${num}`, num, tag: tag as 'forest', color: '#2FBF9B', cells });
  };
  const insideZone = (x1: number, y1: number, x2: number, y2: number) => [...s().gridState!.objects.values()]
    .filter((o) => !o.locked).every((o) => o.position.x >= x1 && o.position.y >= y1 && o.position.x <= x2 && o.position.y <= y2);

  spec('ASST-25', "the area tools given a zone's number keep what they build inside that zone", async () => {
    userZone(1, 'forest', [3, 3, 12, 12]);
    userZone(2, 'garden', [16, 3, 26, 12]);
    expect((await run('plant_forest', { zone: 1, density: 1 })).isError).toBe(false);
    expect(s().gridState!.objects.size).toBeGreaterThan(1);
    expect(insideZone(3, 3, 12, 12)).toBe(true);
    expect((await run('scatter_objects', { catalogIds: ['flower-rose'], count: 30, x1: 0, y1: 0, x2: 29, y2: 29, zone: 2 })).isError).toBe(false);
    const flowers = [...s().gridState!.objects.values()].filter((o) => o.catalogId === 'flower-rose');
    expect(flowers.length).toBeGreaterThan(0);
    expect(flowers.every((o) => o.position.x >= 16 && o.position.x <= 26 && o.position.y >= 3 && o.position.y <= 12)).toBe(true);
    expect((await run('paint_terrain', { zone: 9, terrain: 'water', elevation: 0 })).content).toMatch(/zone #9 is not on the map/);
  });

  spec('ASST-25', 'reading the annotations tells what each zone holds and which zones hold nothing yet', async () => {
    userZone(1, 'forest', [3, 3, 12, 12]);
    userZone(2, 'garden', [16, 3, 26, 12]);
    const before = (await run('get_annotations')).content;
    expect(before).not.toMatch(/; holds|holding nothing/);
    await run('plant_forest', { zone: 1, density: 1 });
    const after = (await run('get_annotations')).content;
    expect(after).toMatch(/#1 forest .*; holds \d+ tree/);
    expect(after).toMatch(/Built: zones holding nothing #2\./);
    expect(buildMapContext(s().gridState!, [], deps)).toMatch(/#1 forest .*; holds \d+ tree/);
  });
});
