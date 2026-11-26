/** Taking the newest step back as a step of its own: the map stands as before that step, an undo
 *  brings the step's work back and a redo takes it away again, as for any edit. */
import { describe, expect, it } from 'vitest';
import { CommandType, TerrainType, type PlacedObject } from '../../../core/model/types';
import { mapFingerprint } from '../../../core/model/fingerprint';
import { makeExecutor, makeState } from '../../_support/map-state';

const road = (id: string, x: number, y: number): PlacedObject => ({ id, catalogId: 'path-overgrown-dirt', position: { x, y }, rotation: 0, elevation: 0 });

function setup() {
  const state = makeState(12, 12);
  const executor = makeExecutor(state);
  return { state, executor, print: () => mapFingerprint(state) };
}

describe('revertTopAsStep', () => {
  it('takes back a single step as an edit that undo reverses and redo repeats', () => {
    const { state, executor, print } = setup();
    const before = print();
    expect(executor.execute({ type: CommandType.PaintTerrain, cells: [{ x: 4, y: 4 }], terrainType: TerrainType.Mountain, elevation: 0 }).success).toBe(true);
    const painted = print();
    expect(executor.revertTopAsStep()).toBe(true);
    expect(print()).toBe(before);
    expect(state.cells[4]![4]!.terrain).toBeNull();
    expect(executor.historyDepth()).toBe(2);
    executor.undo();
    expect(print()).toBe(painted);
    executor.redo();
    expect(print()).toBe(before);
  });

  it('takes back a folded stroke that removed an object, bringing the removed object back', () => {
    const { state, executor, print } = setup();
    expect(executor.execute({ type: CommandType.PlaceObject, object: road('a', 2, 2) }).success).toBe(true);
    const before = print();
    // A stroke that strips the road under it and lays another beside: one folded step.
    const stroke = executor.beginStroke();
    executor.execute({ type: CommandType.RemoveObject, objectId: 'a' });
    executor.execute({ type: CommandType.PlaceObject, object: road('b', 5, 5) });
    stroke.commit();
    expect(executor.historyDepth()).toBe(2);
    const laid = print();
    executor.revertTopAsStep();
    expect(state.objects.has('a')).toBe(true);
    expect(state.objects.has('b')).toBe(false);
    expect(print()).toBe(before);
    executor.undo();
    expect(print()).toBe(laid);
    expect(state.objects.has('a')).toBe(false);
    executor.redo();
    expect(print()).toBe(before);
  });

  it('clears what could be redone, as any new edit does', () => {
    const { executor } = setup();
    executor.execute({ type: CommandType.PlaceObject, object: road('a', 2, 2) });
    executor.execute({ type: CommandType.PlaceObject, object: road('b', 4, 4) });
    executor.undo();
    expect(executor.canRedo()).toBe(true);
    executor.revertTopAsStep();
    expect(executor.canRedo()).toBe(false);
  });

  it("leaves the map's provenance as it stood before the step, and its undo as it stood after", () => {
    const { executor } = setup();
    const summary = () => JSON.stringify(executor.getProvenanceSummary());
    const empty = summary();
    executor.execute({ type: CommandType.PlaceObject, object: road('a', 2, 2) });
    const placed = summary();
    executor.revertTopAsStep();
    expect(summary()).toBe(empty);
    executor.undo();
    expect(summary()).toBe(placed);
    executor.redo();
    expect(summary()).toBe(empty);
  });

  it('is false with nothing to take back', () => {
    expect(setup().executor.revertTopAsStep()).toBe(false);
  });
});
