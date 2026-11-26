/**
 * view_map's ground layer: counts of the ground under the asked cells and a key naming every level,
 * and a level picture only where the seat reads pictures.
 */
import { describe, expect, it, vi } from 'vitest';
import { ELEVATION_MAX } from '../../../core/game/profile';
import { TerrainType } from '../../../core/model/types';
import { createDefaultRegistry } from '../../../rules';
import { createExecutor } from '../../../state/executor';
import { executeToolCall, type AgentToolDeps } from '../../../agent/tools';
import { makeState, setTerrain } from '../../_support/map-state';

function world(over: Partial<AgentToolDeps> = {}) {
  const state = makeState(30, 30);
  for (let y = 10; y <= 13; y++) for (let x = 10; x <= 13; x++) setTerrain(state, x, y, TerrainType.Mountain, 2);
  const exec = createExecutor(state, createDefaultRegistry());
  const deps: AgentToolDeps = { getState: () => state, getExecutor: () => exec, getRegion: () => [], ...over };
  return (input: Record<string, unknown>) => executeToolCall({ id: 'v', name: 'view_map', input }, deps);
}

describe('view_map layer ground', () => {
  it('counts the ground under the asked cells in pieces and keys every level, with no picture for a seat that reads none', async () => {
    const r = await world()({ layer: 'ground', x1: 10, y1: 10, x2: 12, y2: 12 });
    expect(r.isError).toBe(false);
    expect(r.image).toBeUndefined();
    // The ground under 3x3 cells is 4x4 pieces, the raised block's 16.
    expect(r.content).toMatch(/pieces of ground by land level 2:16;/);
    for (let level = 0; level <= ELEVATION_MAX; level++) expect(r.content).toMatch(new RegExp(`[(,] ?${level} [a-z]`));
  });

  it('draws the level picture of the ground under the asked cells where the seat reads pictures', async () => {
    const snapshotGround = vi.fn(async () => ({ url: 'data:image/png;base64,AA==', origin: { x: 10, y: 10 }, scale: 4 }));
    const r = await world({ snapshotGround })({ layer: 'ground', x1: 10, y1: 10, x2: 12, y2: 12 });
    expect(snapshotGround).toHaveBeenCalledWith({ x1: 10, y1: 10, x2: 13, y2: 13 });
    expect(r.image?.dataUrl).toMatch(/^data:image\/png/);
  });
});
