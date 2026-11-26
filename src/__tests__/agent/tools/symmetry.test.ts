/**
 * Two sides meant to match are built once and mirrored by the tool, never placed twice by hand:
 * the mirror lands exactly, a check names what lacks its counterpart, and a row spread evenly is its
 * own mirror image.
 */
import { describe, expect, it } from 'vitest';
import { createDefaultRegistry } from '../../../rules';
import { createExecutor } from '../../../state/executor';
import { TerrainType } from '../../../core/model/types';
import { executeToolCall, type AgentToolDeps } from '../../../agent/tools';
import { makeState } from '../../_support/map-state';

const call = (name: string, input: Record<string, unknown>) => ({ id: 't1', name, input });

function world() {
  const state = makeState(60, 32);
  const exec = createExecutor(state, createDefaultRegistry());
  const deps: AgentToolDeps = { getState: () => state, getExecutor: () => exec, getRegion: () => [] };
  const at = (x: number, y: number): string | undefined =>
    [...state.objects.values()].find((o) => o.position.x === x && o.position.y === y)?.catalogId;
  const xsOf = (id: string, y: number): number[] => [...state.objects.values()]
    .filter((o) => o.catalogId === id && o.position.y === y).map((o) => o.position.x).sort((a, b) => a - b);
  return { state, exec, deps, at, xsOf };
}

/** One side: a rose at the far edge, a daisy nearer the axis and a pond between. */
async function side(deps: AgentToolDeps): Promise<void> {
  for (const step of [
    call('place_object', { catalogId: 'flower-rose', x: 10, y: 10 }),
    call('place_object', { catalogId: 'flower-daisy', x: 17, y: 10 }),
    call('paint_terrain', { terrain: 'water', elevation: 0, shape: 'rect', x1: 12, y1: 12, x2: 15, y2: 14 }),
  ]) {
    const done = await executeToolCall(step, deps);
    if (done.isError) throw new Error(done.content);
  }
}

describe('mirror_area', () => {
  it('lays the mirror image about a line between two columns, terrain included, in one undo step', async () => {
    const { state, exec, deps, at } = world();
    await side(deps);
    const depth = exec.historyDepth();
    // The line between columns 20 and 21: column 10 answers to 31, 17 to 24.
    const done = await executeToolCall(call('mirror_area', { x1: 10, y1: 9, x2: 18, y2: 16, axisX: 20.5 }), deps);
    expect(done.isError).toBe(false);
    expect(at(31, 10)).toBe('flower-rose');
    expect(at(24, 10)).toBe('flower-daisy');
    // The pond lies under cells 12..15, whose mirror about the line is cells 26..29: the ground
    // under those runs from index 26 to 30, as the source's runs from 12 to 16.
    const water = (x: number): boolean => state.cells[13]![x]!.terrain?.type === TerrainType.Water;
    expect([11, 12, 16, 17].map(water)).toEqual([false, true, true, false]);
    expect([25, 26, 30, 31].map(water)).toEqual([false, true, true, false]);
    expect(exec.historyDepth()).toBe(depth + 1);
    // Painting the mirrored rectangle by its own numbers is the same pond.
    const before = JSON.stringify(state.cells);
    const again = await executeToolCall(call('paint_terrain', { terrain: 'water', elevation: 0, shape: 'rect', x1: 26, y1: 12, x2: 29, y2: 14 }), deps);
    expect(again.isError).toBe(false);
    expect(JSON.stringify(state.cells)).toBe(before);
  });

  it('mirrors about a line through the middle of a column', async () => {
    const { deps, at } = world();
    await side(deps);
    await executeToolCall(call('mirror_area', { x1: 10, y1: 9, x2: 18, y2: 16, axisX: 20 }), deps);
    expect(at(30, 10)).toBe('flower-rose');
    expect(at(23, 10)).toBe('flower-daisy');
  });

  it('refuses a rectangle that crosses its own axis', async () => {
    const { deps } = world();
    await side(deps);
    expect((await executeToolCall(call('mirror_area', { x1: 10, y1: 9, x2: 18, y2: 16, axisX: 14.5 }), deps)).isError).toBe(true);
  });
});

describe('scatter_objects pattern even', () => {
  it('spreads a row with equal margins, its own mirror image about the middle of the rectangle', async () => {
    const { deps, xsOf } = world();
    const done = await executeToolCall(call('scatter_objects', { catalogIds: ['flower-rose'], count: 20, x1: 10, y1: 10, x2: 29, y2: 10, pattern: 'even', columns: 4, rows: 1 }), deps);
    expect(done.isError).toBe(false);
    const xs = xsOf('flower-rose', 10);
    expect(xs).toHaveLength(4);
    expect(xs.map((x) => x - 10)).toEqual(xs.map((x) => 29 - x).reverse());
    const gaps = xs.slice(1).map((x, i) => x - xs[i]!);
    expect(new Set(gaps).size).toBe(1);
  });
});
