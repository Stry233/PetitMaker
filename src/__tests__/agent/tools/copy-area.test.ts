/**
 * copy_area is how the assistant repeats and mirrors a motif: what stands in the source lands again
 * at each place, mirrored when asked, as one undo step, and never over existing work.
 */
import { describe, expect, it } from 'vitest';
import { createDefaultRegistry } from '../../../rules';
import { createExecutor } from '../../../state/executor';
import { TerrainType, type MacroCoord } from '../../../core/model/types';
import { executeToolCall, type AgentToolDeps } from '../../../agent/tools';
import { makeState } from '../../_support/map-state';

const call = (name: string, input: Record<string, unknown>) => ({ id: 't1', name, input });

function world() {
  const state = makeState(48, 32);
  const exec = createExecutor(state, createDefaultRegistry());
  const deps: AgentToolDeps = { getState: () => state, getExecutor: () => exec, getRegion: () => [] };
  return { state, exec, deps };
}

/** The same tools confined to the object cells (x1,2)-(22,12). */
function confined(deps: AgentToolDeps, x1 = 2): AgentToolDeps {
  const region: MacroCoord[] = [];
  for (let y = 2; y <= 12; y++) for (let x = x1; x <= 22; x++) region.push({ x, y });
  return { ...deps, getRegion: () => region };
}

/** A motif in (4,4)-(8,7): a rose at its left edge, a daisy beside it and a small pond at its right. */
async function motif(deps: AgentToolDeps): Promise<void> {
  for (const step of [
    call('place_object', { catalogId: 'flower-rose', x: 4, y: 5 }),
    call('place_object', { catalogId: 'flower-daisy', x: 5, y: 5 }),
    call('paint_terrain', { terrain: 'water', elevation: 0, shape: 'rect', x1: 7, y1: 5, x2: 8, y2: 6 }),
  ]) {
    const done = await executeToolCall(step, deps);
    if (done.isError) throw new Error(done.content);
  }
}

const at = (state: ReturnType<typeof world>['state'], x: number, y: number): string | undefined =>
  [...state.objects.values()].find((o) => o.position.x === x && o.position.y === y)?.catalogId;
const water = (state: ReturnType<typeof world>['state'], x: number, y: number): boolean =>
  state.cells[y]?.[x]?.terrain?.type === TerrainType.Water;

describe('copy_area', () => {
  it('lays the source again at each place, and all of it is one undo step', async () => {
    const { state, exec, deps } = world();
    await motif(deps);
    const depth = exec.historyDepth();
    const done = await executeToolCall(call('copy_area', { x1: 4, y1: 4, x2: 8, y2: 7, copies: [{ x: 14, y: 4 }, { x: 24, y: 4 }] }), deps);
    expect(done.isError).toBe(false);
    for (const dx of [10, 20]) {
      expect(at(state, 4 + dx, 5)).toBe('flower-rose');
      expect(at(state, 5 + dx, 5)).toBe('flower-daisy');
      expect(water(state, 7 + dx, 5)).toBe(true);
    }
    expect(exec.historyDepth()).toBe(depth + 1);
    exec.undo();
    expect(at(state, 14, 5)).toBeUndefined();
    expect(water(state, 17, 5)).toBe(false);
    expect(at(state, 4, 5)).toBe('flower-rose');
  });

  it('mirrors a copy left to right, so the pair is symmetric about the axis between them', async () => {
    const { state, deps } = world();
    await motif(deps);
    // Axis between columns 10 and 11: the mirrored frame starts at 2 * 10 + 1 - 8 = 13.
    const done = await executeToolCall(call('copy_area', { x1: 4, y1: 4, x2: 8, y2: 7, copies: [{ x: 13, y: 4, flip: 'horizontal' }] }), deps);
    expect(done.isError).toBe(false);
    expect(at(state, 17, 5)).toBe('flower-rose');
    expect(at(state, 16, 5)).toBe('flower-daisy');
    expect(at(state, 13, 5)).toBeUndefined();
  });

  it('keeps what already stands at a target and says what it left out', async () => {
    const { state, deps } = world();
    await motif(deps);
    await executeToolCall(call('place_object', { catalogId: 'flower-sunflower', x: 14, y: 5 }), deps);
    const done = await executeToolCall(call('copy_area', { x1: 4, y1: 4, x2: 8, y2: 7, copies: [{ x: 14, y: 4 }] }), deps);
    expect(done.isError).toBe(false);
    expect(at(state, 14, 5)).toBe('flower-sunflower');
    expect(at(state, 15, 5)).toBe('flower-daisy');
    expect(done.content).toMatch(/left out/);
  });

  it('refuses an empty source and an empty list of places', async () => {
    const { deps } = world();
    expect((await executeToolCall(call('copy_area', { x1: 4, y1: 4, x2: 8, y2: 7, copies: [{ x: 14, y: 4 }] }), deps)).isError).toBe(true);
    await motif(deps);
    expect((await executeToolCall(call('copy_area', { x1: 4, y1: 4, x2: 8, y2: 7, copies: [] }), deps)).isError).toBe(true);
  });

  it('refuses a copy that reaches outside the selected region and leaves nothing behind', async () => {
    const { state, exec, deps } = world();
    await motif(deps);
    const depth = exec.historyDepth();
    // The frame lands on columns 20..24: the flowers inside the region, the pond past its edge.
    const done = await executeToolCall(call('copy_area', { x1: 4, y1: 4, x2: 8, y2: 7, copies: [{ x: 10, y: 4 }, { x: 20, y: 4 }] }), confined(deps));
    expect(done.isError).toBe(true);
    expect(done.detail?.regionBlocked).toBe(true);
    expect(water(state, 23, 5)).toBe(false);
    expect(at(state, 20, 5)).toBeUndefined();
    expect(at(state, 10, 5)).toBeUndefined();
    expect(exec.historyDepth()).toBe(depth);
  });

  it('counts every object and terrain cell the copies laid', async () => {
    const { state, deps } = world();
    await motif(deps);
    const ponds = (): number => state.cells.flat().filter((c) => c.terrain?.type === TerrainType.Water).length;
    const before = ponds();
    const done = await executeToolCall(call('copy_area', { x1: 4, y1: 4, x2: 8, y2: 7, copies: [{ x: 14, y: 4 }] }), confined(deps));
    expect(done.isError).toBe(false);
    expect(done.detail).toEqual({ objects: 2, cells: ponds() - before });
  });
});

describe('mirror_area', () => {
  it('refuses a mirror image that reaches outside the selected region and leaves nothing behind', async () => {
    const { state, exec, deps } = world();
    await motif(deps);
    const depth = exec.historyDepth();
    // Mirrored about the line between columns 10 and 11, the pond lands on 13..14 and the flowers on 16 and 17.
    const done = await executeToolCall(call('mirror_area', { x1: 4, y1: 4, x2: 8, y2: 7, axisX: 10.5 }), confined(deps, 15));
    expect(done.isError).toBe(true);
    expect(done.detail?.regionBlocked).toBe(true);
    expect(water(state, 13, 5)).toBe(false);
    expect(at(state, 16, 5)).toBeUndefined();
    expect(at(state, 17, 5)).toBeUndefined();
    expect(exec.historyDepth()).toBe(depth);
  });
});

describe('replace_objects', () => {
  it('gives a copy its own species, each replacement where the original stood, in one undo step', async () => {
    const { state, exec, deps } = world();
    await motif(deps);
    await executeToolCall(call('copy_area', { x1: 4, y1: 4, x2: 8, y2: 7, copies: [{ x: 14, y: 4 }] }), deps);
    const depth = exec.historyDepth();
    const done = await executeToolCall(call('replace_objects', { x1: 14, y1: 4, x2: 18, y2: 7, from: 'flower-rose', to: 'flower-sunflower' }), deps);
    expect(done.isError).toBe(false);
    expect(at(state, 14, 5)).toBe('flower-sunflower');
    expect(at(state, 15, 5)).toBe('flower-daisy');
    expect(at(state, 4, 5)).toBe('flower-rose');
    expect(exec.historyDepth()).toBe(depth + 1);
    exec.undo();
    expect(at(state, 14, 5)).toBe('flower-rose');
  });

  it('keeps an original it cannot replace and counts only what it replaced', async () => {
    const { state, deps } = world();
    for (const x of [4, 5, 6, 7]) await executeToolCall(call('place_object', { catalogId: 'flower-rose', x, y: 5 }), deps);
    // Trees keep a distance from one another, so adjacent cells cannot all take one.
    const done = await executeToolCall(call('replace_objects', { x1: 4, y1: 5, x2: 7, y2: 5, from: 'flower-rose', to: 'tree-apple' }), deps);
    const row = [4, 5, 6, 7].map((x) => at(state, x, 5));
    const trees = row.filter((id) => id === 'tree-apple').length;
    expect(trees).toBeGreaterThan(0);
    expect(trees).toBeLessThan(4);
    expect(row.filter((id) => id === 'flower-rose').length).toBe(4 - trees);
    expect(done.content).toContain(`Replaced ${trees} of 4`);
  });

  it('refuses when nothing of that kind stands there or the footprints differ', async () => {
    const { deps } = world();
    await motif(deps);
    expect((await executeToolCall(call('replace_objects', { x1: 20, y1: 20, x2: 24, y2: 24, from: 'flower-rose', to: 'flower-daisy' }), deps)).isError).toBe(true);
    expect((await executeToolCall(call('replace_objects', { x1: 4, y1: 4, x2: 8, y2: 7, from: 'flower-rose', to: 'building-myhouse' }), deps)).isError).toBe(true);
  });
});
