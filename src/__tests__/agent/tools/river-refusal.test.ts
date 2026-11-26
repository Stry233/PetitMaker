import { describe, it, expect } from 'vitest';
import { EventBus } from '../../../core/commands/event-bus';
import { createDefaultRegistry } from '../../../rules';
import { TerrainType } from '../../../core/model/types';
import { type EditorEvents } from '../../../state/editing/events';
import { makeState, setTerrain } from '../../_support/map-state';
import { executeToolCall, type AgentToolDeps } from '../../../agent/tools';
import { createExecutor } from '../../../state/executor';

const call = (name: string, input: Record<string, unknown>) => ({ id: 't', name, input });

describe('carve_river refused below a lip', () => {
  it('says why a course begun just below a lip stops, and how to begin it', async () => {
    const state = makeState(60, 30);
    const exec = createExecutor(state, createDefaultRegistry(), new EventBus<EditorEvents>());
    const deps: AgentToolDeps = { getState: () => state, getExecutor: () => exec, getRegion: () => [] };
    for (let y = 2; y < 28; y++) for (let x = 2; x < 40; x++) setTerrain(state, x, y, TerrainType.Mountain, 3);
    expect((await executeToolCall(call('paint_terrain', { terrain: 'mountain', elevation: 4, shape: 'rect', x1: 10, y1: 4, x2: 30, y2: 12 }), deps)).isError).toBe(false);
    expect((await executeToolCall(call('paint_terrain', { terrain: 'water', elevation: 4, shape: 'rect', x1: 12, y1: 5, x2: 28, y2: 11 }), deps)).isError).toBe(false);
    const lip = await executeToolCall(call('paint_terrain', { terrain: 'water', elevation: 4, shape: 'rect', x1: 19, y1: 12, x2: 21, y2: 12 }), deps);
    expect(lip.isError, lip.content).toBe(false);
    const below = await executeToolCall(call('carve_river', { points: [{ x: 20, y: 14 }, { x: 55, y: 14 }], width: 4 }), deps);
    expect(below.isError).toBe(true);
    expect(below.content).toContain('begin it inside the pool it flows from');
    // Blocked ground is named by the object cells resting on it, never as a terrain cell.
    expect(below.content).toMatch(/blocked at the ground (?:under|between) cells/);
    expect(below.content).toMatch(/At the ground (?:under|between) cells/);
  });
});
