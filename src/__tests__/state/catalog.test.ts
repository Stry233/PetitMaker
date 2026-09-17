import { describe, it, expect } from 'vitest';
import { getCatalogItem, getCatalogByCategory, getAllCategories, getAllItems, getKnownItems, searchCatalog } from '../../state/catalog';
import { ItemCategory } from '../../core/model/types';

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

  it('returns all categories present in catalog', () => {
    const cats = getAllCategories();
    expect(cats).toContain('building');
    expect(cats).toContain('tree');
    expect(cats).toContain('road');
    expect(cats).toContain('bridge');
  });

  it('each item has required fields', () => {
    for (const item of getAllItems()) {
      expect(item.id).toBeTruthy();
      expect(item.category).toBeTruthy();
      expect(item.name.en).toBeTruthy();
      expect(item.name.zh).toBeTruthy();
      expect(item.icon ?? item.color).toBeTruthy(); // every item renders as a sprite or a colour swatch
      expect(typeof item.width).toBe('number');
      expect(typeof item.height).toBe('number');
      expect(typeof item.loadValue).toBe('number');
      expect(typeof item.rotatable).toBe('boolean');
      expect(['point', 'brush']).toContain(item.placementMode);
      expect(Array.isArray(item.traits)).toBe(true);
    }
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
