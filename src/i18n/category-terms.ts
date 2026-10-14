import { CATEGORY_BY_ID } from '../config/catalog/categories';
import type { CategoryId } from '../core/model/types';
import { LOCALES, type Locale } from '../core/model/locale';
import type { CategoryTerms } from '../state/catalog-search';
import { translateFor } from './context';
import { loadAllLocales, localeTablesVersion } from './translations';

const parse = (list: string): string[] => list.split(/[,\uFF0C\u3001]/).map((term) => term.trim()).filter(Boolean);

/** A category's words in one locale: its search words, then the shelf tab and Place menu names. */
function wordsIn(locale: Locale, category: CategoryId): string[] {
  const entry = CATEGORY_BY_ID.get(category);
  if (!entry) return [category];
  const labels = entry.placement ? [entry.placement.tabKey, entry.placement.placeKey] : [];
  return [...parse(translateFor(locale, entry.searchKey)), ...labels.map((key) => translateFor(locale, key))];
}

/** Word lists by search locale, for the locale tables loaded when they were built. */
const cache = new Map<Locale, Map<CategoryId, readonly string[]>>();
let cachedTables = -1;

/** The words a catalog search in `locale` may use for each category: every locale's words, the
 *  active locale's first, then English, then the rest, so a category word in any language narrows
 *  a search whatever the interface language. The first lookup fetches the locale tables not yet
 *  loaded; until they arrive a search reads the loaded ones. */
export function categorySearchTerms(locale: Locale): CategoryTerms {
  if (cachedTables !== localeTablesVersion()) { cache.clear(); cachedTables = localeTablesVersion(); }
  let byCategory = cache.get(locale);
  if (!byCategory) cache.set(locale, (byCategory = new Map()));
  const terms = byCategory;
  const order = [...new Set<Locale>([locale, 'en', ...LOCALES])];
  return (category) => {
    let list = terms.get(category);
    if (!list) {
      loadAllLocales().catch(() => {});
      list = [...new Set(order.flatMap((l) => wordsIn(l, category)))];
      terms.set(category, list);
    }
    return list;
  };
}
