import { describe, expect, it } from 'vitest';
import { ROTATIONS, type GridState, type PlacedObject, type Rotation } from '../../core/model/types';
import { getRotatedSize } from '../../core/grid/footprint';
import { findTrait } from '../../core/model/traits';
import { getCatalogItem, getCatalogByRole } from '../../state/catalog';
import { hasGate } from '../../state/object-geometry';
import { traitPlacementRule } from '../../rules/placement';
import { createDefaultRegistry } from '../../rules/index';
import { makeState, placeCmd } from '../_support/map-state';

const HOUSE = 'building-forest-cabin';
const TREE = 'tree-apple';
const at = (id: string, catalogId: string, x: number, y: number, rotation: Rotation = 0): PlacedObject =>
  ({ id, catalogId, position: { x, y }, rotation, elevation: 0 });

/** A 40 x 40 grass map with a house standing at (16, 16), unturned (5 x 4). */
function withHouse(): GridState {
  const state = makeState(40, 40);
  state.objects.set('h', at('h', HOUSE, 16, 16));
  return state;
}

const messages = (state: GridState, obj: PlacedObject) =>
  traitPlacementRule.validate(placeCmd(obj), state).map((e) => [e.message, e.messageParams?.n]);

describe('exclusionRadius between houses and trees', () => {
  it('every house carries the trees\' spacing mechanism, at one cell', () => {
    for (const item of getCatalogByRole('home').filter(hasGate)) expect(findTrait(item, 'exclusionRadius'), item.id).toEqual({ type: 'exclusionRadius', radius: 1 });
    expect(findTrait(getCatalogItem('building-stall'), 'exclusionRadius')).toBeUndefined();
  });

  it.each(ROTATIONS)('keeps a cell between two houses on every side, the second turned %i degrees', (rotation) => {
    const state = withHouse();
    const { w, h } = getRotatedSize(getCatalogItem(HOUSE)!, rotation);
    // East, west, south and north of the standing house's 5 x 4 footprint at (16..20, 16..19).
    const sides = (gap: number) => [
      { x: 21 + gap, y: 16 }, { x: 16 - w - gap, y: 16 }, { x: 16, y: 20 + gap }, { x: 16, y: 16 - h - gap },
    ];
    for (const p of sides(0)) expect(messages(state, at('n', HOUSE, p.x, p.y, rotation)), `${p.x},${p.y}`).toEqual([['error.house_too_close', 1]]);
    for (const p of sides(1)) expect(messages(state, at('n', HOUSE, p.x, p.y, rotation)), `${p.x},${p.y}`).toEqual([]);
  });

  it.each(ROTATIONS)('counts a diagonal corner as touching, the second house turned %i degrees', (rotation) => {
    const state = withHouse();
    const { w, h } = getRotatedSize(getCatalogItem(HOUSE)!, rotation);
    const corners = (gap: number) => [
      { x: 21 + gap, y: 20 + gap }, { x: 16 - w - gap, y: 20 + gap }, { x: 21 + gap, y: 16 - h - gap }, { x: 16 - w - gap, y: 16 - h - gap },
    ];
    for (const p of corners(0)) expect(messages(state, at('n', HOUSE, p.x, p.y, rotation)), `${p.x},${p.y}`).toEqual([['error.house_too_close', 1]]);
    for (const p of corners(1)) expect(messages(state, at('n', HOUSE, p.x, p.y, rotation)), `${p.x},${p.y}`).toEqual([]);
  });

  it.each(ROTATIONS)('keeps a cell between a house turned %i degrees and a tree, whichever comes second', (rotation) => {
    const { w, h } = getRotatedSize(getCatalogItem(HOUSE)!, rotation);
    const house = at('h', HOUSE, 16, 16, rotation);
    const touching = [
      { x: 16 + w, y: 16 }, { x: 15, y: 16 + h - 1 }, { x: 16, y: 16 + h }, { x: 16 + w - 1, y: 15 }, { x: 16 + w, y: 16 + h }, { x: 15, y: 15 },
    ];
    const clear = [{ x: 17 + w, y: 16 }, { x: 14, y: 16 }, { x: 16, y: 17 + h }, { x: 16, y: 14 }, { x: 17 + w, y: 17 + h }, { x: 14, y: 14 }];
    for (const t of touching) {
      const state = makeState(40, 40);
      state.objects.set('h', house);
      expect(messages(state, at('t', TREE, t.x, t.y)), `tree at ${t.x},${t.y}`).toEqual([['error.house_tree_too_close', 1]]);
      const planted = makeState(40, 40);
      planted.objects.set('t', at('t', TREE, t.x, t.y));
      expect(messages(planted, house), `house beside the tree at ${t.x},${t.y}`).toEqual([['error.house_tree_too_close', 1]]);
    }
    for (const t of clear) {
      const state = makeState(40, 40);
      state.objects.set('h', house);
      expect(messages(state, at('t', TREE, t.x, t.y)), `tree at ${t.x},${t.y}`).toEqual([]);
    }
  });

  it('leaves trees spaced as before, and flowers and stalls free beside a house', () => {
    const state = withHouse();
    state.objects.set('t', at('t', TREE, 30, 30));
    expect(messages(state, at('t2', TREE, 31, 31))).toEqual([['error.too_close_same_kind', 1]]);
    expect(messages(state, at('t2', TREE, 32, 30))).toEqual([]);
    const flower = getCatalogByRole('groundcover')[0]!.id;
    expect(messages(state, at('f', flower, 21, 16))).toEqual([]);
    expect(messages(state, at('s', 'building-stall', 21, 16))).toEqual([]);
  });

  it('moving a house onto its own spot is not spacing against itself', () => {
    const state = withHouse();
    expect(createDefaultRegistry().validatePreCommand(placeCmd(at('h', HOUSE, 16, 16)), state).filter((e) => e.ruleId === 'V-PLACE-TRAIT')).toEqual([]);
  });
});
