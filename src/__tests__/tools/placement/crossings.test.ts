import { describe, expect, it } from 'vitest';
import { ItemCategory } from '../../../config/catalog/categories';
import { isCoating } from '../../../core/model/traits';
import { bySizeDesc } from '../../../core/grid/cell-sets';
import { getPlaceableByCategory, getPlaceableWhere } from '../../../state/catalog';
import { crossingPool, mainCrossingId } from '../../../tools/placement/crossings';

const ids = (items: readonly { id: string }[]): string[] => items.map((i) => i.id);

describe('trait pools', () => {
  it('hold the shipped bridges, ramps and road surfaces in authored order', () => {
    expect(ids(crossingPool('bridge'))).toEqual(ids(getPlaceableByCategory(ItemCategory.Bridge)));
    expect(ids(crossingPool('ramp'))).toEqual(ids(getPlaceableByCategory(ItemCategory.Ramp)));
    expect(ids(getPlaceableWhere(isCoating))).toEqual(ids(getPlaceableByCategory(ItemCategory.Road)));
  });

  it('try the grandest bridge and the first ramp first', () => {
    expect(mainCrossingId('bridge')).toBe([...crossingPool('bridge')].sort(bySizeDesc)[0]!.id);
    expect(mainCrossingId('ramp')).toBe(crossingPool('ramp')[0]!.id);
  });
});
