/** Water carried down terraces in waterfalls, by the assistant and by the helpers it briefs. */
import { describe, expect } from 'vitest';
import { spec } from '../../_support/spec';
import { EventBus } from '../../../core/commands/event-bus';
import { createDefaultRegistry } from '../../../rules';
import { TerrainType } from '../../../core/model/types';
import { type EditorEvents } from '../../../state/editing/events';
import { makeState, setTerrain } from '../../_support/map-state';
import { executeToolCall, wireSchemas, type AgentToolDeps } from '../../../agent/tools';
import { createExecutor } from '../../../state/executor';
import { detectWaterfalls } from '../../../core/domain/terrain/waterfall-geometry';

const call = (name: string, input: Record<string, unknown>) => ({ id: 't', name, input });

/** A level-2 terrace with a level-3 stage on it carrying a level-3 pool. */
async function raisedPool() {
  const state = makeState(60, 40);
  const exec = createExecutor(state, createDefaultRegistry(), new EventBus<EditorEvents>());
  const deps: AgentToolDeps = { getState: () => state, getExecutor: () => exec, getRegion: () => [] };
  for (let y = 2; y < 38; y++) for (let x = 2; x < 30; x++) setTerrain(state, x, y, TerrainType.Mountain, 2);
  expect((await executeToolCall(call('paint_terrain', { terrain: 'mountain', elevation: 3, shape: 'rect', x1: 6, y1: 10, x2: 20, y2: 28 }), deps)).isError).toBe(false);
  expect((await executeToolCall(call('paint_terrain', { terrain: 'water', elevation: 3, shape: 'rect', x1: 8, y1: 14, x2: 18, y2: 24 }), deps)).isError).toBe(false);
  return { state, deps };
}

describe('waterfalls', () => {
  spec('ASST-40', 'a river begun inside a raised pool falls at each step it crosses', async () => {
    const w = await raisedPool();
    const inside = await executeToolCall(call('carve_river', { points: [{ x: 13, y: 19 }, { x: 55, y: 19 }], width: 3 }), w.deps);
    expect(inside.isError, inside.content).toBe(false);
    expect(detectWaterfalls(w.state).length).toBeGreaterThan(0);
  });

  spec('ASST-40', 'a helper and a district lead are given the tool that makes them', () => {
    for (const seat of [{ subagent: true }, { district: true }] as const) {
      expect(wireSchemas(seat).map((t) => t.name), JSON.stringify(seat)).toContain('carve_river');
    }
  });
});
