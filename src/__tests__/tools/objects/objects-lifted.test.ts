import { describe, it, expect } from 'vitest';
import { CommandExecutor } from '../../../core/commands/command-executor';
import { EventBus } from '../../../core/commands/event-bus';
import { RuleRegistry } from '../../../rules/registry';
import { CommandType, type EditorEvents, type PlacedObject } from '../../../core/model/types';
import { planObjectMove, withObjectsLifted } from '../../../tools/objects/object-placer';
import { previewGroupMove } from '../../../tools/objects/group-actions';
import { makeState } from '../../rules/_helpers';
import { roadLookup } from '../../../state/object-index';

function setup() {
  const state = makeState(10, 10);
  const registry = new RuleRegistry();
  const exec = new CommandExecutor(state, new EventBus<EditorEvents>(), registry, roadLookup(state));
  const obj: PlacedObject = { id: 'o1', catalogId: 'building-myhouse', position: { x: 2, y: 2 }, rotation: 0, elevation: 0 };
  state.objects.set(obj.id, obj);
  registry.register({
    id: 'throws', phase: 'pre-command', appliesTo: [CommandType.PlaceObject],
    validate: () => { throw new Error('rule crashed'); },
  });
  return { state, exec, obj };
}

describe('withObjectsLifted', () => {
  it('restores lifted objects when the probe throws', () => {
    const { state, obj } = setup();
    expect(() => withObjectsLifted(state, [obj], () => { throw new Error('probe crashed'); })).toThrow('probe crashed');
    expect(state.objects.get(obj.id)).toBe(obj);
  });

  it('keeps an object on the map when a rule throws while its move is planned', () => {
    const { state, exec, obj } = setup();
    expect(() => planObjectMove(exec, state, obj, 4, 4)).toThrow('rule crashed');
    expect(state.objects.get(obj.id)).toBe(obj);
  });

  it('keeps a group on the map when a rule throws while its move is previewed', () => {
    const { state, exec, obj } = setup();
    expect(() => previewGroupMove(exec, state, [obj.id], 1, 1)).toThrow('rule crashed');
    expect(state.objects.get(obj.id)).toBe(obj);
  });
});
