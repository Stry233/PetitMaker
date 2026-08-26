import { describe, it, expect } from 'vitest';
import {
  searchCatalog, getCategoryMeta, getAllCategories, registerCatalogItem,
  getAllItems, getCatalogByCategory,
} from '../../state/catalog';
import { ItemCategory } from '../../core/model/types';
import { PLAZA_ID } from '../../core/model/constants';

describe('searchCatalog', () => {
  it('matches on the item name in the active locale', () => {
    const results = searchCatalog('苹果', 'zh');
    expect(results.some((i) => i.id === 'tree-apple')).toBe(true);
  });

  it('matches the English name even when the UI locale is not English', () => {
    const results = searchCatalog('apple', 'zh');
    expect(results.some((i) => i.name.en.toLowerCase().includes('apple'))).toBe(true);
  });

  it('is case-insensitive', () => {
    const lower = searchCatalog('apple', 'en');
    const upper = searchCatalog('APPLE', 'en');
    expect(upper.map((i) => i.id)).toEqual(lower.map((i) => i.id));
    expect(lower.length).toBeGreaterThan(0);
  });

  it('is diacritic-insensitive', () => {
    registerCatalogItem({
      id: 'test-diacritic-item', category: ItemCategory.Flora,
      name: { en: 'Café Flower', fr: 'Fleur de Café' }, icon: 'flower',
      width: 1, height: 1, loadValue: 0, rotatable: false, placementMode: 'point',
      traits: [],
    });
    const results = searchCatalog('cafe flower', 'en');
    expect(results.some((i) => i.id === 'test-diacritic-item')).toBe(true);
  });

  it('returns nothing for an empty or whitespace-only query', () => {
    expect(searchCatalog('', 'en')).toEqual([]);
    expect(searchCatalog('   ', 'en')).toEqual([]);
  });

  it('picks up items registered after the first search (index invalidation)', () => {
    // Prime the index for this locale before the fixture below is registered.
    searchCatalog('nonexistent-warmup-query', 'en');
    registerCatalogItem({
      id: 'test-invalidation-item', category: ItemCategory.Flora,
      name: { en: 'Zzyzx Bloom' }, icon: 'flower',
      width: 1, height: 1, loadValue: 0, rotatable: false, placementMode: 'point',
      traits: [],
    });
    const results = searchCatalog('zzyzx', 'en');
    expect(results.some((i) => i.id === 'test-invalidation-item')).toBe(true);
  });

  it('matches an authored alias the item\'s own name does not carry', () => {
    registerCatalogItem({
      id: 'test-alias-item', category: ItemCategory.Flora,
      name: { en: 'Quill Bloom', zh: '羽花' }, icon: 'flower',
      width: 1, height: 1, loadValue: 0, rotatable: false, placementMode: 'point',
      traits: [], aliases: ['pincushion', '针垫花'],
    });
    expect(searchCatalog('pincushion', 'en').some((i) => i.id === 'test-alias-item')).toBe(true);
    expect(searchCatalog('针垫花', 'zh').some((i) => i.id === 'test-alias-item')).toBe(true);
    // Aliases cross locales too, same as the name fields do.
    expect(searchCatalog('针垫花', 'en').some((i) => i.id === 'test-alias-item')).toBe(true);
  });

  it('ranks an item whose own NAME matches above one that only matches via alias, on an exact tie', () => {
    // Both fields are the exact string "Kappa", so `fuzzyScore` returns the identical raw number
    // for each — the only thing that can separate them is which kind of field produced it.
    registerCatalogItem({
      id: 'test-rank-by-name', category: ItemCategory.Flora,
      name: { en: 'Kappa' }, icon: 'flower',
      width: 1, height: 1, loadValue: 0, rotatable: false, placementMode: 'point', traits: [],
    });
    registerCatalogItem({
      id: 'test-rank-by-alias', category: ItemCategory.Flora,
      name: { en: 'Delta' }, icon: 'flower',
      width: 1, height: 1, loadValue: 0, rotatable: false, placementMode: 'point',
      traits: [], aliases: ['Kappa'],
    });
    const ids = searchCatalog('kappa', 'en').map((i) => i.id);
    expect(ids.indexOf('test-rank-by-name')).toBeLessThan(ids.indexOf('test-rank-by-alias'));
  });

  it('ranks a real catalog item whose NAME carries the colour above one that only carries it via a colour alias', () => {
    // "Red Sunflower" matches on its own name; "Apple Tree" matches only through its authored
    // colour alias ("red"/"红") — the reweight in bestScore must keep the name match ahead even
    // though the raw fuzzyScore tiers (both word-start substring, on "red"/"apple") don't favour
    // either on their own.
    const ids = searchCatalog('red', 'en').map((i) => i.id);
    expect(ids).toContain('flower-sunflower-red');
    expect(ids).toContain('tree-apple');
    expect(ids.indexOf('flower-sunflower-red')).toBeLessThan(ids.indexOf('tree-apple'));
  });

  it('finds the red set by colour in Chinese, including an item whose own name carries no colour word', () => {
    const ids = searchCatalog('红', 'zh').map((i) => i.id);
    expect(ids).toContain('flower-sunflower-red'); // name match ("红向日葵")
    // "竹果丰年小屋（云果）" names a building, not a colour — this is a colour ALIAS-only match.
    expect(ids).toContain('building-bamboo-cabin');
  });

  it('finds the cherry blossom tree by colour', () => {
    const ids = searchCatalog('pink', 'en').map((i) => i.id);
    expect(ids).toContain('tree-peach');
  });
});

describe('searchCatalog multi-term', () => {
  it('"red tree" ANDs a colour term with the new category facet: every result is a Tree', () => {
    const results = searchCatalog('red tree', 'en');
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((i) => i.category === ItemCategory.Tree)).toBe(true);
    const ids = results.map((i) => i.id);
    expect(ids).toContain('tree-plum'); // colour ALIAS match ("红"/"red")
    expect(ids).toContain('tree-apple'); // colour ALIAS match ("红"/"red")
  });

  it('a colour + category query finds only the matching-category, matching-colour item(s)', () => {
    // The catalog carries no yellow BUILDING (forcing one would violate the colour pass's own
    // "only a real colour identity" bar), so this exercises the same AND mechanism on a colour
    // the catalog actually has on a building: orange.
    const results = searchCatalog('orange house', 'en');
    const ids = results.map((i) => i.id);
    expect(ids).toEqual(expect.arrayContaining(['building-starbay-cabin', 'building-sunset-cabin']));
    expect(results.every((i) => i.category === ItemCategory.Building)).toBe(true);
  });

  it('spaced "红 花" and unspaced "红花" both find red flora', () => {
    const spaced = searchCatalog('红 花', 'zh');
    expect(spaced.some((i) => i.category === ItemCategory.Flora)).toBe(true);
    expect(spaced.map((i) => i.id)).toContain('flower-sunflower-red');

    const unspaced = searchCatalog('红花', 'zh');
    expect(unspaced.length).toBeGreaterThan(0);
    expect(unspaced.every((i) => i.category === ItemCategory.Flora)).toBe(true);
  });

  it('the CJK unspaced-fallback split never fires when the whole query already matches (a real name)', () => {
    // "樱花" (cherry blossom) is itself an alias of tree-peach — the whole 2-char query must match
    // as ONE unit and never split into "does 樱 match, and separately does 花 match".
    const ids = searchCatalog('樱花', 'zh').map((i) => i.id);
    expect(ids).toEqual(['tree-peach']);
  });

  it('an unmatched extra term excludes everything: "red asdfgh" finds nothing', () => {
    expect(searchCatalog('red asdfgh', 'en')).toEqual([]);
  });

  it('single-term search is unchanged: multi-term is a strict superset of behaviour, not a rewrite', () => {
    // Same pinned single-word cases as the tests above, run again here so the "single-term
    // identical" contract is asserted in its own right rather than implied by their passing.
    expect(searchCatalog('apple', 'en').map((i) => i.id)).toEqual(searchCatalog('apple ', 'en').map((i) => i.id));
    const ids = searchCatalog('red', 'en').map((i) => i.id);
    expect(ids.indexOf('flower-sunflower-red')).toBeLessThan(ids.indexOf('tree-apple'));
  });

  it('the category facet does not widen a SINGLE term: "bridge" alone still means named Bridge, not is-a-Bridge', () => {
    // The object shelf's own category tab already covers "every Bridge" — a lone category word
    // opening the facet here would make the two indistinguishable. "Suspension" is a real bridge
    // item with no "bridge" in its name or aliases, so it must stay out of a single-term search.
    const ids = searchCatalog('bridge', 'en').map((i) => i.id);
    expect(ids).toContain('bridge-iron'); // name match ("Iron Bridge")
    expect(ids).not.toContain('bridge-suspension');
  });
});

describe('getAllItems', () => {
  it('sees an item registered at runtime', () => {
    registerCatalogItem({
      id: 'test-getallitems-item', category: ItemCategory.Flora,
      name: { en: 'Runtime Fixture' }, icon: 'flower',
      width: 1, height: 1, loadValue: 0, rotatable: false, placementMode: 'point',
      traits: [],
    });
    expect(getAllItems().some((i) => i.id === 'test-getallitems-item')).toBe(true);
  });

  it('agrees with the union of every category', () => {
    const fromAllItems = getAllItems().map((i) => i.id).sort();
    const fromCategories = getAllCategories()
      .flatMap((c) => getCatalogByCategory(c))
      .map((i) => i.id)
      .sort();
    expect(fromAllItems).toEqual(fromCategories);
  });

  it('excludes the off-catalog plaza', () => {
    expect(getAllItems().some((i) => i.id === PLAZA_ID)).toBe(false);
  });
});

describe('getCategoryMeta', () => {
  const placeableCategories = getAllCategories().filter((c) => c !== ItemCategory.Road);

  it('has an entry for every category the placement shelf can open', () => {
    for (const cat of placeableCategories) {
      const meta = getCategoryMeta(cat);
      expect(meta, `missing metadata for category "${cat}"`).toBeDefined();
      expect(meta!.icon).toBeTruthy();
      expect(meta!.titleKey).toBeTruthy();
    }
  });

  it('returns undefined for road, which is a brush surface, not a placement tab', () => {
    expect(getCategoryMeta(ItemCategory.Road)).toBeUndefined();
  });
});
