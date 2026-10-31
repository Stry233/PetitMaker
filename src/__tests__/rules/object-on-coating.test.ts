/**
 * V-PLACE-COATED backstops a caller that places an object on coated cells without stripping them. It
 * is a post-stroke rule because V-PLACE-OVERLAP exempts coatings (the placement ghost probes before
 * the strip), so only the finished stroke can tell "coated over" from "left standing on".
 */
import { describe, it, expect } from 'vitest';
import { objectOnCoatingRule } from '../../rules/object-on-coating';
import { bumpObjectsVersion } from '../../core/model/grid-model';
import type { GridState, PlacedObject } from '../../core/model/types';
import { makeState, placeCmd, makeExecutor } from '../_support/map-state';

function withObjects(...objs: PlacedObject[]): GridState {
  const state = makeState(20, 20);
  for (const o of objs) state.objects.set(o.id, o);
  bumpObjectsVersion(state, { added: objs });
  return state;
}

const at = (id: string, catalogId: string, x: number, y: number): PlacedObject =>
  ({ id, catalogId, position: { x, y }, rotation: 0, elevation: 0 });

describe('V-PLACE-COATED: nothing stands on a road', () => {
  it('passes on a map with no roads at all', () => {
    expect(objectOnCoatingRule.validate(withObjects(at('t', 'tree-apple', 3, 3)))).toEqual([]);
  });

  it('passes when the object and the road are on different cells', () => {
    const state = withObjects(at('r', 'path-overgrown-dirt', 3, 3), at('t', 'tree-apple', 7, 7));
    expect(objectOnCoatingRule.validate(state)).toEqual([]);
  });

  it('reports the covered cells when an object stands on a road', () => {
    const state = withObjects(at('r', 'path-cobblestone', 4, 4), at('t', 'tree-apple', 4, 4));
    const errors = objectOnCoatingRule.validate(state);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.ruleId).toBe('V-PLACE-COATED');
    expect(errors[0]!.cells).toEqual([{ x: 4, y: 4 }]);
  });

  it('lets a flower or a tree stand on a plantable road, and only on one', () => {
    // The dirt road carries the `plantable` trait; the cobblestone does not.
    for (const plant of ['flower-daisy', 'tree-apple']) {
      expect(objectOnCoatingRule.validate(
        withObjects(at('r', 'path-overgrown-dirt', 4, 4), at('p', plant, 4, 4))), plant).toEqual([]);
      expect(objectOnCoatingRule.validate(
        withObjects(at('r', 'path-cobblestone', 4, 4), at('p', plant, 4, 4))).length, plant).toBeGreaterThan(0);
    }
  });

  it('exempts a crossing, whose deck is paved across on purpose', () => {
    // The generator routes streets bank to bank over bridges, so flagging this would revert every
    // generation that builds one.
    const state = withObjects(at('r', 'path-overgrown-dirt', 5, 5), at('b', 'bridge-plank', 5, 5));
    expect(objectOnCoatingRule.validate(state)).toEqual([]);
  });

  it('exempts a road over a road, which is the brush repainting', () => {
    const state = withObjects(at('r1', 'path-overgrown-dirt', 6, 6), at('r2', 'path-cobblestone', 6, 6));
    expect(objectOnCoatingRule.validate(state)).toEqual([]);
  });

  it('passes once the coating under the object is gone', () => {
    const state = withObjects(at('r', 'path-cobblestone', 4, 4), at('t', 'tree-apple', 4, 4));
    expect(objectOnCoatingRule.validate(state)).toHaveLength(1);

    const road = state.objects.get('r')!;
    state.objects.delete('r');
    bumpObjectsVersion(state, { removed: [road] });

    expect(objectOnCoatingRule.validate(state)).toEqual([]);
  });

  it('reverts a real stroke that placed an object on a road without stripping it', () => {
    // No command is refused (V-PLACE-OVERLAP exempts the road), so this rule alone reverts the stroke.
    const state = makeState(20, 20);
    const executor = makeExecutor(state);
    const placing = executor.beginStroke();
    expect(executor.execute(placeCmd(at('r', 'path-cobblestone', 4, 4))).success).toBe(true);
    placing.commit();

    const strokeStart = executor.beginStroke();
    expect(executor.execute(placeCmd(at('t', 'tree-apple', 4, 4))).success).toBe(true);
    const violations = strokeStart.commit();

    expect(violations.map((v) => v.ruleId)).toContain('V-PLACE-COATED');
    expect(state.objects.has('t')).toBe(false);
    expect(state.objects.has('r')).toBe(true);
  });

  it('answers firstOnly without sweeping the whole map', () => {
    const state = withObjects(
      at('r1', 'path-cobblestone', 1, 1), at('t1', 'tree-apple', 1, 1),
      at('r2', 'path-cobblestone', 9, 9), at('t2', 'tree-apple', 9, 9),
    );
    expect(objectOnCoatingRule.validate(state, { firstOnly: true })).toHaveLength(1);
    // The full sweep still names every offending cell, so the flash covers both.
    expect(objectOnCoatingRule.validate(state)[0]!.cells).toHaveLength(2);
  });
});
