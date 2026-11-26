/**
 * A path that arrives: lay_route joins two points across a change of level and across water with the
 * crossing each needs, as one undo step, or lays nothing.
 */
import { describe, expect, it } from 'vitest';
import { createDefaultRegistry } from '../../../rules';
import { createExecutor } from '../../../state/executor';
import { executeToolCall, type AgentToolDeps } from '../../../agent/tools';
import { makeState } from '../../_support/map-state';

const call = (name: string, input: Record<string, unknown>) => ({ id: 't1', name, input });

function world() {
  const state = makeState(48, 40);
  const exec = createExecutor(state, createDefaultRegistry());
  const deps: AgentToolDeps = { getState: () => state, getExecutor: () => exec, getRegion: () => [] };
  const run = async (name: string, input: Record<string, unknown>) => executeToolCall(call(name, input), deps);
  const kinds = (prefix: string) => [...state.objects.values()].filter((o) => o.catalogId.startsWith(prefix));
  return { state, exec, run, kinds };
}

describe('lay_route', () => {
  it('lays a plain path between two points on one level, in one undo step', async () => {
    const { exec, run, kinds } = world();
    const depth = exec.historyDepth();
    const done = await run('lay_route', { x1: 6, y1: 30, x2: 30, y2: 30 });
    expect(done.isError).toBe(false);
    expect(kinds('path').length).toBeGreaterThanOrEqual(24);
    expect(exec.historyDepth()).toBe(depth + 1);
    exec.undo();
    expect(kinds('path')).toHaveLength(0);
  });

  it('climbs onto raised ground with a ramp and reaches the far point', async () => {
    const { run, kinds } = world();
    expect((await run('paint_terrain', { terrain: 'mountain', elevation: 1, shape: 'rect', x1: 10, y1: 6, x2: 36, y2: 18 })).isError).toBe(false);
    const done = await run('lay_route', { x1: 22, y1: 32, x2: 22, y2: 10 });
    expect(done.isError, done.content).toBe(false);
    expect(kinds('ramp').length).toBeGreaterThanOrEqual(1);
    expect(done.content).toMatch(/ramp/);
  });

  it('crosses a channel with a bridge', async () => {
    const { run, kinds } = world();
    expect((await run('paint_terrain', { terrain: 'water', elevation: 0, shape: 'rect', x1: 4, y1: 18, x2: 44, y2: 20 })).isError).toBe(false);
    const done = await run('lay_route', { x1: 22, y1: 32, x2: 22, y2: 8 });
    expect(done.isError, done.content).toBe(false);
    expect(kinds('bridge').length).toBeGreaterThanOrEqual(1);
  });

  it('lays nothing and says so when no route exists', async () => {
    const { state, run } = world();
    // A ramp climbs one layer; three at once leave no way up.
    await run('paint_terrain', { terrain: 'mountain', elevation: 3, shape: 'rect', x1: 4, y1: 2, x2: 40, y2: 8 });
    const before = state.objects.size;
    const done = await run('lay_route', { x1: 22, y1: 34, x2: 22, y2: 5 });
    expect(done.isError).toBe(true);
    expect(state.objects.size).toBe(before);
  });
});
