/**
 * A place built from a drawing: draw_area lays the ground, the paving and the things a picture of
 * text marks, completes it by mirroring, repeats it as a tile, and is one undo step.
 */
import { describe, expect, it } from 'vitest';
import { createDefaultRegistry } from '../../../rules';
import { createExecutor } from '../../../state/executor';
import { executeToolCall, type AgentToolDeps } from '../../../agent/tools';
import { groundUnder } from '../../../agent/tools/serialize';
import { makeState } from '../../_support/map-state';

const call = (name: string, input: Record<string, unknown>) => ({ id: 't1', name, input });

function world(region: { x: number; y: number }[] = []) {
  const state = makeState(64, 48);
  const exec = createExecutor(state, createDefaultRegistry());
  const deps: AgentToolDeps = { getState: () => state, getExecutor: () => exec, getRegion: () => region };
  const run = async (input: Record<string, unknown>) => executeToolCall(call('draw_area', { reads_as: 'a test drawing', ...input }), deps);
  const at = (id: string) => [...state.objects.values()].filter((o) => o.catalogId === id).map((o) => `${o.position.x},${o.position.y}`).sort();
  const ground = (x: number, y: number) => groundUnder(state, x, y);
  return { state, exec, run, at, ground };
}

describe('draw_area', () => {
  it('lays water, paving and plants from one drawing, as one undo step', async () => {
    const { state, exec, run, at, ground } = world();
    const depth = exec.historyDepth();
    const done = await run({
      x: 10, y: 10,
      rows: [
        'ppppppppp',
        'p.......p',
        'p.~~~~~.p',
        'p.~~~~~.p',
        'p.~~~~~.p',
        'p.......p',
        'pppppppFp',
      ],
      legend: ['p=path-garden-stone', 'F=flower-rose'],
    });
    expect(done.isError, done.content).toBe(false);
    expect(at('path-garden-stone')).toHaveLength(27);
    expect(at('flower-rose')).toEqual(['17,16']);
    expect(ground(14, 13)).toEqual({ kind: 'water', elevation: 0 });
    expect(exec.historyDepth()).toBe(depth + 1);
    exec.undo();
    expect(state.objects.size).toBe(0);
    expect(ground(14, 13).kind).toBe('bare');
  });

  it('draws ground at a scale, each character a square of cells, and refuses things at a scale', async () => {
    const { run, ground, at } = world();
    const done = await run({ x: 10, y: 10, scale: 3, rows: ['11', '1.'] });
    expect(done.isError, done.content).toBe(false);
    expect(ground(11, 11)).toEqual({ kind: 'mountain', elevation: 1 });
    expect(ground(15, 12)).toEqual({ kind: 'mountain', elevation: 1 });
    expect(ground(11, 15)).toEqual({ kind: 'mountain', elevation: 1 });
    expect(ground(15, 15).kind).toBe('bare');
    const things = await run({ x: 30, y: 10, scale: 2, rows: ['1T'], legend: ['T=tree-apple'] });
    expect(things.isError).toBe(true);
    expect(at('tree-apple')).toEqual([]);
  });

  it('reads a run written as mark{count}, so a long row needs no counting by hand', async () => {
    const { run, ground } = world();
    const done = await run({ x: 10, y: 20, rows: ['1{6}.{4}', '1{2}.{8}'] });
    expect(done.isError, done.content).toBe(false);
    expect(ground(15, 20)).toEqual({ kind: 'mountain', elevation: 1 });
    expect(ground(18, 20).kind).toBe('bare');
    expect(ground(11, 21)).toEqual({ kind: 'mountain', elevation: 1 });
    expect(ground(18, 21).kind).toBe('bare');
  });

  it('names the rows whose length differs from the area it fills, and draws nothing', async () => {
    const { run, ground } = world();
    const done = await run({ x: 10, y: 30, x2: 12, rows: ['111', '1111', '111'] });
    expect(done.isError).toBe(true);
    expect(done.content).toContain('row 2 is 4 long where the others are 3');
    expect(ground(10, 30).kind).toBe('bare');
  });

  it('gives a tree drawn inside water its own islet', async () => {
    const { run, at, ground } = world();
    const done = await run({ x: 20, y: 20, rows: ['~~~~~', '~~T~~', '~~~~~'], legend: ['T=tree-apple'] });
    expect(done.isError, done.content).toBe(false);
    expect(at('tree-apple')).toEqual(['22,21']);
    expect(ground(22, 21).kind).toBe('bare');
    expect(ground(20, 20)).toEqual({ kind: 'water', elevation: 0 });
    expect(ground(24, 22)).toEqual({ kind: 'water', elevation: 0 });
  });

  it('mirrors a quarter into a whole that matches on both axes', async () => {
    const { run, at } = world();
    const done = await run({ x: 10, y: 10, rows: ['T.F', '...', 'F.~'], legend: ['T=tree-apple', 'F=flower-rose'], mirror: 'xy' });
    expect(done.isError, done.content).toBe(false);
    expect(at('tree-apple')).toEqual(['10,10', '10,14', '14,10', '14,14']);
    expect(at('flower-rose')).toEqual(['10,12', '12,10', '12,14', '14,12']);
  });

  it('doubles the seam for an even size', async () => {
    const { run, at } = world();
    const done = await run({ x: 10, y: 10, rows: ['T.'], legend: ['T=tree-apple'], mirror: 'x', seam: 'doubled' });
    expect(done.isError, done.content).toBe(false);
    expect(at('tree-apple')).toEqual(['10,10', '13,10']);
  });

  it('completes a half to the size of the area named, sharing the middle only when the size is odd', async () => {
    const { run, at } = world();
    const odd = await run({ x: 10, y: 10, x2: 14, rows: ['T.F'], legend: ['T=tree-apple', 'F=flower-rose'], mirror: 'x' });
    expect(odd.isError, odd.content).toBe(false);
    expect(at('flower-rose')).toEqual(['12,10']);
    const even = await run({ x: 10, y: 20, x2: 15, rows: ['T.F'], legend: ['T=tree-apple', 'F=flower-rose'], mirror: 'x' });
    expect(even.isError, even.content).toBe(false);
    expect(at('flower-rose')).toEqual(['12,10', '12,20', '13,20']);
    const short = await run({ x: 10, y: 30, x2: 20, rows: ['T.F'], legend: ['T=tree-apple', 'F=flower-rose'], mirror: 'x' });
    expect(short.isError).toBe(true);
    expect(short.content).toMatch(/Draw 6 columns/);
    expect(at('tree-apple')).toHaveLength(4);
  });

  it('repeats the drawing as a tile with a gap', async () => {
    const { run, at } = world();
    const done = await run({ x: 10, y: 10, rows: ['T..'], legend: ['T=tree-apple'], repeatX: 3, repeatY: 2, gapY: 2 });
    expect(done.isError, done.content).toBe(false);
    expect(at('tree-apple')).toEqual(['10,10', '10,13', '13,10', '13,13', '16,10', '16,13']);
  });

  it('raises ground by its digit and stands a marked thing on it', async () => {
    const { run, at, ground } = world();
    const done = await run({ x: 10, y: 10, rows: ['22222', '22t22', '22222'], legend: ['t=2+tree-apple'] });
    expect(done.isError, done.content).toBe(false);
    expect(ground(12, 11)).toEqual({ kind: 'mountain', elevation: 2 });
    expect(at('tree-apple')).toEqual(['12,11']);
  });

  it('sinks a pool drawn on raised ground into that ground', async () => {
    const { run, ground } = world();
    const done = await run({ x: 10, y: 10, rows: ['1111111', '1111111', '11~~~11', '11~~~11', '1111111', '1111111'] });
    expect(done.isError, done.content).toBe(false);
    expect(ground(13, 12)).toEqual({ kind: 'water', elevation: 1 });
    expect(ground(10, 10)).toEqual({ kind: 'mountain', elevation: 1 });
  });

  it('keeps the shape of the figure where two kinds of ground meet', async () => {
    const { run, ground } = world();
    // A canal one mark wide through a terrace, and a letter stroke of land one mark wide in a lake.
    const canal = await run({ x: 10, y: 10, rows: ['1111111', '1111111', '1~~~~~1', '1111111', '1111111'] });
    expect(canal.isError, canal.content).toBe(false);
    expect(ground(13, 12)).toEqual({ kind: 'water', elevation: 1 });
    const stroke = await run({ x: 30, y: 10, rows: ['~~~~~~~', '~~~~~~~', '~~000~~', '~~~~~~~', '~~~~~~~'] });
    expect(stroke.isError, stroke.content).toBe(false);
    expect(ground(33, 12).kind).toBe('bare');
    expect(ground(33, 10)).toEqual({ kind: 'water', elevation: 0 });
  });

  it('stands a thing with no level of its own on the ground drawn around it', async () => {
    const { run, at, ground } = world();
    const done = await run({ x: 10, y: 10, rows: ['11111', '11T11', '1ppp1', '11111'], legend: ['T=tree-apple', 'p=path-garden-stone'] });
    expect(done.isError, done.content).toBe(false);
    expect(at('tree-apple')).toEqual(['12,11']);
    expect(ground(12, 11)).toEqual({ kind: 'mountain', elevation: 1 });
    expect(ground(12, 12)).toEqual({ kind: 'mountain', elevation: 1 });
    expect(at('path-garden-stone')).toHaveLength(3);
  });

  it('stands a larger building from one mark at its top-left cell, or from a block of its size', async () => {
    const { state, run } = world();
    const one = await run({ x: 6, y: 6, rows: ['h.....', '......', '......', '......'], legend: ['h=building-forest-cabin'] });
    expect(one.isError, one.content).toBe(false);
    const block = await run({ x: 30, y: 6, rows: ['wwwww', 'wwwww', 'wwwww', 'wwwww'], legend: ['w=building-wave-cabin'] });
    expect(block.isError, block.content).toBe(false);
    const homes = [...state.objects.values()].filter((o) => o.catalogId.startsWith('building-'));
    expect(homes.map((o) => `${o.catalogId} ${o.position.x},${o.position.y}`).sort()).toEqual(['building-forest-cabin 6,6', 'building-wave-cabin 30,6']);
  });

  it('draws nothing when the drawing leaves the region it may edit', async () => {
    const region = [];
    for (let y = 10; y <= 20; y++) for (let x = 10; x <= 20; x++) region.push({ x, y });
    const { state, run } = world(region);
    const done = await run({ x: 18, y: 10, rows: ['TTTTT'.replace(/T/g, 'F')], legend: ['F=flower-rose'] });
    expect(done.isError).toBe(true);
    expect(done.content).toMatch(/outside the region/);
    expect(state.objects.size).toBe(0);
  });

  it('skips what is already there, and replaces it only when asked', async () => {
    const { run, at } = world();
    await run({ x: 10, y: 10, rows: ['F.F'], legend: ['F=flower-rose'] });
    const again = await run({ x: 10, y: 10, rows: ['FTF'], legend: ['F=flower-rose', 'T=tree-apple'] });
    expect(again.content).toMatch(/already there/);
    expect(at('flower-rose')).toHaveLength(2);
    const swapped = await run({ x: 10, y: 10, rows: ['D.D'], legend: ['D=flower-daisy'], replace: true });
    expect(swapped.isError, swapped.content).toBe(false);
    expect(at('flower-rose')).toHaveLength(0);
    expect(at('flower-daisy')).toHaveLength(2);
  });

  it('lets the legend use a letter that a map read uses for something else', async () => {
    const { run, at } = world();
    const done = await run({ x: 10, y: 10, rows: ['PoP'], legend: ['P=path-garden-stone', 'o=flower-rose'] });
    expect(done.isError, done.content).toBe(false);
    expect(at('path-garden-stone')).toHaveLength(2);
    expect(at('flower-rose')).toEqual(['11,10']);
  });

  it('turns a mirrored print to face the other way', async () => {
    const { state, run } = world();
    const done = await run({ x: 10, y: 10, rows: ['c..'], legend: ['c=print-field-corner'], mirror: 'x', seam: 'doubled' });
    expect(done.isError, done.content).toBe(false);
    const corners = [...state.objects.values()].filter((o) => o.catalogId === 'print-field-corner');
    expect(corners).toHaveLength(2);
    expect(new Set(corners.map((o) => o.rotation)).size).toBe(2);
  });

  it('fits mirrored copies laid side by side to the area named', async () => {
    const { run, at } = world();
    const done = await run({ x: 10, y: 10, x2: 29, rows: ['F....'], legend: ['F=flower-rose'], mirror: 'x', repeatX: 2 });
    expect(done.isError, done.content).toBe(false);
    expect(at('flower-rose')).toEqual(['10,10', '19,10', '20,10', '29,10']);
  });

  it('says what was already as drawn, and changes nothing the second time', async () => {
    const { exec, run } = world();
    const rows = ['111', '1~1', '111'];
    expect((await run({ x: 10, y: 10, rows })).isError).toBe(false);
    const depth = exec.historyDepth();
    const again = await run({ x: 10, y: 10, rows });
    expect(again.isError, again.content).toBe(false);
    expect(again.content).toMatch(/already as drawn/);
    expect(again.content).not.toMatch(/raised ground on/);
    expect(exec.historyDepth()).toBe(depth);
  });

  it('replace leaves paving under a ground-only mark and names a larger thing it removes', async () => {
    const { run, at } = world();
    await run({ x: 10, y: 10, rows: ['ppp'], legend: ['p=path-garden-stone'] });
    const ground = await run({ x: 10, y: 10, rows: ['000'], replace: true });
    expect(ground.isError, ground.content).toBe(false);
    expect(at('path-garden-stone')).toHaveLength(3);
    await run({ x: 30, y: 10, rows: ['h'], legend: ['h=building-forest-cabin'] });
    const over = await run({ x: 30, y: 10, rows: ['F'], legend: ['F=flower-rose'], replace: true });
    expect(over.content).toMatch(/building-forest-cabin at \(30,10\)/);
    expect(at('building-forest-cabin')).toHaveLength(0);
  });

  it('does not take a thing facing another way for the thing drawn', async () => {
    const { state, run } = world();
    await run({ x: 10, y: 10, rows: ['s'], legend: ['s=building-stall'] });
    const turned = await run({ x: 10, y: 10, rows: ['s'], legend: ['s=building-stall@90'] });
    expect(turned.content).not.toMatch(/already there/);
    expect(turned.content).toMatch(/facing 0/);
    const swapped = await run({ x: 10, y: 10, rows: ['s'], legend: ['s=building-stall@90'], replace: true });
    expect(swapped.isError, swapped.content).toBe(false);
    expect([...state.objects.values()].filter((o) => o.catalogId === 'building-stall').map((o) => o.rotation)).toEqual([90]);
  });

  it('raises the level drawn under a building\'s own footprint, and says when the building cannot stand', async () => {
    const { run, ground } = world();
    // The platform is exactly the footprint, so the building has no level margin and is refused by name.
    const done = await run({ x: 10, y: 10, rows: ['h1111', '11111', '11111', '11111'], legend: ['h=building-forest-cabin'] });
    expect(ground(12, 12)).toEqual({ kind: 'mountain', elevation: 1 });
    expect(done.content).toMatch(/h building-forest-cabin: 0\/1, 1 refused/);
  });

  it('names an undefined mark instead of guessing', async () => {
    const { run } = world();
    const done = await run({ x: 10, y: 10, rows: ['QQ'], legend: [] });
    expect(done.isError).toBe(true);
    expect(done.content).toMatch(/"Q"/);
  });
});
