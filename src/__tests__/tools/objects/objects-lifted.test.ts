import { describe, it, expect } from 'vitest';
import { RuleRegistry } from '../../../rules/registry';
import { createDefaultRegistry } from '../../../rules';
import { CommandType, type PlacedObject } from '../../../core/model/types';
import { mapVersionKey } from '../../../core/model/grid-model';
import { planObjectMove, probeWithout } from '../../../tools/placement/probe';
import { previewGroupMove } from '../../../tools/objects/group-actions';
import { makeState, makeExecutor } from '../../_support/map-state';

const cabin = (): PlacedObject => ({ id: 'o1', catalogId: 'building-myhouse', position: { x: 2, y: 2 }, rotation: 0, elevation: 0 });

function crashing() {
  const state = makeState(10, 10);
  const registry = new RuleRegistry();
  const exec = makeExecutor(state, registry);
  const obj = cabin();
  state.objects.set(obj.id, obj);
  registry.register({
    id: 'throws', phase: 'pre-command', appliesTo: [CommandType.PlaceObject],
    validate: () => { throw new Error('rule crashed'); },
  });
  return { state, exec, obj };
}

describe('placement probes with objects taken off', () => {
  it('read a view without the objects and leave the live map and its versions alone', () => {
    const state = makeState(10, 10);
    const obj = cabin();
    state.objects.set(obj.id, obj);
    const key = mapVersionKey(state);
    const probe = probeWithout(state, [obj]);
    expect(probe.view.objects.has(obj.id)).toBe(false);
    expect(probe.scope.lifted.get(obj.id)).toBe(obj);
    expect(state.objects.get(obj.id)).toBe(obj);
    expect(mapVersionKey(state)).toBe(key);
    expect(probeWithout(state, [obj])).toBe(probe);
  });

  it('plan a move and preview a group move without moving the map version', () => {
    const state = makeState(10, 10);
    const exec = makeExecutor(state, createDefaultRegistry());
    const obj = cabin();
    state.objects.set(obj.id, obj);
    const key = mapVersionKey(state);
    expect(planObjectMove(exec, state, obj, 3, 2).errors).toEqual([]);
    expect(previewGroupMove(exec, state, [obj.id], 1, 0)).toBe(true);
    expect(mapVersionKey(state)).toBe(key);
  });

  it('keep an object on the map when a rule throws while its move is planned', () => {
    const { state, exec, obj } = crashing();
    expect(() => planObjectMove(exec, state, obj, 4, 4)).toThrow('rule crashed');
    expect(state.objects.get(obj.id)).toBe(obj);
  });

  it('keep a group on the map when a rule throws while its move is previewed', () => {
    const { state, exec, obj } = crashing();
    expect(() => previewGroupMove(exec, state, [obj.id], 1, 1)).toThrow('rule crashed');
    expect(state.objects.get(obj.id)).toBe(obj);
  });
});
