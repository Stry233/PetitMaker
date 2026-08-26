import { describe, expect, it } from 'vitest';
import { append, createLog } from '../../../agent/core/log';
import { dumpRun, terrainArrays } from '../../../agent/eval/dump';
import { makeState, setTerrain } from '../../rules/_helpers';
import { TerrainType } from '../../../core/model/types';

/** Builds a two-order, three-op session: order 1 narrates then paints then places (both
 *  successful writes, the place gated once and allowed), order 2 is steered mid-flight, drops one
 *  turn's narration to a mid-turn error (never resent, so a judge must not see it either), narrates
 *  again, then reverts its one write. */
function buildLog() {
  const log = createLog(() => 0);

  append(log, { kind: 'order', text: 'build a house', mapContext: '' });
  append(log, {
    kind: 'assistant', stop: 'tool-calls',
    parts: [
      { kind: 'text', text: 'building a small house here', done: true },
      { kind: 'tool', callId: 'c1', name: 'paint_terrain', input: {}, argsDone: true },
    ],
  });
  append(log, { kind: 'toolResult', callId: 'c1', name: 'paint_terrain', content: 'painted a 3x3 mound', isError: false, detail: { cells: 5 } });
  append(log, { kind: 'assistant', stop: 'tool-calls', parts: [{ kind: 'tool', callId: 'c2', name: 'place_object', input: {}, argsDone: true }] });
  append(log, { kind: 'gateAsked', gateId: 'g1', scope: 'tool', callId: 'c2', summary: 'place a house' });
  append(log, { kind: 'gateAnswered', gateId: 'g1', answer: 'allow' });
  append(log, { kind: 'toolResult', callId: 'c2', name: 'place_object', content: 'placed the house', isError: false, detail: { objects: 1 } });
  append(log, { kind: 'jobEnd', outcome: 'done', summary: 'built a house' });

  append(log, { kind: 'order', text: 'add a shed', mapContext: '' });
  append(log, { kind: 'steer', text: 'make it smaller' });
  append(log, { kind: 'steerDelivered', steerSeq: 9 });
  // A turn that errors mid-stream is dropped wholesale (never resent), so its narration must not
  // reach the transcript either — this is what DROPPED_STOPS in saysForOrder guards.
  append(log, { kind: 'assistant', stop: 'error', parts: [{ kind: 'text', text: 'never mind, switching approach', done: true }] });
  append(log, { kind: 'assistant', stop: 'stop', parts: [{ kind: 'text', text: 'trying a smaller shed instead', done: true }] });
  append(log, { kind: 'assistant', stop: 'tool-calls', parts: [{ kind: 'tool', callId: 'c3', name: 'paint_terrain', input: {}, argsDone: true }] });
  append(log, { kind: 'toolResult', callId: 'c3', name: 'paint_terrain', content: 'reverted: would float', isError: true, detail: { reverted: true } });
  append(log, { kind: 'jobEnd', outcome: 'done', summary: 'shed refused' });

  return log;
}

describe('dumpRun', () => {
  it('counts MODEL turns (one per assistant event, dropped stops included) and ops/writes/reverts/gates/steers off a hand-built log', () => {
    const log = buildLog();
    const dump = dumpRun(log, makeState(4, 4));
    expect(dump.stats).toEqual({
      turns: 5, ops: 3, writes: 2, reverts: 1, regionBlocks: 0,
      gates: 1, steers: 1, cells: 5, objects: 1, images: 0,
    });
  });

  it('marks the ops whose result carried a rendered image, and counts them, so a judge can see the run had eyes', () => {
    const log = createLog(() => 0);
    append(log, { kind: 'order', text: 'look then build', mapContext: '' });
    append(log, {
      kind: 'assistant', stop: 'tool-calls',
      parts: [{ kind: 'tool', callId: 'c1', name: 'view_map', input: {}, argsDone: true }],
    });
    append(log, {
      kind: 'toolResult', callId: 'c1', name: 'view_map', content: 'Rendered view of the current map attached.',
      isError: false, image: 'data:image/png;base64,QUJD',
    });
    append(log, {
      kind: 'assistant', stop: 'tool-calls',
      parts: [{ kind: 'tool', callId: 'c2', name: 'inspect_region', input: {}, argsDone: true }],
    });
    append(log, { kind: 'toolResult', callId: 'c2', name: 'inspect_region', content: 'tokens', isError: false });
    append(log, { kind: 'jobEnd', outcome: 'done' });

    const dump = dumpRun(log, makeState(4, 4));
    const ops = dump.transcript.turns.flatMap((t) => t.ops);
    expect(ops[0]).toEqual({ name: 'view_map', summary: 'Rendered view of the current map attached.', status: 'ok', image: true });
    expect(ops[1]).not.toHaveProperty('image');
    expect(dump.stats.images).toBe(1);
    // The dump itself never carries the base64: the picture is marked, not embedded.
    expect(JSON.stringify(dump)).not.toContain('QUJD');
  });

  it('the transcript groups says and ops per assistant TURN, carries op summaries, and holds no raw JSON braces', () => {
    const log = buildLog();
    const dump = dumpRun(log, makeState(4, 4));
    expect(dump.transcript.orders).toEqual(['build a house', 'add a shed']);
    expect(dump.transcript.turns).toHaveLength(5);
    expect(dump.transcript.turns[0]).toEqual({
      says: ['building a small house here'],
      ops: [{ name: 'paint_terrain', summary: 'painted a 3x3 mound', status: 'ok' }],
    });
    expect(dump.transcript.turns[1]).toEqual({
      says: [],
      ops: [{ name: 'place_object', summary: 'placed the house', status: 'ok' }],
    });
    expect(dump.transcript.turns[4]?.ops).toEqual([
      { name: 'paint_terrain', summary: 'reverted: would float', status: 'revert' },
    ]);
    expect(dump.transcript.outcome).toContain('done');
    const strings = [
      ...dump.transcript.orders, dump.transcript.outcome,
      ...dump.transcript.turns.flatMap((t) => [...t.says, ...t.ops.flatMap((o) => [o.name, o.summary, o.status])]),
    ];
    for (const s of strings) expect(s).not.toContain('{');
  });

  it('says is read off the log: a settled job keeps its narration, a dropped-stop turn\'s text is absent', () => {
    const log = buildLog();
    const dump = dumpRun(log, makeState(4, 4));
    // Job 2's first turn errored mid-stream: it stands as a turn (it was spent) but its narration
    // was never resent, so a judge must not see it either.
    expect(dump.transcript.turns[2]).toEqual({ says: [], ops: [] });
    expect(dump.transcript.turns[3]?.says).toEqual(['trying a smaller shed instead']);
  });

  it('an op without result text still carries a summary naming its status, never an empty string', () => {
    const log = createLog(() => 0);
    append(log, { kind: 'order', text: 'go', mapContext: '' });
    append(log, {
      kind: 'assistant', stop: 'tool-calls',
      parts: [
        { kind: 'tool', callId: 'c1', name: 'place_object', input: {}, argsDone: true },
        { kind: 'tool', callId: 'c2', name: 'paint_terrain', input: {}, argsDone: true },
      ],
    });
    // c1's result is ALL refusal banner (resultLine finds no reason line); c2 never resolved before
    // the job settled, so it reads as cut with no result at all.
    append(log, { kind: 'toolResult', callId: 'c1', name: 'place_object', content: 'REVERTED:', isError: true });
    append(log, { kind: 'jobEnd', outcome: 'capped' });

    const dump = dumpRun(log, makeState(4, 4));
    const ops = dump.transcript.turns.flatMap((t) => t.ops);
    expect(ops).toHaveLength(2);
    for (const op of ops) expect(op.summary).not.toBe('');
    expect(ops[1]?.status).toBe('cut');
  });

  it('a repeat-refused call rides the dump as an error op whose summary names the refusal', () => {
    const log = createLog(() => 0);
    append(log, { kind: 'order', text: 'go', mapContext: '' });
    append(log, {
      kind: 'assistant', stop: 'tool-calls',
      parts: [{ kind: 'tool', callId: 'c1', name: 'paint_terrain', input: { terrain: 'water' }, argsDone: true }],
    });
    append(log, { kind: 'toolResult', callId: 'c1', name: 'paint_terrain', content: 'Arguments: no cells given.', isError: true, write: true });
    append(log, {
      kind: 'assistant', stop: 'tool-calls',
      parts: [{ kind: 'tool', callId: 'c2', name: 'paint_terrain', input: { terrain: 'water' }, argsDone: true }],
    });
    append(log, {
      kind: 'toolResult', callId: 'c2', name: 'paint_terrain', isError: true, write: true,
      content: '(system) Not run: this exact call just failed with:\nArguments: no cells given.\nChange the arguments or the approach.',
      detail: { damper: true, repeatRefused: true },
    });
    append(log, { kind: 'jobEnd', outcome: 'capped' });

    const dump = dumpRun(log, makeState(4, 4));
    const ops = dump.transcript.turns.flatMap((t) => t.ops);
    expect(ops).toHaveLength(2);
    expect(ops[1]).toMatchObject({ status: 'error', summary: expect.stringMatching(/Not run/) });
    expect(dump.stats.writes).toBe(0); // a refused repeat never counts as a landed write
  });

  it('the cells dump round-trips through JSON and matches the grid dimensions', () => {
    const log = buildLog();
    const grid = makeState(3, 2);
    const dump = dumpRun(log, grid);
    const roundTripped = JSON.parse(JSON.stringify(dump.cells)) as unknown[];
    expect(roundTripped).toHaveLength(3 * 2);
    expect(roundTripped[0]).toEqual({ x: 0, y: 0, zone: 2, type: 'n', e: 0, corners: null, patch: false });
  });
});

describe('dumpRun: system notes', () => {
  it('a systemNote rides the turn it answered as its note, so a judge sees the harness lean where it happened', () => {
    const log = createLog(() => 0);
    append(log, { kind: 'order', text: 'bridge the river', mapContext: '' });
    append(log, { kind: 'assistant', stop: 'stop', parts: [{ kind: 'text', text: 'The bridge is in place.', done: true }] });
    append(log, { kind: 'systemNote', note: 'delivery', text: '(system) Nothing has landed on the map yet.' });
    append(log, { kind: 'assistant', stop: 'stop', parts: [{ kind: 'text', text: 'There is no river here, so nothing was built.', done: true }] });
    append(log, { kind: 'jobEnd', outcome: 'done', summary: 'There is no river here, so nothing was built.' });

    const dump = dumpRun(log, makeState(4, 4));
    expect(dump.transcript.turns).toEqual([
      { says: ['The bridge is in place.'], ops: [], note: '(system) Nothing has landed on the map yet.' },
      { says: ['There is no river here, so nothing was built.'], ops: [] },
    ]);
  });

  it('a review note wears the same note face: the harness\'s words, never the model\'s says', () => {
    const log = createLog(() => 0);
    append(log, { kind: 'order', text: 'build a hamlet', mapContext: '' });
    append(log, { kind: 'assistant', stop: 'stop', parts: [{ kind: 'text', text: 'The hamlet is built.', done: true }] });
    append(log, { kind: 'systemNote', note: 'review', text: '(system) Re-read the order and judge the map against its own words.' });
    append(log, { kind: 'assistant', stop: 'stop', parts: [{ kind: 'text', text: 'The arrival was weakest; fixed and closing.', done: true }] });
    append(log, { kind: 'jobEnd', outcome: 'done', summary: 'The arrival was weakest; fixed and closing.' });

    const dump = dumpRun(log, makeState(4, 4));
    expect(dump.transcript.turns).toEqual([
      { says: ['The hamlet is built.'], ops: [], note: '(system) Re-read the order and judge the map against its own words.' },
      { says: ['The arrival was weakest; fixed and closing.'], ops: [] },
    ]);
  });
});

describe('dumpRun: committed plans', () => {
  it('carries each plan event with its stage labels and the model turn it followed', () => {
    const log = createLog(() => 0);
    append(log, { kind: 'order', text: 'go', mapContext: '' });
    append(log, {
      kind: 'assistant', stop: 'tool-calls',
      parts: [{ kind: 'tool', callId: 'c1', name: 'update_plan', input: {}, argsDone: true }],
    });
    append(log, { kind: 'plan', stages: [{ label: 'terrace the hill' }, { label: 'plant the steps', checkpoint: true }], revision: 1 });
    append(log, { kind: 'toolResult', callId: 'c1', name: 'update_plan', content: 'Plan set.', isError: false });
    append(log, { kind: 'assistant', stop: 'stop', parts: [{ kind: 'text', text: 'done', done: true }] });
    append(log, { kind: 'jobEnd', outcome: 'done' });

    const dump = dumpRun(log, makeState(4, 4));
    expect(dump.plans).toEqual([{ revision: 1, turn: 1, stages: ['terrace the hill', 'plant the steps'] }]);
  });

  it('a run that committed no plan carries an empty list', () => {
    const dump = dumpRun(buildLog(), makeState(4, 4));
    expect(dump.plans).toEqual([]);
  });
});

describe('dumpRun: the claims sweep', () => {
  /** One order whose narration names catalog items; what stands on the grid varies per test. */
  function logSaying(...lines: string[]) {
    const log = createLog(() => 0);
    append(log, { kind: 'order', text: 'go', mapContext: '' });
    append(log, {
      kind: 'assistant', stop: 'stop',
      parts: lines.map((text) => ({ kind: 'text' as const, text, done: true })),
    });
    append(log, { kind: 'jobEnd', outcome: 'done' });
    return log;
  }

  it('lists a catalog item named in the says with no standing object of it, by en name, plural included', () => {
    const dump = dumpRun(logSaying('I planted two apple trees beside the door.'), makeState(4, 4));
    expect(dump.claims).toEqual([{ catalogId: 'tree-apple', name: 'Apple Tree' }]);
  });

  it('drops the claim once an object of that item stands on the map', () => {
    const grid = makeState(4, 4);
    grid.objects.set('t', { id: 't', catalogId: 'tree-apple', position: { x: 1, y: 1 }, rotation: 0, elevation: 0 });
    const dump = dumpRun(logSaying('I planted an apple tree beside the door.'), grid);
    expect(dump.claims).toEqual([]);
  });

  it('matches the zh name too, and never reads item names out of tool summaries or orders', () => {
    const grid = makeState(4, 4);
    const dump = dumpRun(logSaying('我在门口种了一棵苹果树。'), grid);
    expect(dump.claims).toEqual([{ catalogId: 'tree-apple', name: 'Apple Tree' }]);
  });

  it('a run that says nothing claims nothing, and a fabricated non-catalog structure is invisible to the sweep', () => {
    const dump = dumpRun(logSaying('The airport now dominates the northern coast.'), makeState(4, 4));
    expect(dump.claims).toEqual([]);
  });
});

describe('terrainArrays', () => {
  it('flattens tier/water in raster order at the grid dimensions', () => {
    const grid = makeState(3, 2);
    setTerrain(grid, 1, 0, TerrainType.Mountain, 3);
    setTerrain(grid, 2, 1, TerrainType.Water, 0);

    const arrays = terrainArrays(grid);
    expect(arrays.w).toBe(3);
    expect(arrays.h).toBe(2);
    expect(arrays.tier).toHaveLength(6);
    expect(arrays.water).toHaveLength(6);
    expect(arrays.tier).toEqual([0, 3, 0, 0, 0, 0]);
    expect(arrays.water).toEqual([-1, -1, -1, -1, -1, 0]);
  });

  it('objects carry the catalog category as kind, excluding locked objects', () => {
    const grid = makeState(3, 2);
    grid.objects.set('a', { id: 'a', catalogId: 'tree-apple', position: { x: 1, y: 0 }, rotation: 0, elevation: 0 });
    grid.objects.set('plaza', { id: 'plaza', catalogId: 'plaza', position: { x: 0, y: 0 }, rotation: 0, elevation: 0, locked: true });

    const arrays = terrainArrays(grid);
    expect(arrays.objects).toEqual([{ kind: 'tree', e: 0, x: 1, y: 0, w: 1, h: 1 }]);
  });
});
