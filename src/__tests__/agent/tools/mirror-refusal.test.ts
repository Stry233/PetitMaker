import { describe, it, expect } from 'vitest';
import { EventBus } from '../../../core/commands/event-bus';
import { createDefaultRegistry } from '../../../rules';
import { type EditorEvents } from '../../../state/editing/events';
import { makeState } from '../../_support/map-state';
import { executeToolCall, type AgentToolDeps } from '../../../agent/tools';
import { createExecutor } from '../../../state/executor';

describe('mirror_area refused', () => {
  it('says which reason applies to the side it was given', async () => {
    const state = makeState(40, 40);
    const exec = createExecutor(state, createDefaultRegistry(), new EventBus<EditorEvents>());
    const deps: AgentToolDeps = { getState: () => state, getExecutor: () => exec, getRegion: () => [] };
    const r = await executeToolCall({ id: 't', name: 'mirror_area', input: { x1: 2, y1: 2, x2: 10, y2: 10, axisX: 15 } }, deps);
    expect(r.isError).toBe(true);
    expect(r.content).toContain('the side holds no terrain and no whole object; build it first, then mirror it.');
  });
});
