import { describe, it, expect } from 'vitest';
import { EventBus } from '../../../core/commands/event-bus';
import { createDefaultRegistry } from '../../../rules';
import { type EditorEvents } from '../../../state/editing/events';
import { makeState } from '../../_support/map-state';
import { executeToolCall, type AgentToolDeps } from '../../../agent/tools';
import { createExecutor } from '../../../state/executor';

describe('lay_route', () => {
  it('says which rows and columns its paving covers', async () => {
    const state = makeState(40, 40);
    const exec = createExecutor(state, createDefaultRegistry(), new EventBus<EditorEvents>());
    const deps: AgentToolDeps = { getState: () => state, getExecutor: () => exec, getRegion: () => [] };
    const r = await executeToolCall({ id: 't', name: 'lay_route', input: { catalogId: 'path-park-stone', width: 3, x1: 20, y1: 5, x2: 20, y2: 30 } }, deps);
    expect(r.isError, r.content).toBe(false);
    const roads = [...state.objects.values()];
    const xs = roads.map((o) => o.position.x), ys = roads.map((o) => o.position.y);
    expect(r.content).toContain(`Its paving covers x ${Math.min(...xs)}..${Math.max(...xs)}, y ${Math.min(...ys)}..${Math.max(...ys)}.`);
    expect(Math.max(...xs) - Math.min(...xs)).toBe(2);
  });
});
