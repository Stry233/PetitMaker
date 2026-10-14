import { describe, expect, it } from 'vitest';
import { placementBlockers, placementOverlapRule } from '../../rules/placement-overlap';
import { bumpObjectsVersion } from '../../core/model/grid-model';
import { CommandType, type GridState, type PlacedObject } from '../../core/model/types';
import { PLACEMENT_GRID } from '../../core/game/profile';
import { makeExecutor, makeState } from '../_support/map-state';

const at = (id: string, catalogId: string, x: number, y: number): PlacedObject =>
  ({ id, catalogId, position: { x, y }, rotation: 0, elevation: 0 });
const place = (object: PlacedObject) => ({ type: CommandType.PlaceObject as const, object });

function withObjects(...objs: PlacedObject[]): GridState {
  const state = makeState(30, 30);
  for (const o of objs) state.objects.set(o.id, o);
  bumpObjectsVersion(state, { added: objs });
  return state;
}

describe('V-PLACE-OVERLAP: solid footprints never overlap', () => {
  const cabin = at('cabin', 'building-forest-cabin', 10, 10); // 5 by 4 cells

  it('refuses a solid over a solid and shades only the overlap', () => {
    const errors = placementOverlapRule.validate(place(at('t', 'tree-apple', 14, 13)), withObjects(cabin));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ ruleId: 'V-PLACE-OVERLAP', message: 'error.object_overlap', grid: PLACEMENT_GRID });
    expect(errors[0]!.rects).toEqual([{ x: 14, y: 13, w: 1, h: 1 }]);
  });

  it('shades every overlap when one footprint covers several objects', () => {
    const state = withObjects(at('a', 'tree-apple', 10, 10), at('b', 'tree-apple', 14, 13));
    const errors = placementOverlapRule.validate(place({ ...cabin, id: 'new' }), state);
    expect(errors[0]!.rects).toEqual(expect.arrayContaining([{ x: 10, y: 10, w: 1, h: 1 }, { x: 14, y: 13, w: 1, h: 1 }]));
    expect(errors[0]!.rects).toHaveLength(2);
  });

  it.each([[15, 10], [9, 10], [10, 14], [10, 9]])('allows a tree at (%s, %s), touching the cabin edge', (x, y) => {
    expect(placementOverlapRule.validate(place(at('t', 'tree-apple', x, y)), withObjects(cabin))).toEqual([]);
  });

  it('ignores the object being placed again in place, which is a move or a turn', () => {
    expect(placementOverlapRule.validate(place({ ...cabin }), withObjects(cabin))).toEqual([]);
  });

  it('refuses a placement under an id the map already holds, shading the object holding it', () => {
    const errors = placementOverlapRule.validate(place({ ...cabin, position: { x: 20, y: 20 } }), withObjects(cabin));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ ruleId: 'V-PLACE-OVERLAP', message: 'error.object_overlap' });
    expect(errors[0]!.rects).toEqual([{ x: 10, y: 10, w: 5, h: 4 }]);
    expect(placementOverlapRule.validate(place({ ...cabin, catalogId: 'tree-apple' }), withObjects(cabin))).toHaveLength(1);
  });

  it('keeps the first object when a second placement repeats its id, through undo', () => {
    const state = makeState(30, 30);
    const exec = makeExecutor(state);
    const whole = exec.beginStroke();
    const tree = at('dup', 'tree-apple', 5, 5);
    expect(exec.execute(place(tree)).success).toBe(true);
    whole.commit();
    expect(exec.execute(place({ ...tree, position: { x: 20, y: 20 } })).success).toBe(false);
    expect(state.objects.get('dup')!.position).toEqual({ x: 5, y: 5 });
    exec.undo();
    expect(state.objects.has('dup')).toBe(false);
    expect(exec.canUndo()).toBe(false);
  });

  it('still moves an object as a removal and a placement in one stroke', () => {
    const state = makeState(30, 30);
    const exec = makeExecutor(state);
    const whole = exec.beginStroke();
    const tree = at('t', 'tree-apple', 5, 5);
    exec.execute(place(tree));
    whole.commit();
    const start = exec.beginStroke();
    expect(exec.execute({ type: CommandType.RemoveObject, objectId: tree.id }).success).toBe(true);
    expect(exec.execute(place({ ...tree, position: { x: 20, y: 20 } })).success).toBe(true);
    expect(exec.execute(place({ ...tree, position: { x: 22, y: 20 } })).success).toBe(true);
    start.commit();
    expect(state.objects.get('t')!.position).toEqual({ x: 22, y: 20 });
  });

  it('lets the open stroke place an object it lifted anywhere, which is a move', () => {
    const state = withObjects(cabin);
    const scope = { lifted: new Map([[cabin.id, cabin]]) };
    expect(placementOverlapRule.validate(place({ ...cabin, position: { x: 20, y: 20 } }), state, scope)).toEqual([]);
  });

  it('lets a solid land over a road, which the placer strips in the same step', () => {
    const state = withObjects(at('road', 'path-garden-stone', 5, 5));
    expect(placementOverlapRule.validate(place(at('t', 'tree-apple', 5, 5)), state)).toEqual([]);
  });

  it('lets a road run under a structure that keeps roads, and refuses one under a tree', () => {
    expect(placementOverlapRule.validate(place(at('r', 'path-garden-stone', 12, 12)), withObjects(cabin))).toEqual([]);
    expect(placementOverlapRule.validate(place(at('r', 'path-garden-stone', 5, 5)), withObjects(at('t', 'tree-apple', 5, 5)))).toHaveLength(1);
  });

  it('refuses a second road on the same road layer', () => {
    const roads = withObjects(at('road', 'path-garden-stone', 5, 5));
    expect(placementOverlapRule.validate(place(at('r2', 'path-overgrown-dirt', 5, 5)), roads)).toHaveLength(1);
  });

  it('agrees with the blockers it shares with the repaint preview', () => {
    const state = withObjects(cabin, at('road', 'path-garden-stone', 20, 20));
    for (let y = 8; y < 23; y++) for (let x = 8; x < 23; x++) {
      for (const id of ['tree-apple', 'path-overgrown-dirt']) {
        const o = at('probe', id, x, y);
        expect(placementOverlapRule.validate(place(o), state).length > 0, `${id} at (${x}, ${y})`)
          .toBe(placementBlockers(o, state).length > 0);
      }
    }
  });
});
