import { describe, it, expect } from 'vitest';
import { getCatalogItem, getCatalogByCategory, getAllItems, getKnownItems } from '../../state/catalog';
import { searchCatalog } from '../../state/catalog-search';
import { CATEGORIES, ItemCategory } from '../../config/catalog/categories';

describe('Catalog', () => {
  it('loads all items from catalog.json', () => {
    expect(getAllItems().length).toBeGreaterThan(0);
  });

  it('indexes items by id', () => {
    const item = getCatalogItem('building-myhouse');
    expect(item).toBeDefined();
    expect(item!.category).toBe('building');
  });

  it('indexes items by category', () => {
    const trees = getCatalogByCategory(ItemCategory.Tree);
    expect(trees.length).toBeGreaterThan(0);
    expect(trees.every(t => t.category === 'tree')).toBe(true);
  });

  it('offers items in every registered category', () => {
    for (const { id } of CATEGORIES) expect(getCatalogByCategory(id).length).toBeGreaterThan(0);
  });
});

describe('a disabled catalog item', () => {
  const id = 'facility-station';

  it('stays known, so saves holding one still load and render', () => {
    expect(getCatalogItem(id)).toBeDefined();
    expect(getKnownItems().some((i) => i.id === id)).toBe(true);
  });

  it('is offered by no list, tab or search', () => {
    expect(getAllItems().some((i) => i.id === id)).toBe(false);
    expect(getCatalogByCategory(ItemCategory.Facility).some((i) => i.id === id)).toBe(false);
    expect(searchCatalog('station', 'en').some((i) => i.id === id)).toBe(false);
  });
});

/** The one place a test states catalog values: footprints and caps the game shows, which other
 *  tests read from the catalog rather than repeat. */
describe('in-game item facts', () => {
  it.each([
    ['building-myhouse', 7, 4],
    ['building-bamboo-cabin', 5, 5],
    ['building-plush-cabin', 5, 5],
    ['facility-pavilion', 6, 5],
  ] as const)('%s is %i wide and %i deep', (id, width, height) => {
    const item = getCatalogItem(id)!;
    expect([item.width, item.height]).toEqual([width, height]);
  });

  it('caps the Omni-Gallery at one per map and leaves the consignment stall uncapped', () => {
    expect(getCatalogItem('facility-pavilion')!.maxCount).toBe(1);
    expect(getCatalogItem('building-stall')!.maxCount).toBeUndefined();
  });
});

// Roads have a confirmed zero cost, distinct from unmeasured catalog entries.
it('marks road loads as known zero and keeps unknown loads weightless', () => {
  for (const item of getAllItems()) {
    if (item.id.startsWith('path-')) {
      expect(item.loadValue).toBe(0);
      expect(item.loadUnknown).not.toBe(true);
    }
    if (item.loadUnknown) expect(item.loadValue).toBe(0);
  }
});
