/**
 * A build is not finished while it holds faults that need no judgment to see: sides meant to match
 * that do not, in objects, water and raised ground alike, and paths a visitor cannot walk.
 */
import { describe, expect, it } from 'vitest';
import { createDefaultRegistry } from '../../../rules';
import { createExecutor } from '../../../state/executor';
import { executeToolCall, type AgentToolDeps } from '../../../agent/tools';
import { auditBuild } from '../../../agent/tools/audit';
import { makeState } from '../../_support/map-state';

const call = (name: string, input: Record<string, unknown>) => ({ id: 't1', name, input });
const BOX = { x1: 4, y1: 4, x2: 35, y2: 27 };

function world() {
  const state = makeState(40, 32);
  const exec = createExecutor(state, createDefaultRegistry());
  const deps: AgentToolDeps = { getState: () => state, getExecutor: () => exec, getRegion: () => [] };
  const run = async (name: string, input: Record<string, unknown>) => {
    const done = await executeToolCall(call(name, input), deps);
    if (done.isError) throw new Error(done.content);
  };
  return { state, run };
}

/** One side of a court: a bed of roses and a column of daisies, west of the line between 19 and 20. */
async function west(run: ReturnType<typeof world>['run']): Promise<void> {
  await run('scatter_objects', { catalogIds: ['flower-rose'], count: 40, x1: 8, y1: 8, x2: 13, y2: 11, pattern: 'fill' });
  await run('scatter_objects', { catalogIds: ['flower-daisy'], count: 40, x1: 16, y1: 8, x2: 16, y2: 15, pattern: 'fill' });
}

describe('auditBuild', () => {
  it('finds no fault about the line a side was mirrored across', async () => {
    const { state, run } = world();
    await west(run);
    await run('mirror_area', { x1: 6, y1: 6, x2: 18, y2: 18, axisX: 19.5 });
    expect(auditBuild(state, BOX).join('\n')).not.toMatch(/vertical line/);
  });

  it('names the cells of a second side built one cell off', async () => {
    const { state, run } = world();
    await west(run);
    await run('scatter_objects', { catalogIds: ['flower-rose'], count: 40, x1: 27, y1: 8, x2: 32, y2: 11, pattern: 'fill' });
    await run('scatter_objects', { catalogIds: ['flower-daisy'], count: 40, x1: 23, y1: 8, x2: 23, y2: 15, pattern: 'fill' });
    const found = auditBuild(state, BOX).join('\n');
    expect(found).toMatch(/meant to match/);
    expect(found).toMatch(/flower-rose on \(\d+,\d+\) has nothing at its mirror cell/);
  });

  it('names water that sits off the line the planting is symmetric about', async () => {
    const { state, run } = world();
    await west(run);
    await run('mirror_area', { x1: 6, y1: 6, x2: 18, y2: 18, axisX: 19.5 });
    await run('paint_terrain', { terrain: 'water', elevation: 0, shape: 'rect', x1: 17, y1: 20, x2: 20, y2: 23 });
    expect(auditBuild(state, BOX).join('\n')).toMatch(/water0 on \(\d+,\d+\) has nothing at its mirror cell/);
  });

  it('names a home whose door has no path', async () => {
    const { state, run } = world();
    await run('place_object', { catalogId: 'building-myhouse', x: 10, y: 6 });
    await run('build_road', { catalogId: 'path-rustic-dirt', shape: 'line', x1: 30, y1: 20, x2: 34, y2: 20 });
    expect(auditBuild(state, BOX).join('\n')).toMatch(/no path on/);
  });
});

describe('auditBuild: paths that leave the rectangle', () => {
  it('takes two paths joined outside the rectangle as one network', async () => {
    const { state, run } = world();
    // Two stubs inside the box, both running out of it to one street beyond its south edge.
    await run('build_road', { catalogId: 'path-rustic-dirt', shape: 'line', x1: 10, y1: 20, x2: 10, y2: 29 });
    await run('build_road', { catalogId: 'path-rustic-dirt', shape: 'line', x1: 30, y1: 20, x2: 30, y2: 29 });
    await run('build_road', { catalogId: 'path-rustic-dirt', shape: 'line', x1: 10, y1: 29, x2: 30, y2: 29 });
    expect(auditBuild(state, { x1: 4, y1: 4, x2: 35, y2: 24 }).join('\n')).not.toMatch(/not joined/);
  });

  it('takes two paths joined by a stair that stands on a half cell as one path', async () => {
    const { state, run } = world();
    await run('build_road', { catalogId: 'path-rustic-dirt', shape: 'line', x1: 20, y1: 16, x2: 20, y2: 22 });
    await run('build_road', { catalogId: 'path-rustic-dirt', shape: 'line', x1: 20, y1: 8, x2: 20, y2: 13 });
    // A stair two wide centred on a path one wide is anchored half a cell to its left.
    state.objects.set('stair', { id: 'stair', catalogId: 'ramp-park-steps', position: { x: 19.5, y: 14 }, rotation: 0, elevation: 0 });
    expect(auditBuild(state, BOX).join('\n')).not.toMatch(/not joined/);
  });

  it('still names a path joined to nothing', async () => {
    const { state, run } = world();
    await run('build_road', { catalogId: 'path-rustic-dirt', shape: 'line', x1: 10, y1: 20, x2: 20, y2: 20 });
    await run('build_road', { catalogId: 'path-rustic-dirt', shape: 'line', x1: 26, y1: 10, x2: 30, y2: 10 });
    expect(auditBuild(state, BOX).join('\n')).toMatch(/5 path cells near \(26,10\) are not joined/);
  });

  it('counts a path in front of a door when that path lies outside the rectangle', async () => {
    const { state, run } = world();
    await run('place_object', { catalogId: 'building-myhouse', x: 10, y: 6 });
    // The house's door faces south; the street in front of it lies just below the box.
    await run('build_road', { catalogId: 'path-rustic-dirt', shape: 'line', x1: 6, y1: 10, x2: 24, y2: 10 });
    await run('build_road', { catalogId: 'path-rustic-dirt', shape: 'line', x1: 6, y1: 8, x2: 6, y2: 10 });
    expect(auditBuild(state, { x1: 4, y1: 4, x2: 35, y2: 9 }).join('\n')).not.toMatch(/no path on/);
  });
});

describe('auditBuild: spacing, water and islands', () => {
  it('names water left in two pieces a cell apart', async () => {
    const { state, run } = world();
    await run('paint_terrain', { terrain: 'water', elevation: 0, shape: 'rect', x1: 10, y1: 6, x2: 11, y2: 12 });
    await run('paint_terrain', { terrain: 'water', elevation: 0, shape: 'rect', x1: 10, y1: 15, x2: 11, y2: 22 });
    const found = auditBuild(state, BOX).join('\n');
    expect(found).toMatch(/water is in two pieces/);
    // The ponds lie under cells 10..11 by 6..12 and 15..22, so the dry cells between them are rows 13 and 14.
    expect(found).toContain('(10,13)-(11,14)');
  });

  it('takes two ponds that mirror each other as a pair, and two that do not as a break', async () => {
    const pair = world();
    await pair.run('paint_terrain', { terrain: 'water', elevation: 0, shape: 'rect', x1: 8, y1: 10, x2: 11, y2: 13 });
    await pair.run('paint_terrain', { terrain: 'water', elevation: 0, shape: 'rect', x1: 8, y1: 14, x2: 9, y2: 15 });
    await pair.run('paint_terrain', { terrain: 'water', elevation: 0, shape: 'rect', x1: 14, y1: 10, x2: 17, y2: 13 });
    await pair.run('paint_terrain', { terrain: 'water', elevation: 0, shape: 'rect', x1: 16, y1: 14, x2: 17, y2: 15 });
    expect(auditBuild(pair.state, BOX).join('\n')).not.toMatch(/water is in two pieces/);
    const repeat = world();
    await repeat.run('paint_terrain', { terrain: 'water', elevation: 0, shape: 'rect', x1: 8, y1: 10, x2: 11, y2: 13 });
    await repeat.run('paint_terrain', { terrain: 'water', elevation: 0, shape: 'rect', x1: 8, y1: 14, x2: 9, y2: 15 });
    await repeat.run('paint_terrain', { terrain: 'water', elevation: 0, shape: 'rect', x1: 14, y1: 10, x2: 17, y2: 13 });
    await repeat.run('paint_terrain', { terrain: 'water', elevation: 0, shape: 'rect', x1: 14, y1: 14, x2: 15, y2: 15 });
    expect(auditBuild(repeat.state, BOX).join('\n')).toMatch(/water is in two pieces/);
  });

  it('names a row of one species whose gaps differ, and passes an even one', async () => {
    const even = world();
    await even.run('scatter_objects', { catalogIds: ['flower-rose'], count: 20, x1: 8, y1: 10, x2: 26, y2: 10, pattern: 'grid', step: 3 });
    expect(auditBuild(even.state, BOX).join('\n')).not.toMatch(/uneven gaps/);
    const uneven = world();
    for (const x of [8, 10, 12, 15, 17, 19]) await uneven.run('place_object', { catalogId: 'flower-rose', x, y: 10 });
    expect(auditBuild(uneven.state, BOX).join('\n')).toMatch(/uneven gaps/);
  });
});

describe('check_build', () => {
  it('reports the audit of a rectangle, and says so when it finds nothing', async () => {
    const { state, run } = world();
    const deps: AgentToolDeps = { getState: () => state, getExecutor: () => createExecutor(state, createDefaultRegistry()), getRegion: () => [] };
    expect((await executeToolCall(call('check_build', BOX), deps)).content).toMatch(/^No fault found/);
    await run('place_object', { catalogId: 'building-myhouse', x: 10, y: 6 });
    await run('build_road', { catalogId: 'path-rustic-dirt', shape: 'line', x1: 30, y1: 20, x2: 34, y2: 20 });
    expect((await executeToolCall(call('check_build', BOX), deps)).content).toMatch(/no path on/);
  });

  it('reads a rectangle far larger than the map as the whole map', async () => {
    const { state, run } = world();
    const deps: AgentToolDeps = { getState: () => state, getExecutor: () => createExecutor(state, createDefaultRegistry()), getRegion: () => [] };
    await run('paint_terrain', { terrain: 'water', elevation: 0, shape: 'rect', x1: 10, y1: 6, x2: 11, y2: 12 });
    await run('paint_terrain', { terrain: 'water', elevation: 0, shape: 'rect', x1: 10, y1: 15, x2: 11, y2: 22 });
    const whole = await executeToolCall(call('check_build', { x1: 0, y1: 0, x2: 39, y2: 31 }), deps);
    const beyond = await executeToolCall(call('check_build', { x1: -40000000, y1: -40000000, x2: 40000000, y2: 40000000 }), deps);
    expect(whole.content).toMatch(/water is in two pieces/);
    expect(beyond.content).toBe(whole.content);
  });
});
