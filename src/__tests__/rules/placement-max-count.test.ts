import { describe, it, expect } from 'vitest';
import { placementMaxCountRule } from '../../rules/placement-max-count';
import { CommandType, ItemCategory, ObjectCategory, type PlacedObject, type PlaceObjectCommand } from '../../core/model/types';
import { getCatalogItem, registerCatalogItem } from '../../state/catalog';
import { makeState } from './_helpers';

const obj = (id: string, catalogId: string, x = 5, y = 5): PlacedObject =>
  ({ id, catalogId, position: { x, y }, rotation: 0, category: ObjectCategory.Facility, elevation: 0 });

const place = (o: PlacedObject): PlaceObjectCommand =>
  ({ type: CommandType.PlaceObject, timestamp: 0, object: o, loadValue: 0 });

describe('V-PLACE-MAX: per-item placement cap', () => {
  it('allows the first placement of a maxCount: 1 item', () => {
    const state = makeState(20, 20);
    expect(getCatalogItem('facility-pavilion')!.maxCount).toBe(1);
    expect(placementMaxCountRule.validate(place(obj('a', 'facility-pavilion')), state)).toHaveLength(0);
  });

  it('rejects a second placement once one already exists, reporting the cap', () => {
    const state = makeState(20, 20);
    state.objects.set('a', obj('a', 'facility-pavilion', 5, 5));
    const errs = placementMaxCountRule.validate(place(obj('b', 'facility-pavilion', 9, 5)), state);
    expect(errs).toHaveLength(1);
    expect(errs[0]!.ruleId).toBe('V-PLACE-MAX');
    expect(errs[0]!.messageParams).toEqual({ n: 1 }); // message interpolates the actual cap
  });

  it('handles caps > 1 generically (allows up to N, rejects N+1)', () => {
    registerCatalogItem({
      id: 'test-triple', category: ItemCategory.Building, name: { en: 'Triple', zh: '三' },
      emoji: '❓', width: 1, height: 1, loadValue: 0, maxCount: 3,
      rotatable: false, placementMode: 'point', traits: [],
    });
    const state = makeState(20, 20);
    state.objects.set('a', obj('a', 'test-triple', 3, 5));
    state.objects.set('b', obj('b', 'test-triple', 6, 5));
    // 2 placed < cap 3 → a third is allowed
    expect(placementMaxCountRule.validate(place(obj('c', 'test-triple', 9, 5)), state)).toHaveLength(0);
    // 3 placed → the fourth is rejected, and the message reports the cap of 3
    state.objects.set('c', obj('c', 'test-triple', 9, 5));
    const errs = placementMaxCountRule.validate(place(obj('d', 'test-triple', 12, 5)), state);
    expect(errs).toHaveLength(1);
    expect(errs[0]!.messageParams).toEqual({ n: 3 });
  });

  it('counts only the same catalogId (a different one-of item is unaffected)', () => {
    const state = makeState(20, 20);
    state.objects.set('a', obj('a', 'facility-pavilion', 5, 5));
    expect(placementMaxCountRule.validate(place(obj('b', 'building-myhouse', 9, 5)), state)).toHaveLength(0);
  });

  it('does not limit items without maxCount (e.g. the consignment stall)', () => {
    const state = makeState(20, 20);
    expect(getCatalogItem('building-stall')!.maxCount).toBeUndefined();
    state.objects.set('a', obj('a', 'building-stall', 5, 5));
    state.objects.set('b', obj('b', 'building-stall', 9, 5));
    expect(placementMaxCountRule.validate(place(obj('c', 'building-stall', 13, 5)), state)).toHaveLength(0);
  });
});
