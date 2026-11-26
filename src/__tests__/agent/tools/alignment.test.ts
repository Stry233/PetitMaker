/**
 * The assistant names object cells only: terrain painted under a rectangle of cells lies centred on
 * it, so the same numbers are symmetric for water, platforms and the objects around them. The tools
 * name the nearest clear cells around a painted rectangle, and a building's door with the cell its
 * path ends on.
 */
import { describe, expect, it } from 'vitest';
import { createDefaultRegistry } from '../../../rules';
import { createExecutor } from '../../../state/executor';
import { executeToolCall, type AgentToolDeps } from '../../../agent/tools';
import { TerrainType } from '../../../core/model/types';
import { terrainCellRect } from '../../../core/grid/grid-convert';
import { objectRect } from '../../../state/object-geometry';
import { makeState } from '../../_support/map-state';

const call = (name: string, input: Record<string, unknown>) => ({ id: 't1', name, input });

function world() {
  const state = makeState(40, 32);
  const exec = createExecutor(state, createDefaultRegistry());
  const deps: AgentToolDeps = { getState: () => state, getExecutor: () => exec, getRegion: () => [] };
  const cellsOf = (id: string): string[] => [...state.objects.values()].filter((o) => o.catalogId === id)
    .map((o) => `${o.position.x},${o.position.y}`).sort();
  return { state, deps, cellsOf };
}

const POND = { x1: 10, y1: 10, x2: 15, y2: 13 };

describe('a painted rectangle against the object grid', () => {
  it('[ASST-35] reports the nearest clear cells around a pond, the same distance out on every side', async () => {
    const { deps } = world();
    const painted = await executeToolCall(call('paint_terrain', { shape: 'rect', ...POND, terrain: 'water', elevation: 0 }), deps);
    expect(painted.isError).toBe(false);
    expect(painted.content).toContain('(8,8)-(17,15)');
    const place = (x: number, y: number) => executeToolCall(call('place_object', { catalogId: 'flower-rose', x, y }), deps);
    // Two cells out from the pond's first and last cells on each axis stand clear.
    expect((await place(8, 11)).isError).toBe(false);
    expect((await place(17, 11)).isError).toBe(false);
    expect((await place(12, 8)).isError).toBe(false);
    expect((await place(12, 15)).isError).toBe(false);
    // The cells touching it rest partly on water, and the pond's own cells wholly.
    expect((await place(9, 11)).isError).toBe(true);
    expect((await place(16, 11)).isError).toBe(true);
    expect((await place(12, 9)).isError).toBe(true);
    expect((await place(12, 14)).isError).toBe(true);
    expect((await place(10, 10)).isError).toBe(true);
    expect((await place(15, 13)).isError).toBe(true);
  });

  it('lands a border on the reported rectangle with every cell taken and none refused', async () => {
    const { deps, cellsOf } = world();
    await executeToolCall(call('paint_terrain', { shape: 'rect', ...POND, terrain: 'water', elevation: 0 }), deps);
    const done = await executeToolCall(call('scatter_objects', { catalogIds: ['flower-rose'], count: 80, x1: 8, y1: 8, x2: 17, y2: 15, pattern: 'border' }), deps);
    expect(done.isError).toBe(false);
    const placed = cellsOf('flower-rose');
    expect(placed).toHaveLength(2 * 10 + 2 * 6);
    expect(placed.every((key) => { const [x, y] = key.split(',').map(Number); return x === 8 || x === 17 || y === 8 || y === 15; })).toBe(true);
  });
});

/** The cells of an inspect_region grid showing any of `tokens`, read off its rulers. */
function cellsShowing(grid: string, x1: number, tokens: string): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (const row of grid.split('\n')) {
    const m = /^ *(\d+) (.*)$/.exec(row);
    if (!m || row.startsWith('Legend')) continue;
    [...m[2]!].forEach((token, i) => { if (tokens.includes(token)) out.push({ x: x1 + i, y: Number(m[1]) }); });
  }
  return out;
}

describe('one set of numbers for terrain and objects', () => {
  it('[ASST-35] centres water and a block of objects given the same rectangle on the same point', async () => {
    const wet = world(), planted = world();
    await executeToolCall(call('paint_terrain', { shape: 'rect', ...POND, terrain: 'water', elevation: 0 }), wet.deps);
    const filled = await executeToolCall(call('scatter_objects', { catalogIds: ['flower-rose'], count: 200, ...POND, pattern: 'fill' }), planted.deps);
    expect(filled.isError).toBe(false);
    const centre = (rects: { x: number; y: number; w: number; h: number }[]) => {
      const x1 = Math.min(...rects.map((r) => r.x)), x2 = Math.max(...rects.map((r) => r.x + r.w));
      const y1 = Math.min(...rects.map((r) => r.y)), y2 = Math.max(...rects.map((r) => r.y + r.h));
      return { x: (x1 + x2) / 2, y: (y1 + y2) / 2 };
    };
    const water: { x: number; y: number; w: number; h: number }[] = [];
    wet.state.cells.forEach((row, y) => row.forEach((cell, x) => { if (cell.terrain?.type === TerrainType.Water) water.push(terrainCellRect({ x, y })); }));
    const roses = [...planted.state.objects.values()].map((o) => objectRect(o));
    expect(roses).toHaveLength(6 * 4);
    expect(centre(water)).toEqual(centre(roses));
    expect(centre(roses)).toEqual({ x: 13, y: 12 });
  });

  it('[ASST-35] reads a region back as the cells that were painted, and painting those again changes nothing', async () => {
    const { state, deps } = world();
    const arm = [{ x: 16, y: 13 }, { x: 17, y: 13 }, { x: 18, y: 13 }, { x: 18, y: 14 }, { x: 18, y: 15 }];
    await executeToolCall(call('paint_terrain', { shape: 'rect', ...POND, terrain: 'water', elevation: 0 }), deps);
    await executeToolCall(call('paint_terrain', { shape: 'cells', cells: arm, terrain: 'water', elevation: 0 }), deps);
    const read = await executeToolCall(call('inspect_region', { x1: 5, y1: 5, x2: 25, y2: 20 }), deps);
    const reported = cellsShowing(read.content, 5, 'A');
    const key = (c: { x: number; y: number }) => `${c.x},${c.y}`;
    const asked = [...arm];
    for (let y = POND.y1; y <= POND.y2; y++) for (let x = POND.x1; x <= POND.x2; x++) asked.push({ x, y });
    expect(reported.map(key).sort()).toEqual(asked.map(key).sort());
    // The cells touching the water read as its bank, never as water or open ground.
    expect(cellsShowing(read.content, 5, '=').map(key)).toEqual(expect.arrayContaining(['9,11', '16,11', '12,9', '12,14']));
    const before = JSON.stringify(state.cells);
    const again = await executeToolCall(call('paint_terrain', { shape: 'cells', cells: reported, terrain: 'water', elevation: 0 }), deps);
    expect(again.isError).toBe(false);
    expect(JSON.stringify(state.cells)).toBe(before);
  });

  it('[ASST-35] takes objects on exactly the rectangle a platform was raised under', async () => {
    const { state, deps } = world();
    const top = { x1: 10, y1: 8, x2: 21, y2: 15 };
    expect((await executeToolCall(call('raise_platform', { ...top, elevation: 1, access: 'south' }), deps)).isError).toBe(false);
    const read = await executeToolCall(call('inspect_region', { x1: 6, y1: 4, x2: 25, y2: 19 }), deps);
    const inside = (c: { x: number; y: number }) => c.x >= top.x1 && c.x <= top.x2 && c.y >= top.y1 && c.y <= top.y2;
    const raised = cellsShowing(read.content, 6, '1');
    expect(raised.every(inside)).toBe(true);
    // Every cell of the rectangle is raised ground or the ramp standing on it.
    expect(cellsShowing(read.content, 6, '1o').filter(inside)).toHaveLength(12 * 8);
    const place = (x: number, y: number) => executeToolCall(call('place_object', { catalogId: 'flower-rose', x, y }), deps);
    for (const [x, y] of [[10, 8], [21, 8], [15, 11]] as const) {
      expect((await place(x, y)).isError).toBe(false);
      expect([...state.objects.values()].find((o) => o.position.x === x && o.position.y === y)?.elevation).toBe(1);
    }
    // One cell out on the sides without the ramp rests half on the platform and is refused.
    for (const [x, y] of [[9, 11], [22, 11], [15, 7]] as const) expect((await place(x, y)).isError).toBe(true);
    for (const [x, y] of [[8, 11], [23, 11], [15, 6]] as const) expect((await place(x, y)).isError).toBe(false);
  });
});

describe('a building in an object line', () => {
  it('names its door and the cell a path ends on, turned with the building', async () => {
    const { deps } = world();
    const south = await executeToolCall(call('place_object', { catalogId: 'building-myhouse', x: 20, y: 6 }), deps);
    expect(south.isError).toBe(false);
    const door = /door=\((\d+),(\d+)\) faces (\w+), path ends at \((\d+),(\d+)\)/.exec(south.content)!;
    expect(door[3]).toBe('south');
    expect(Number(door[4])).toBe(Number(door[1]));
    expect(Number(door[5])).toBe(Number(door[2]) + 1);
    const road = await executeToolCall(call('build_road', { catalogId: 'path-rustic-dirt', shape: 'line', x1: Number(door[4]), y1: Number(door[5]), x2: Number(door[4]), y2: Number(door[5]) + 4 }), deps);
    expect(road.isError).toBe(false);
    const listed = await executeToolCall(call('get_objects', { category: 'building' }), deps);
    expect(listed.content).toContain(door[0]);
  });
});

describe('raise_platform', () => {
  it('raises the rectangle and stands a ramp on the side asked for, as one undo step', async () => {
    const state = makeState(40, 32);
    const exec = createExecutor(state, createDefaultRegistry());
    const deps: AgentToolDeps = { getState: () => state, getExecutor: () => exec, getRegion: () => [] };
    const depth = exec.historyDepth();
    const done = await executeToolCall(call('raise_platform', { x1: 10, y1: 8, x2: 21, y2: 15, elevation: 1, access: 'south' }), deps);
    expect(done.isError).toBe(false);
    expect(state.cells[10]![14]!.terrain?.elevation).toBe(1);
    const ramps = [...state.objects.values()].filter((o) => o.catalogId.startsWith('ramp'));
    expect(ramps).toHaveLength(1);
    // Columns 10..21 have their middle on the line between 15 and 16, and so does the ramp.
    const stands = objectRect(ramps[0]!);
    expect(stands.x + stands.w / 2).toBe(16);
    expect(stands.y).toBeGreaterThanOrEqual(14);
    expect(done.content).toContain(`stands at (${ramps[0]!.position.x},${ramps[0]!.position.y})`);
    expect(exec.historyDepth()).toBe(depth + 1);
    exec.undo();
    expect(state.cells[10]![14]!.terrain ?? null).toBeNull();
    expect([...state.objects.values()].some((o) => o.catalogId.startsWith('ramp'))).toBe(false);
  });

  it('refuses a rectangle that runs off the map and raises none of it', async () => {
    const { state, deps } = world();
    const before = JSON.stringify(state.cells);
    for (const box of [{ x1: 34, y1: 8, x2: 43, y2: 15 }, { x1: 10, y1: -3, x2: 21, y2: 6 }, { x1: -40000000, y1: -40000000, x2: 40000000, y2: 40000000 }]) {
      const done = await executeToolCall(call('raise_platform', { ...box, elevation: 1, access: 'south' }), deps);
      expect(done.isError).toBe(true);
      expect(done.content).not.toMatch(/Raised/);
    }
    expect(JSON.stringify(state.cells)).toBe(before);
    expect(state.objects.size).toBe(0);
  });

  it('names the cell the ramp landed on, centred on a side it turns to face', async () => {
    const { state, deps } = world();
    const done = await executeToolCall(call('raise_platform', { x1: 20, y1: 8, x2: 27, y2: 15, elevation: 1, access: 'west' }), deps);
    expect(done.isError).toBe(false);
    const ramp = [...state.objects.values()].find((o) => o.catalogId.startsWith('ramp'))!;
    const stands = objectRect(ramp);
    // Rows 8..15 have their middle on the line between 11 and 12.
    expect(stands.y + stands.h / 2).toBe(12);
    expect(stands.x + stands.w).toBeLessThanOrEqual(21);
    expect(done.content).toContain(`stands at (${ramp.position.x},${ramp.position.y})`);
  });

  it('says so when the rules refuse the ground, and never reports it raised', async () => {
    const { state, deps } = world();
    state.lockedLayers.add(1);
    const done = await executeToolCall(call('raise_platform', { x1: 10, y1: 8, x2: 21, y2: 15, elevation: 1, access: 'south' }), deps);
    expect(done.isError).toBe(true);
    expect(done.content).not.toMatch(/Raised a/);
    expect(done.content).toMatch(/locked/i);
    expect(state.cells[10]![14]!.terrain ?? null).toBeNull();
    expect(state.objects.size).toBe(0);
  });

  it('refuses a rectangle that standing objects occupy', async () => {
    const { deps } = world();
    await executeToolCall(call('place_object', { catalogId: 'flower-rose', x: 12, y: 10 }), deps);
    expect((await executeToolCall(call('raise_platform', { x1: 10, y1: 8, x2: 21, y2: 15, elevation: 1, access: 'south' }), deps)).isError).toBe(true);
  });
});

describe('a shape drawn as rows of text', () => {
  it('paints exactly the marked cells, so an outline that is its own mirror image lands symmetric', async () => {
    const { state, deps } = world();
    const picture = ['.##.##.', '#######', '#######', '.#####.', '..###..', '...#...'];
    const done = await executeToolCall(call('paint_terrain', { shape: 'picture', x1: 10, y1: 10, picture, terrain: 'water', elevation: 0 }), deps);
    expect(done.isError).toBe(false);
    // Read back in the cells the model works in: an object cell is water when everything under it is.
    const read = await executeToolCall(call('inspect_region', { x1: 9, y1: 9, x2: 17, y2: 16 }), deps);
    expect(read.isError).toBe(false);
    const water = state.cells[11]![13]!.terrain!.type;
    const wet = (x: number, y: number): boolean => [[x, y], [x + 1, y], [x, y + 1], [x + 1, y + 1]]
      .every(([tx, ty]) => state.cells[ty!]?.[tx!]?.terrain?.type === water);
    for (let dy = 0; dy < picture.length; dy++) {
      for (let dx = 0; dx < 7; dx++) expect(wet(10 + dx, 10 + dy), `(${dx},${dy})`).toBe(wet(10 + 6 - dx, 10 + dy));
    }
    expect(wet(13, 12)).toBe(true);
    expect(wet(10, 10)).toBe(false);
  });

  it('lets each character stand for a square of cells at a scale, for outlines at island size', async () => {
    const { state, deps } = world();
    const done = await executeToolCall(call('paint_terrain', { shape: 'picture', x1: 10, y1: 10, scale: 3, picture: ['#.', '.#'], terrain: 'water', elevation: 0 }), deps);
    expect(done.isError).toBe(false);
    const water = TerrainType.Water;
    const wet = (x: number, y: number): boolean => [[x, y], [x + 1, y], [x, y + 1], [x + 1, y + 1]]
      .every(([tx, ty]) => state.cells[ty!]?.[tx!]?.terrain?.type === water);
    for (const [x, y] of [[10, 10], [12, 12], [13, 13], [15, 15]]) expect(wet(x!, y!), `(${x},${y})`).toBe(true);
    for (const [x, y] of [[13, 10], [15, 12], [10, 13], [12, 15]]) expect(wet(x!, y!), `(${x},${y})`).toBe(false);
  });

  it('takes the rectangle when the picture beside it is empty', async () => {
    const { state, deps } = world();
    const done = await executeToolCall(call('paint_terrain', { shape: 'rect', x1: 10, y1: 10, x2: 13, y2: 12, picture: [], terrain: 'water', elevation: 0 }), deps);
    expect(done.isError).toBe(false);
    expect(state.cells[11]![12]!.terrain?.type).toBe(TerrainType.Water);
  });
});
