/**
 * Moving, turning or group-editing an object charges a region only for its net change: the
 * object's own load is not counted twice, so an overloaded region still lets its items be moved
 * and turned, while new load stays refused.
 */
import { describe, it, expect } from 'vitest';
import { CommandType, type GridState, type PlacedObject } from '../../core/model/types';
import { makeExecutor, makeState, placeCmd } from '../_support/map-state';
import { planObjectMove, planObjectRotation } from '../../tools/placement/probe';
import { rotateObject } from '../../tools/objects/actions';
import { deleteGroup, moveGroup, rotateGroup } from '../../tools/objects/group-actions';
import { getMapStats } from '../../state/map-stats';
import { CHUNK_LOAD_LIMIT } from '../../core/game/profile';

const flower = (id: string, x: number, y: number): PlacedObject => ({
  id, catalogId: 'flower-protea', position: { x, y }, rotation: 0, elevation: 0,
});
const cabin = (id: string, x: number, y: number): PlacedObject => ({
  id, catalogId: 'building-forest-cabin', position: { x, y }, rotation: 0, elevation: 0,
});

/** Fills the first region past its limit with flowers on rows 6 and below, leaving rows 0-5 free. */
function overloaded(extra: PlacedObject[] = []): GridState {
  const state = makeState(32, 32);
  for (const o of extra) state.objects.set(o.id, o);
  let i = 0;
  for (let y = 6; y < 16; y++) {
    for (let x = 0; x < 16 && i < 102; x++, i++) state.objects.set(`f${i}`, flower(`f${i}`, x, y));
  }
  expect(getMapStats(state).chunks.get('0,0')!.load).toBeGreaterThan(CHUNK_LOAD_LIMIT);
  return state;
}

describe('V-CHUNK-01 on transforms in an overloaded region', () => {
  it('lets a flower move within its overloaded region', () => {
    const state = overloaded();
    const exec = makeExecutor(state);
    const plan = planObjectMove(exec, state, state.objects.get('f0')!, 3, 2);
    expect(plan.errors.map((e) => e.ruleId)).toEqual([]);
  });

  it('lets a multi-cell object turn in place in its overloaded region', () => {
    const state = overloaded([cabin('c', 0, 0)]);
    const exec = makeExecutor(state);
    expect(planObjectRotation(exec, state, state.objects.get('c')!, 90).errors).toEqual([]);
    const res = rotateObject(exec, state, state.objects.get('c')!, 90, { from: 0, to: 90 });
    expect(res.ok).toBe(true);
    expect(state.objects.get('c')!.rotation).toBe(90);
  });

  it('lets a group move and turn within its overloaded region', () => {
    const state = overloaded();
    const exec = makeExecutor(state);
    const moved = moveGroup(exec, state, ['f0', 'f1', 'f2'], { dx: 0, dy: -3 });
    expect(moved.refusal).toBeNull();
    expect(state.objects.get('f0')!.position).toEqual({ x: 0, y: 3 });
    const turned = rotateGroup(exec, state, ['f0', 'f1', 'f2'], 1);
    expect(turned.refusal).toBeNull();
  });

  it('still refuses new load in the overloaded region, including after a move', () => {
    const state = overloaded();
    const exec = makeExecutor(state);
    expect(exec.execute(placeCmd(flower('new', 2, 2))).errors.map((e) => e.ruleId)).toEqual(['V-CHUNK-01']);
    expect(moveGroup(exec, state, ['f0'], { dx: 0, dy: -3 }).refusal).toBeNull();
    expect(exec.execute(placeCmd(flower('new', 2, 2))).errors.map((e) => e.ruleId)).toEqual(['V-CHUNK-01']);
  });

  it('charges a different item in full even where the stroke removed another', () => {
    const state = overloaded();
    const exec = makeExecutor(state);
    expect(exec.execute({ type: CommandType.RemoveObject, objectId: 'f0' }).success).toBe(true);
    expect(exec.execute(placeCmd(flower('other', 2, 2))).errors.map((e) => e.ruleId)).toEqual(['V-CHUNK-01']);
  });

  it('gives no credit for an object removed in an earlier stroke', () => {
    const state = overloaded();
    const exec = makeExecutor(state);
    expect(deleteGroup(exec, state, ['f0']).deleted).toBe(1);
    expect(exec.execute(placeCmd(flower('new', 2, 2))).errors.map((e) => e.ruleId)).toEqual(['V-CHUNK-01']);
  });

  it('refuses moving an object into another region that it would overload', () => {
    const full = Array.from({ length: 100 }, (_, i) => flower(`g${i}`, 16 + (i % 16), Math.floor(i / 16)));
    const state = overloaded(full);
    const exec = makeExecutor(state);
    expect(planObjectMove(exec, state, state.objects.get('f0')!, 20, 10).errors.map((e) => e.ruleId)).toEqual(['V-CHUNK-01']);
    expect(moveGroup(exec, state, ['f0'], { dx: 20, dy: 4 }).refusal).not.toBeNull();
  });
});
