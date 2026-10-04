import { CATEGORY_BY_ID } from '../config/catalog/categories';
import type { ItemCategory, Locale } from '../core/model/types';
import type { CategoryTerms } from '../state/catalog';
import { translateFor } from './context';
import { translations } from './translations';

const LOCALES = Object.keys(translations) as Locale[];

const parse = (list: string): string[] => list.split(/[,，、]/).map((term) => term.trim()).filter(Boolean);

/** A category's words in one locale: its search words, then the shelf tab and Place menu names. */
function wordsIn(locale: Locale, category: ItemCategory): string[] {
  const entry = CATEGORY_BY_ID.get(category);
  if (!entry) return [category];
  const labels = entry.placement ? [entry.placement.tabKey, entry.placement.placeKey] : [];
  return [...parse(translateFor(locale, entry.searchKey)), ...labels.map((key) => translateFor(locale, key))];
}

const cache = new Map<Locale, Map<ItemCategory, readonly string[]>>();

/** The words a catalog search in `locale` may use for each category: every locale's words, the
 *  active locale's first, then English, then the rest, so a category word in any language narrows
 *  a search whatever the interface language. */
export function categorySearchTerms(locale: Locale): CategoryTerms {
  let byCategory = cache.get(locale);
  if (!byCategory) cache.set(locale, (byCategory = new Map()));
  const terms = byCategory;
  const order = [...new Set<Locale>([locale, 'en', ...LOCALES])];
  return (category) => {
    let list = terms.get(category);
    if (!list) {
      list = [...new Set(order.flatMap((l) => wordsIn(l, category)))];
      terms.set(category, list);
    }
    return list;
  };
}
