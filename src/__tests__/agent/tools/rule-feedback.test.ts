import { describe, expect, it } from 'vitest';
import { EventBus } from '../../../core/commands/event-bus';
import { createDefaultRegistry, ruleDescription } from '../../../rules';
import { CommandType } from '../../../core/model/types';
import { type EditorEvents } from '../../../state/editing/events';
import { createExecutor } from '../../../state/executor';
import { executeToolCall, type AgentToolDeps } from '../../../agent/tools';
import { makeState } from '../../_support/map-state';

function setup(registry = createDefaultRegistry()) {
  const state = makeState(24, 24);
  const exec = createExecutor(state, registry, new EventBus<EditorEvents>());
  const deps: AgentToolDeps = { getState: () => state, getExecutor: () => exec, getRegion: () => [] };
  return { deps };
}

const call = (name: string, input: Record<string, unknown>) => ({ id: 't1', name, input });

describe('what a refusal tells the assistant', () => {
  it("states the refused rule in the rule's own words, then the assistant's advice on it", async () => {
    const { deps } = setup();
    const placed = await executeToolCall(call('place_object', { catalogId: 'building-myhouse', x: 2, y: 2 }), deps);
    expect(placed.isError).toBe(false);

    const refused = await executeToolCall(call('place_object', { catalogId: 'building-myhouse', x: 12, y: 14 }), deps);
    expect(refused.content).toContain('[V-PLACE-MAX]');
    const hint = refused.content.slice(refused.content.indexOf('Hint: '));
    expect(hint.startsWith(`Hint: ${ruleDescription('V-PLACE-MAX')!} `)).toBe(true);
    expect(hint).toContain('CATALOG');
  });

  it('adds no hint for a rule that is not one of the editor\'s own', async () => {
    const registry = createDefaultRegistry();
    registry.register({
      id: 'V-TEST-CLOSED', description: 'Nothing may be placed.', phase: 'pre-command', appliesTo: [CommandType.PlaceObject],
      validate: () => [{ ruleId: 'V-TEST-CLOSED', message: 'error.object_overlap', cells: [], grid: 'object' }],
    });
    const { deps } = setup(registry);
    const refused = await executeToolCall(call('place_object', { catalogId: 'building-stall', x: 8, y: 8 }), deps);
    expect(refused.content).toContain('[V-TEST-CLOSED]');
    expect(refused.content).not.toContain('Hint:');
  });
});
