import { describe, expect, it } from 'vitest';
import { getPlacedObjectSize, resolveAnchor } from '../../state/object-geometry';
import { footprintCells } from '../../core/grid/footprint';
import { getCatalogItem } from '../../state/catalog';
import { bumpObjectsVersion } from '../../core/model/grid-model';
import { CommandType, type CatalogItem, type PlacedObject, type Rotation } from '../../core/model/types';
import { createDefaultRegistry } from '../../rules/index';
import { planObjectMove, planObjectRotation } from '../../tools/placement/probe';
import { makeExecutor, makeState } from '../_support/map-state';
import { ItemCategory } from '../../config/catalog/categories';

/** A pointer read at (x, y) on both grids: the anchor the item snaps it to. */
const snapAt = (item: CatalogItem, x: number, y: number) => resolveAnchor(item, { x, y }, { x, y });

const halfItem: CatalogItem = {
  id: 'test-half-anchor', category: ItemCategory.Ramp, name: { en: 'Half' },
  width: 2, height: 4, loadValue: 0, rotatable: true, placementMode: 'point', traits: [{ type: 'halfStep' }],
};
const plainItem: CatalogItem = {
  id: 'test-plain-anchor', category: ItemCategory.Tree, name: { en: 'Plain' },
  width: 1, height: 1, loadValue: 0, rotatable: false, placementMode: 'point', traits: [],
};
/** Negative zero equals zero wherever an anchor is compared or keyed. */
const plain = (c: { x: number; y: number }) => ({ x: c.x + 0, y: c.y + 0 });

describe('anchor snapping ties and negatives', () => {
  it.each([
    [-1.5, -1], [-0.75, -1], [-0.5, 0], [-0.25, 0], [0.25, 0], [0.5, 1], [0.75, 1], [1.5, 2], [2.5, 3],
  ])('a whole-cell item at %s snaps to %s, ties toward +infinity', (at, to) => {
    expect(plain(snapAt(plainItem, at, at))).toEqual({ x: to, y: to });
  });

  it.each([
    [-1.25, -1], [-0.75, -0.5], [-0.25, 0], [0.25, 0.5], [0.5, 0.5], [0.75, 1], [1.25, 1.5], [2.74, 2.5],
  ])('a half-step item at %s snaps to %s, ties toward +infinity', (at, to) => {
    expect(plain(snapAt(halfItem, at, at))).toEqual({ x: to, y: to });
  });

  it('reads each item at its own granularity and adds the grab offset in that unit', () => {
    const whole = { x: 7, y: 5 }, half = { x: 7.5, y: 5 };
    expect(resolveAnchor(plainItem, whole, half)).toEqual({ x: 7, y: 5 });
    expect(resolveAnchor(halfItem, whole, half)).toEqual({ x: 7.5, y: 5 });
    expect(resolveAnchor(halfItem, whole, undefined)).toEqual({ x: 7, y: 5 });
    expect(resolveAnchor(halfItem, whole, half, { x: -0.5, y: 0.5 })).toEqual({ x: 7, y: 5.5 });
    expect(resolveAnchor(plainItem, whole, half, { x: -1, y: 2 })).toEqual({ x: 6, y: 7 });
  });
});

describe('a half anchor under rotation', () => {
  it.each([[0, 2, 4], [90, 4, 2], [180, 2, 4], [270, 4, 2]] as const)(
    'at rotation %s a 2 by 4 item spans %s by %s and names every cell it partly covers', (rotation, w, h) => {
      const obj: PlacedObject = { id: 'h', catalogId: 'ramp-park-steps', position: { x: 7.5, y: 5.5 }, rotation: rotation as Rotation, elevation: 0 };
      const size = getPlacedObjectSize(obj, halfItem);
      expect(size).toEqual({ w, h });
      const cells = footprintCells(7.5, 5.5, size.w, size.h);
      expect(cells).toHaveLength((w + 1) * (h + 1));
      expect(cells[0]).toEqual({ x: 7, y: 5 });
      expect(cells[cells.length - 1]).toEqual({ x: 7 + w, y: 5 + h });
    });
});

describe('anchors at the map edge', () => {
  it('a placement snapped past the edge is refused, and one just inside lands', () => {
    const state = makeState(20, 20);
    const registry = createDefaultRegistry();
    const tree = getCatalogItem('tree-apple')!;
    const at = (x: number, y: number) => ({ type: CommandType.PlaceObject as const,       object: { id: 't', catalogId: tree.id, position: plain(snapAt(tree, x, y)), rotation: 0 as const, elevation: 0 } });
    expect(registry.validatePreCommand(at(-0.25, 3), state)).toEqual([]);
    expect(registry.validatePreCommand(at(18.75, 3), state)).toEqual([]);
    expect(registry.validatePreCommand(at(-0.75, 3), state).length).toBeGreaterThan(0);
    expect(registry.validatePreCommand(at(19.5, 3), state).length).toBeGreaterThan(0);
  });
});

describe('a capped item on the move', () => {
  function withPavilion() {
    const state = makeState(40, 40);
    const pavilion: PlacedObject = { id: 'p', catalogId: 'facility-pavilion', position: { x: 5, y: 5 }, rotation: 0, elevation: 0 };
    state.objects.set(pavilion.id, pavilion);
    bumpObjectsVersion(state, { added: [pavilion] });
    return { state, exec: makeExecutor(state), pavilion };
  }

  it('moving or turning the only one of a capped item is not counted against its cap', () => {
    const { state, exec, pavilion } = withPavilion();
    expect(getCatalogItem('facility-pavilion')!.maxCount).toBe(1);
    expect(planObjectMove(exec, state, pavilion, 20, 20).errors.map((e) => e.ruleId)).not.toContain('V-PLACE-MAX');
    expect(planObjectRotation(exec, state, pavilion, 90).errors.map((e) => e.ruleId)).not.toContain('V-PLACE-MAX');
  });

  it('a second one is refused at its cap', () => {
    const { state } = withPavilion();
    const second = { type: CommandType.PlaceObject as const,       object: { id: 'q', catalogId: 'facility-pavilion', position: { x: 25, y: 25 }, rotation: 0 as const, elevation: 0 } };
    expect(createDefaultRegistry().validatePreCommand(second, state).map((e) => e.ruleId)).toContain('V-PLACE-MAX');
  });
});
