import { describe, expect, it } from 'vitest';
import { lockedObjectRule } from '../../rules/locked-object';
import { bumpObjectsVersion } from '../../core/model/grid-model';
import { CommandType, type Command, type PlacedObject } from '../../core/model/types';
import { PLACEMENT_GRID } from '../../core/game/profile';
import { makeExecutor, makeState } from '../_support/map-state';

const locked: PlacedObject = { id: 'fixed', catalogId: 'building-forest-cabin', position: { x: 4, y: 4 }, rotation: 0, elevation: 0, locked: true };
const free: PlacedObject = { id: 'free', catalogId: 'tree-apple', position: { x: 12, y: 12 }, rotation: 0, elevation: 0 };
const remove = (o: PlacedObject): Command => ({ type: CommandType.RemoveObject, objectId: o.id });

function world() {
  const state = makeState(20, 20);
  for (const o of [locked, free]) state.objects.set(o.id, { ...o });
  bumpObjectsVersion(state, { added: [locked, free] });
  return state;
}

describe('V-LOCK-02: locked objects stay', () => {
  it('refuses to remove a locked object and shows its whole footprint', () => {
    const errors = lockedObjectRule.validate(remove(locked), world());
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ ruleId: 'V-LOCK-02', message: 'error.locked_immutable', grid: PLACEMENT_GRID });
    // The cabin is 5 by 4 cells from (4, 4).
    expect(errors[0]!.cells).toHaveLength(20);
    expect(errors[0]!.cells).toContainEqual({ x: 8, y: 7 });
    expect(errors[0]!.cells).not.toContainEqual({ x: 9, y: 7 });
  });

  it('lets an unlocked object go, and ignores an object no longer on the map', () => {
    const state = world();
    expect(lockedObjectRule.validate(remove(free), state)).toEqual([]);
    expect(lockedObjectRule.validate(remove({ ...locked, id: 'gone' }), state)).toEqual([]);
  });

  it('judges the object on the map, not the copy the command carries', () => {
    expect(lockedObjectRule.validate(remove({ ...locked, locked: false }), world())).toHaveLength(1);
    expect(lockedObjectRule.validate(remove({ ...free, locked: true }), world())).toEqual([]);
  });

  it('applies to removals only', () => {
    expect(lockedObjectRule.appliesTo).toEqual([CommandType.RemoveObject]);
    expect(lockedObjectRule.validate({ type: CommandType.PlaceObject, object: locked }, world())).toEqual([]);
  });

  it('leaves the map and history untouched when the executor refuses', () => {
    const state = world();
    const exec = makeExecutor(state);
    expect(exec.execute(remove(locked)).success).toBe(false);
    expect(state.objects.get(locked.id)).toEqual(locked);
    expect(exec.canUndo()).toBe(false);
  });
});
