import { describe, it, expect } from 'vitest';
import { EventBus } from '../../../core/commands/event-bus';
import { createDefaultRegistry } from '../../../rules';
import { TerrainType } from '../../../core/model/types';
import { type EditorEvents } from '../../../state/editing/events';
import { makeState, setTerrain } from '../../_support/map-state';
import { executeToolCall, type AgentToolDeps } from '../../../agent/tools';
import { createExecutor } from '../../../state/executor';

describe('a refused terrain edit', () => {
  it('names the ground it cites as one patch of the model\'s cells', async () => {
    const state = makeState(30, 30);
    const exec = createExecutor(state, createDefaultRegistry(), new EventBus<EditorEvents>());
    const deps: AgentToolDeps = { getState: () => state, getExecutor: () => exec, getRegion: () => [] };
    for (let y = 5; y < 15; y++) for (let x = 5; x < 15; x++) setTerrain(state, x, y, TerrainType.Mountain, 2);
    const r = await executeToolCall({ id: 't', name: 'paint_terrain', input: { terrain: 'water', elevation: 2, shape: 'rect', x1: 8, y1: 8, x2: 14, y2: 11 } }, deps);
    expect(r.isError).toBe(true);
    expect(r.content).toMatch(/the ground under cells x \d+\.\.\d+, y \d+\.\.\d+ \(\d+ places?\)/);
  });
});
