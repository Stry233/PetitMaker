/**
 * Object actions are command sequences, not view effects. They report whether the edit happened
 * and what the caller should animate; they never reach for a renderer or a toast.
 */
import { describe, it, expect } from 'vitest';
import { removeObject, rotateObject } from '../../../tools/objects/actions';
import { makeState, makeExecutor } from '../../_support/map-state';
import type { PlacedObject } from '../../../core/model/types';
import { ANCHOR_LANDMARK } from '../../_support/anchor';

const house = (id: string): PlacedObject => ({
  id, catalogId: 'building-cabin', position: { x: 6, y: 6 }, rotation: 0, elevation: 0,
});

const plaza = (): PlacedObject => ({
  id: ANCHOR_LANDMARK.id, catalogId: ANCHOR_LANDMARK.id, position: { x: 4.5, y: 4.5 }, width: 3, height: 3,
  rotation: 0, elevation: 0, locked: true,
});

describe('object actions', () => {
  it('removes an object as one undo step', () => {
    const state = makeState();
    const exec = makeExecutor(state);
    const obj = house('h1');
    state.objects.set(obj.id, obj);
    const before = exec.historyDepth();

    expect(removeObject(exec, obj).ok).toBe(true);
    expect(state.objects.has('h1')).toBe(false);
    expect(exec.historyDepth()).toBe(before + 1);
  });

  it('refuses to remove a locked structure and reports why', () => {
    const state = makeState();
    const exec = makeExecutor(state);
    state.objects.set(ANCHOR_LANDMARK.id, plaza());

    const result = removeObject(exec, state.objects.get(ANCHOR_LANDMARK.id)!);
    expect(result.ok).toBe(false);
    expect(state.objects.has(ANCHOR_LANDMARK.id)).toBe(true);
  });

  it('returns the spin for the caller to play, and collapses the turn into one step', () => {
    const state = makeState();
    const exec = makeExecutor(state);
    const obj = house('h1');
    state.objects.set(obj.id, obj);
    const before = exec.historyDepth();

    const result = rotateObject(exec, state, obj, 90, { from: 0, to: 90 });
    expect(result.ok).toBe(true);
    expect(result.spin).toEqual({ from: 0, to: 90 });
    expect(state.objects.get('h1')!.rotation).toBe(90);
    expect(exec.historyDepth()).toBe(before + 1);
  });

  it('leaves the object untouched when the rotated footprint is refused', () => {
    const state = makeState();
    const exec = makeExecutor(state);
    state.objects.set(ANCHOR_LANDMARK.id, plaza());

    const result = rotateObject(exec, state, state.objects.get(ANCHOR_LANDMARK.id)!, 90, { from: 0, to: 90 });
    expect(result.ok).toBe(false);
    expect(state.objects.get(ANCHOR_LANDMARK.id)!.rotation).toBe(0);
  });
});
