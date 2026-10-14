import { describe, expect, it } from 'vitest';
import { getCatalogItem, getPlaceableByCategory } from '../../../state/catalog';
import { ItemCategory } from '../../../config/catalog/categories';
import { LOCALES } from '../../../core/model/locale';
import { localizedName } from '../../../i18n/context';
import { SEARCH_EXAMPLE_IDS, searchExamples } from '../../../ui/help/search-examples';
import { helpFacts } from '../../../ui/help/facts';
import { shelfItems } from '../../../ui/shell/bars/objects/object-shelf';


describe('Help search examples', () => {
  it('draws every example from an item the catalog offers', () => {
    for (const id of Object.values(SEARCH_EXAMPLE_IDS)) expect(getCatalogItem(id), id).toBeDefined();
  });

  it('gives every locale a name, a typo, an alias and a two-word query', () => {
    for (const locale of LOCALES) {
      const e = searchExamples(locale);
      expect(e.item, locale).toBe(localizedName(getCatalogItem(SEARCH_EXAMPLE_IDS.name)!.name, locale));
      expect([e.typo, e.enTypo, e.enQuery, e.aliasQuery, e.aliasLatin, e.wordsA, e.wordsB].every(Boolean), locale).toBe(true);
      expect(e.wordsQuery, locale).toBe(`${e.wordsA} ${e.wordsB}`);
    }
  });

  it('finds each example\'s own item through the real shelf search in every locale', () => {
    const { name, alias, words } = SEARCH_EXAMPLE_IDS;
    for (const locale of LOCALES) {
      const e = searchExamples(locale);
      const cases: [string, string][] = [
        [e.item, name], [e.typo, name], [e.enQuery, name], [e.enTypo, name],
        [e.aliasQuery, alias], [e.aliasLatin, alias], [e.wordsQuery, words],
      ];
      for (const [query, id] of cases) {
        const found = shelfItems(query, ItemCategory.Tree, locale).map((i) => i.id);
        expect(found, `${locale} "${query}"`).toContain(id);
      }
    }
  });
});

describe('Help facts read from the catalog', () => {
  it('lists exactly the roads with the plantable trait', () => {
    const plantable = getPlaceableByCategory(ItemCategory.Road)
      .filter((road) => road.traits.some((t) => t.type === 'plantable'))
      .map((road) => localizedName(road.name, 'en'));
    expect(plantable.length).toBeGreaterThan(0);
    const listed = String(helpFacts('en').plantableRoads);
    for (const name of plantable) expect(listed).toContain(name);
    const others = getPlaceableByCategory(ItemCategory.Road)
      .filter((road) => !road.traits.some((t) => t.type === 'plantable'))
      .map((road) => localizedName(road.name, 'en'));
    for (const name of others) expect(listed.split(/, | and /)).not.toContain(name);
  });
});
