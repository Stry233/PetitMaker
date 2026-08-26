/**
 * Object actions are command sequences, not view effects. They report whether the edit happened
 * and what the caller should animate; they never reach for a renderer or a toast.
 */
import { describe, it, expect } from 'vitest';
import { removeObject, rotateObject } from '../../../tools/objects/actions';
import { PLAZA_ID } from '../../../core/model/constants';
import { makeState, makeExecutor } from '../../rules/_helpers';
import type { PlacedObject } from '../../../core/model/types';

const house = (id: string): PlacedObject => ({
  id, catalogId: 'building-cabin', position: { x: 6, y: 6 }, rotation: 0, elevation: 0,
});

const plaza = (): PlacedObject => ({
  id: PLAZA_ID, catalogId: PLAZA_ID, position: { x: 4.5, y: 4.5 }, width: 3, height: 3,
  rotation: 0, elevation: 0, locked: true,
});

describe('object actions', () => {
  it('removes an object as one undo step', () => {
    const state = makeState();
    const exec = makeExecutor(state);
    const obj = house('h1');
    state.objects.set(obj.id, obj);
    const before = exec.getUndoStackSize();

    expect(removeObject(exec, obj).ok).toBe(true);
    expect(state.objects.has('h1')).toBe(false);
    expect(exec.getUndoStackSize()).toBe(before + 1);
  });

  it('refuses to remove a locked structure and reports why', () => {
    const state = makeState();
    const exec = makeExecutor(state);
    state.objects.set(PLAZA_ID, plaza());

    const result = removeObject(exec, state.objects.get(PLAZA_ID)!);
    expect(result.ok).toBe(false);
    expect(state.objects.has(PLAZA_ID)).toBe(true);
  });

  it('returns the spin for the caller to play, and collapses the turn into one step', () => {
    const state = makeState();
    const exec = makeExecutor(state);
    const obj = house('h1');
    state.objects.set(obj.id, obj);
    const before = exec.getUndoStackSize();

    const result = rotateObject(exec, state, obj, 90, { from: 0, to: 90 });
    expect(result.ok).toBe(true);
    expect(result.spin).toEqual({ from: 0, to: 90 });
    expect(state.objects.get('h1')!.rotation).toBe(90);
    expect(exec.getUndoStackSize()).toBe(before + 1);
  });

  it('leaves the object untouched when the rotated footprint is refused', () => {
    const state = makeState();
    const exec = makeExecutor(state);
    state.objects.set(PLAZA_ID, plaza());

    const result = rotateObject(exec, state, state.objects.get(PLAZA_ID)!, 90, { from: 0, to: 90 });
    expect(result.ok).toBe(false);
    expect(state.objects.get(PLAZA_ID)!.rotation).toBe(0);
  });
});
