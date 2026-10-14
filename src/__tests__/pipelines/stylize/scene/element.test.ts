/** An item's stylize element is its category's stylize word: a house is a building, trees and
 *  flora are planting, a road is a road, and everything else (a facility, a bridge, an unknown
 *  item) the illustration does not name. */
import { describe, it, expect } from 'vitest';
import { stylizeElementOf } from '../../../../pipelines/stylize/scene/element';
import { CATEGORIES } from '../../../../config/catalog/categories';
import { getKnownItems } from '../../../../state/catalog';

describe('stylizeElementOf', () => {
  it('reads every known item through its category row', () => {
    for (const item of getKnownItems()) {
      const row = CATEGORIES.find((c) => c.id === item.category)!;
      expect(stylizeElementOf(item), item.id).toBe(row.stylizeLabel ?? null);
    }
  });

  it('names nothing for a missing item', () => {
    expect(stylizeElementOf(undefined)).toBeNull();
  });
});
