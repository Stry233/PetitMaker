import { describe, expect, it } from 'vitest';
import { ItemCategory } from '../../core/model/types';
import { CATEGORIES, placedCategories } from '../../config/catalog/categories';

describe('the category registry', () => {
  it('lists every item category exactly once, each with a tint', () => {
    expect(CATEGORIES.map((c) => c.id).sort()).toEqual(Object.values(ItemCategory).sort());
    for (const c of CATEGORIES) expect(Number.isInteger(c.tint)).toBe(true);
  });

  it('holds only items of the entry\'s own category', () => {
    for (const c of CATEGORIES) for (const item of c.items) expect(item.category).toBe(c.id);
  });

  it('gives each surface a distinct position for every placed category', () => {
    const placed = CATEGORIES.filter((c) => c.placement).length;
    for (const rank of ['menuRank', 'shelfRank', 'checklistRank'] as const) {
      const ranks = placedCategories(rank).map((c) => c.placement[rank]);
      expect(ranks).toEqual([...Array(placed).keys()]);
    }
  });

  it('leaves road, a brush surface, off every placement surface', () => {
    expect(CATEGORIES.find((c) => c.id === ItemCategory.Road)!.placement).toBeUndefined();
  });
});
