/**
 * A group operation is all-or-nothing where a partial result would be incoherent, and partial
 * where it would not. Move and rotate are geometric, so half a move leaves an arrangement the
 * user never asked for; a delete of forty can honestly remove thirty-nine and name the last.
 */
import { describe, it, expect } from 'vitest';
import { deleteGroup, moveGroup, groupMembers } from '../../../tools/objects/group-actions';
import { makeState, makeExecutor } from '../../_support/map-state';
import type { GridState, PlacedObject } from '../../../core/model/types';
import { ANCHOR_LANDMARK } from '../../_support/anchor';

const tree = (id: string, x: number, y: number): PlacedObject => ({
  id, catalogId: 'tree-apple', position: { x, y }, rotation: 0, elevation: 0,
});

// Locked, like the real central plaza (`templateLandmarkObjects`) — `makeState`'s template plaza is
// zero-sized (no object of its own), so a test that needs a locked member seeds one explicitly.
const plaza = (): PlacedObject => ({
  id: ANCHOR_LANDMARK.id, catalogId: ANCHOR_LANDMARK.id, position: { x: 14, y: 14 }, width: 3, height: 3,
  rotation: 0, elevation: 0, locked: true,
});

function seed(state: GridState, ...objs: PlacedObject[]): void {
  for (const o of objs) state.objects.set(o.id, o);
}

describe('group actions', () => {
  it('resolves ids to the objects the map still holds', () => {
    const state = makeState();
    seed(state, tree('a', 4, 4));
    expect(groupMembers(state, ['a', 'gone']).map((o) => o.id)).toEqual(['a']);
  });

  it('deletes what it can and counts what it kept', () => {
    const state = makeState();
    const exec = makeExecutor(state);
    seed(state, tree('a', 4, 4), tree('b', 6, 6), plaza());

    const result = deleteGroup(exec, state, ['a', 'b', ANCHOR_LANDMARK.id]);
    expect(result.deleted).toBe(2);
    expect(result.kept).toBe(1);
    expect(state.objects.has(ANCHOR_LANDMARK.id)).toBe(true);
  });

  it('reports the refusal rather than announcing it, when nothing could go', () => {
    const state = makeState();
    const exec = makeExecutor(state);
    seed(state, plaza());

    const result = deleteGroup(exec, state, [ANCHOR_LANDMARK.id]);
    expect(result.deleted).toBe(0);
    expect(result.refusal).not.toBeNull();
  });

  it('collapses a group delete into one undo step', () => {
    const state = makeState();
    const exec = makeExecutor(state);
    seed(state, tree('a', 4, 4), tree('b', 6, 6));
    const before = exec.historyDepth();

    deleteGroup(exec, state, ['a', 'b']);
    expect(exec.historyDepth()).toBe(before + 1);
  });

  it('refuses a move whole when one member cannot land, naming the blocker', () => {
    const state = makeState();
    const exec = makeExecutor(state);
    seed(state, tree('a', 4, 4), plaza());

    const result = moveGroup(exec, state, ['a', ANCHOR_LANDMARK.id], { dx: 1, dy: 0 });
    expect(result.moved).toBe(0);
    expect(result.blockedBy).toBe(ANCHOR_LANDMARK.id);
    expect(result.refusal).not.toBeNull();
    expect(state.objects.get('a')!.position).toEqual({ x: 4, y: 4 });
  });
});
