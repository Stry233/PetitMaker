/**
 * The object listing is the one read whose size follows the map, so it names a bounded number of
 * objects and counts the rest: a built island must not fill the model's context in one call.
 */
import { describe, expect, it } from 'vitest';
import { createDefaultRegistry } from '../../../rules';
import { createExecutor } from '../../../state/executor';
import { executeToolCall, type AgentToolDeps } from '../../../agent/tools';
import { makeState } from '../../_support/map-state';

const call = (name: string, input: Record<string, unknown>) => ({ id: 't1', name, input });

/** A map with one flower on every cell of a `side` by `side` square from (1,1). */
async function planted(side: number): Promise<AgentToolDeps> {
  const state = makeState(side + 4, side + 4);
  const exec = createExecutor(state, createDefaultRegistry());
  const deps: AgentToolDeps = { getState: () => state, getExecutor: () => exec, getRegion: () => [] };
  for (let y = 1; y <= side; y++) {
    for (let x = 1; x <= side; x++) {
      const placed = await executeToolCall(call('place_object', { catalogId: 'flower-protea', x, y }), deps);
      if (placed.isError) throw new Error(placed.content);
    }
  }
  return deps;
}

const lines = (content: string): string[] => content.split('\n');

describe('get_objects', () => {
  it('names a bounded number of objects and counts the rest with how to reach them', async () => {
    const deps = await planted(10);
    const all = await executeToolCall(call('get_objects', {}), deps);
    expect(all.isError).toBe(false);
    const listed = lines(all.content);
    expect(listed.length).toBeLessThan(100);
    const tail = listed.at(-1)!;
    const unlisted = Number(/^(\d+) more objects/.exec(tail)?.[1]);
    expect(listed.length - 1 + unlisted).toBe(100);
    expect(tail).toContain('x1,y1,x2,y2');
  });

  it('lists only the objects placed inside a rectangle, in either corner order', async () => {
    const deps = await planted(10);
    const inside = await executeToolCall(call('get_objects', { x1: 2, y1: 2, x2: 4, y2: 3 }), deps);
    expect(lines(inside.content)).toHaveLength(6);
    const flipped = await executeToolCall(call('get_objects', { x1: 4, y1: 3, x2: 2, y2: 2 }), deps);
    expect(flipped.content).toBe(inside.content);
    const empty = await executeToolCall(call('get_objects', { x1: 12, y1: 12, x2: 13, y2: 13 }), deps);
    expect(empty).toMatchObject({ isError: false });
    expect(lines(empty.content)).toHaveLength(1);
  });

  it('refuses half a rectangle instead of listing the whole map', async () => {
    const deps = await planted(2);
    const refused = await executeToolCall(call('get_objects', { x1: 1, y1: 1 }), deps);
    expect(refused.isError).toBe(true);
  });
});
