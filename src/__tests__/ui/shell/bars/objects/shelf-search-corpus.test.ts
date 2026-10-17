/**
 * Multi-word shelf searches over a corpus built from the live catalog and every locale's category
 * words, pinned by a hash of their results in order. A failure means a change altered what some
 * search returns or how it ranks: intentional for a catalog or copy change (regenerate the literal
 * from the printed actual hash in the same commit), a defect otherwise.
 */
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { type Locale } from '../../../../../core/model/locale';
import { categorySearchTerms } from '../../../../../i18n/terms/category-terms';
import { getCatalogByCategory } from '../../../../../state/catalog';
import { searchCatalog } from '../../../../../state/catalog-search';
import { placedCategories, ItemCategory } from '../../../../../config/catalog/categories';
import { shelfItems } from '../../../../../ui/shell/bars/objects/object-shelf';

const LOCALES: readonly Locale[] = ['en', 'zh', 'fr', 'ja', 'ru'];
const FIXED = ['red tree', 'small house', 'blue flower', 'stone bridge', 'pink fl', 'wood fence', 'white house lamp', 'tree a', 'b c', 'x y z'];

/** Category words paired with item-name heads and aliases, inside and across categories. */
function corpus(): { locale: Locale; query: string }[] {
  const out: { locale: Locale; query: string }[] = [];
  const seen = new Set<string>();
  const add = (locale: Locale, query: string) => {
    const key = `${locale}|${query}`;
    if (!query.trim() || seen.has(key)) return;
    seen.add(key);
    out.push({ locale, query });
  };
  const cats = placedCategories('shelfRank').map((c) => c.id);
  for (const locale of LOCALES) {
    const terms = categorySearchTerms(locale);
    for (const [ci, cat] of cats.entries()) {
      const words = terms(cat);
      const items = getCatalogByCategory(cat);
      const other = getCatalogByCategory(cats[(ci + 1) % cats.length]!);
      for (const [wi, word] of [words[0], words[1], words[words.length - 1]].entries()) {
        if (!word) continue;
        for (const item of [items[wi], items[items.length - 1 - wi], other[wi]]) {
          if (!item) continue;
          const head = (item.name[locale] ?? item.name.en).split(/\s+/)[0]!;
          add(locale, `${head} ${word}`);
          add(locale, `${word} ${head.slice(0, 3)}`);
          if (item.aliases?.[0]) add(locale, `${item.aliases[0]} ${word}`);
        }
      }
    }
    for (const query of FIXED) add(locale, query);
  }
  return out;
}

describe('multi-word shelf search', () => {
  it('returns the pinned results, in order, over the corpus', () => {
    const cases = corpus();
    expect(cases.length).toBeGreaterThan(500);
    const results = cases.map(({ locale, query }) => `${locale}|${query}|${shelfItems(query, ItemCategory.Tree, locale).map((i) => i.id).join(',')}`);
    expect(results.filter((r) => !r.endsWith('|')).length, 'most of the corpus finds something').toBeGreaterThan(cases.length / 2);
    const hash = createHash('sha256').update(results.join('\n')).digest('hex').slice(0, 16);
    expect(hash).toBe('b7aaf30f28142483');
  });

  it('reads each category\'s words once per search, not once per item', () => {
    const terms = categorySearchTerms('en');
    const asked = new Map<string, number>();
    const counted = (category: string) => { asked.set(category, (asked.get(category) ?? 0) + 1); return terms(category); };
    expect(searchCatalog('red tree', 'en', counted).length).toBeGreaterThan(0);
    expect(Math.max(...asked.values())).toBe(1);
  });
});
