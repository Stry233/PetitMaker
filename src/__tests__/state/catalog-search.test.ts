import { describe, it, expect } from 'vitest';
import { __setCatalogItem, getAllItems, getCatalogByCategory } from '../../state/catalog';
import { searchCatalog } from '../../state/catalog-search';
import { LOCALES, type Locale } from '../../core/model/locale';
import { CATEGORIES, ItemCategory } from '../../config/catalog/categories';
import { categorySearchTerms } from '../../i18n/category-terms';
import { ANCHOR_LANDMARK } from '../_support/anchor';

const search = (query: string, locale: Locale) => searchCatalog(query, locale, categorySearchTerms(locale));

describe('searchCatalog', () => {
  it('matches on the item name in the active locale', () => {
    const results = searchCatalog('苹果', 'zh');
    expect(results.some((i) => i.id === 'tree-apple')).toBe(true);
  });

  it('matches the English name even when the UI locale is not English', () => {
    const results = searchCatalog('apple', 'zh');
    expect(results.some((i) => i.name.en.toLowerCase().includes('apple'))).toBe(true);
  });

  it.each([
    ['bridge-suspension', 'Simple Wooden Suspension Bridge'],
    ['building-bamboo-cabin', "Yunguo's Bamboo Harvest House"],
    ['flower-rose-cyan', 'Teal Mooncycle Rose'],
  ])('finds %s by its English name across locales', (id, name) => {
    for (const locale of ['en', 'zh'] as const) {
      expect(searchCatalog(name, locale).some(item => item.id === id)).toBe(true);
    }
  });

  it('is case-insensitive', () => {
    const lower = searchCatalog('apple', 'en');
    const upper = searchCatalog('APPLE', 'en');
    expect(upper.map((i) => i.id)).toEqual(lower.map((i) => i.id));
    expect(lower.length).toBeGreaterThan(0);
  });

  it('is diacritic-insensitive', () => {
    __setCatalogItem({
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
    __setCatalogItem({
      id: 'test-invalidation-item', category: ItemCategory.Flora,
      name: { en: 'Zzyzx Bloom' }, icon: 'flower',
      width: 1, height: 1, loadValue: 0, rotatable: false, placementMode: 'point',
      traits: [],
    });
    const results = searchCatalog('zzyzx', 'en');
    expect(results.some((i) => i.id === 'test-invalidation-item')).toBe(true);
  });

  it('matches an authored alias the item\'s own name does not carry', () => {
    __setCatalogItem({
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
    __setCatalogItem({
      id: 'test-rank-by-name', category: ItemCategory.Flora,
      name: { en: 'Kappa' }, icon: 'flower',
      width: 1, height: 1, loadValue: 0, rotatable: false, placementMode: 'point', traits: [],
    });
    __setCatalogItem({
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
    // colour alias ("red" and its Chinese form), and the reweight in bestScore must keep the name match ahead even
    // though the raw fuzzyScore tiers (both word-start substring, on "red"/"apple") don't favour
    // either on their own.
    const ids = searchCatalog('red', 'en').map((i) => i.id);
    expect(ids).toContain('flower-sunflower-red');
    expect(ids).toContain('tree-apple');
    expect(ids.indexOf('flower-sunflower-red')).toBeLessThan(ids.indexOf('tree-apple'));
  });

  it('finds the red set by colour in Chinese, including an item whose own name carries no colour word', () => {
    const ids = searchCatalog('红', 'zh').map((i) => i.id);
    expect(ids).toContain('flower-sunflower-red'); // name match
    // The bamboo cabin's name names a building, not a colour: this is a colour ALIAS-only match.
    expect(ids).toContain('building-bamboo-cabin');
  });

  it('finds the cherry blossom tree by colour', () => {
    const ids = searchCatalog('pink', 'en').map((i) => i.id);
    expect(ids).toContain('tree-peach');
  });
});

describe('searchCatalog multi-term', () => {
  it('"red tree" ANDs a colour term with the new category facet: every result is a Tree', () => {
    const results = search('red tree', 'en');
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((i) => i.category === ItemCategory.Tree)).toBe(true);
    const ids = results.map((i) => i.id);
    expect(ids).toContain('tree-plum'); // colour alias match
    expect(ids).toContain('tree-apple'); // colour alias match
  });

  it('a colour + category query finds only the matching-category, matching-colour item(s)', () => {
    // The catalog carries no yellow building (forcing one would violate the colour pass's own
    // "only a real colour identity" bar), so this exercises the same and mechanism on a colour
    // the catalog actually has on a building: orange.
    const results = search('orange house', 'en');
    const ids = results.map((i) => i.id);
    expect(ids).toEqual(expect.arrayContaining(['building-starbay-cabin', 'building-sunset-cabin']));
    expect(results.every((i) => i.category === ItemCategory.Building)).toBe(true);
  });

  it('spaced and unspaced red-flower queries both find red flora', () => {
    const spaced = search('红 花', 'zh');
    expect(spaced.some((i) => i.category === ItemCategory.Flora)).toBe(true);
    expect(spaced.map((i) => i.id)).toContain('flower-sunflower-red');

    const unspaced = search('红花', 'zh');
    expect(unspaced.length).toBeGreaterThan(0);
    expect(unspaced.every((i) => i.category === ItemCategory.Flora)).toBe(true);
  });

  it('the CJK unspaced-fallback split never fires when the whole query already matches (a real name)', () => {
    // The cherry-blossom query is itself an alias of tree-peach: the whole 2-char query must match
    // as one unit and never split into one term per character.
    const ids = searchCatalog('樱花', 'zh').map((i) => i.id);
    expect(ids).toEqual(['tree-peach']);
  });

  it('an unmatched extra term excludes everything: "red asdfgh" finds nothing', () => {
    expect(search('red asdfgh', 'en')).toEqual([]);
  });

  it('single-term search is unchanged: multi-term is a strict superset of behaviour, not a rewrite', () => {
    // Same pinned single-word cases as the tests above, run again here so the "single-term
    // identical" contract is asserted in its own right rather than implied by their passing.
    expect(searchCatalog('apple', 'en').map((i) => i.id)).toEqual(searchCatalog('apple ', 'en').map((i) => i.id));
    const ids = searchCatalog('red', 'en').map((i) => i.id);
    expect(ids.indexOf('flower-sunflower-red')).toBeLessThan(ids.indexOf('tree-apple'));
  });

  it('the category facet does not widen a SINGLE term: "bridge" alone still means named Bridge, not is-a-Bridge', () => {
    __setCatalogItem({
      id: 'test-category-only-bridge', category: ItemCategory.Bridge,
      name: { en: 'Overpass' }, icon: 'bridge',
      width: 2, height: 1, loadValue: 0, rotatable: false, placementMode: 'point', traits: [],
    });
    const ids = search('bridge', 'en').map((i) => i.id);
    expect(ids).toContain('bridge-iron');
    expect(ids).not.toContain('test-category-only-bridge');
  });
});

describe('getAllItems', () => {
  it('sees an item registered at runtime', () => {
    __setCatalogItem({
      id: 'test-getallitems-item', category: ItemCategory.Flora,
      name: { en: 'Runtime Fixture' }, icon: 'flower',
      width: 1, height: 1, loadValue: 0, rotatable: false, placementMode: 'point',
      traits: [],
    });
    expect(getAllItems().some((i) => i.id === 'test-getallitems-item')).toBe(true);
  });

  it('agrees with the union of every category', () => {
    const fromAllItems = getAllItems().map((i) => i.id).sort();
    const fromCategories = CATEGORIES
      .flatMap((c) => getCatalogByCategory(c.id))
      .map((i) => i.id)
      .sort();
    expect(fromAllItems).toEqual(fromCategories);
  });

  it('excludes the off-catalog plaza', () => {
    expect(getAllItems().some((i) => i.id === ANCHOR_LANDMARK.id)).toBe(false);
  });
});

describe('category search terms', () => {
  const locales = LOCALES;

  it('give every category the words of every locale, the active locale first, then English', () => {
    for (const locale of locales) {
      const terms = categorySearchTerms(locale);
      for (const { id } of CATEGORIES) {
        const all = new Set(locales.flatMap((l) => categorySearchTerms(l)(id)));
        expect(new Set(terms(id))).toEqual(all);
        expect(terms(id)[0]).toBe(categorySearchTerms(locale)(id)[0]);
      }
    }
    expect(categorySearchTerms('fr')(ItemCategory.Tree).indexOf('tree'))
      .toBeLessThan(categorySearchTerms('fr')(ItemCategory.Tree).indexOf('木'));
  });

  // The category words search answered to before they moved into the locale tables.
  const earlierTerms: ReadonlyArray<readonly [ItemCategory, readonly string[]]> = [
    [ItemCategory.Building, ['building', '建筑', 'house', 'home', 'cabin', '房', '屋', '家']],
    [ItemCategory.Tree, ['tree', '树木', '树', '木']],
    [ItemCategory.Flora, ['flora', '花卉', 'flower', 'plant', 'grass', '花', '草', '植物']],
    [ItemCategory.Bridge, ['bridge', '桥梁', '桥']],
    [ItemCategory.Ramp, ['ramp', '坡道', '坡', 'slope']],
    [ItemCategory.Facility, ['facility', '设施']],
  ];

  it.each(locales)('keep every earlier category word in %s', (locale) => {
    for (const [category, words] of earlierTerms) {
      expect(categorySearchTerms(locale)(category)).toEqual(expect.arrayContaining([...words]));
    }
  });

  it('answer to the displayed tab and menu names', () => {
    for (const [query, locale] of [['red arbres', 'fr'], ['red Деревья', 'ru'], ['red arbres', 'en']] as const) {
      expect(search(query, locale).map((i) => i.id), query).toContain('tree-plum');
    }
  });

  it('let a category word narrow a query in a locale other than English', () => {
    expect(search('red arbre', 'fr').map((i) => i.id)).toContain('tree-plum');
    expect(searchCatalog('red arbre', 'fr').map((i) => i.id)).not.toContain('tree-plum');
  });
});
