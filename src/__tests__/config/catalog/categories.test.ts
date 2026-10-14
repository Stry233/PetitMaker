import { describe, expect, it } from 'vitest';
import { CATEGORIES, placedCategories, ItemCategory } from '../../../config/catalog/categories';
import { isCoatingItem, isCrossing } from '../../../core/model/traits';
import { LANDMARK_ITEMS } from '../../../config/catalog/landmarks';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const CATALOG_DIR = resolve(__dirname, '../../../config/catalog');

describe('the category registry', () => {
  it('lists every item record in a category folder, the landmark bodies kept there excepted', () => {
    const listed = new Set([...CATEGORIES.flatMap((c) => c.items), ...LANDMARK_ITEMS].map((i) => i.id));
    const unlisted = readdirSync(CATALOG_DIR, { withFileTypes: true }).filter((e) => e.isDirectory()).flatMap((dir) =>
      readdirSync(join(CATALOG_DIR, dir.name)).filter((f) => f.endsWith('.json') && !f.endsWith('.model.json'))
        .map((f) => (JSON.parse(readFileSync(join(CATALOG_DIR, dir.name, f), 'utf8')) as { id: string }).id))
      .filter((id) => !listed.has(id));
    expect(unlisted).toEqual([]);
    const landmarks = new Set(LANDMARK_ITEMS.map((i) => i.id));
    expect(CATEGORIES.flatMap((c) => c.items).filter((i) => landmarks.has(i.id))).toEqual([]);
  });

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

  it('gives each role to at most one category', () => {
    const roles = CATEGORIES.flatMap((c) => (c.role ? [c.role] : []));
    expect(roles).toEqual([...new Set(roles)]);
  });

  it('leaves a category without a role only where every item is a surface or a crossing by its traits', () => {
    const unnamed = CATEGORIES.filter((c) => !c.role).flatMap((c) => c.items).filter((i) => !isCoatingItem(i) && !isCrossing(i));
    expect(unnamed.map((i) => i.id)).toEqual([]);
  });

  it('leaves road, a brush surface, off every placement surface', () => {
    expect(CATEGORIES.find((c) => c.id === ItemCategory.Road)!.placement).toBeUndefined();
  });
});
