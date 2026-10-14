/** Catalog search: fuzzy scoring of the offered items' names, aliases and category words. */
import type { CategoryId, CatalogItem } from '../core/model/types';
import { type Locale } from '../core/model/locale';
import { fuzzyScore, tierAndBonus, MAX_BONUS } from './fuzzy';
import { getAllItems } from './catalog';

/** The words a search may use for a category, supplied by the caller in its own locale. */
export type CategoryTerms = (category: CategoryId) => readonly string[];

/** Without a supplier a category answers to its own id, the English word. */
const idTerms: CategoryTerms = (category) => [category];

interface SearchEntry {
  item: CatalogItem;
  /** Name in the active locale, then English — a query in one language still finds an item only
   *  translated into the other. Scored ahead of the other two facets (see `bestFieldScore`). */
  nameFields: readonly string[];
  /** Authored alternate names (`CatalogItem.aliases`): nicknames, material/colour words, common
   *  names a person would type that the item's own name doesn't carry. */
  aliasFields: readonly string[];
}

/** The offered items' search entries per locale, keyed by the offered list they were built from. */
const searchIndex = new WeakMap<readonly CatalogItem[], Map<Locale, SearchEntry[]>>();

function indexForLocale(locale: Locale): SearchEntry[] {
  const items = getAllItems();
  let byLocale = searchIndex.get(items);
  if (!byLocale) { byLocale = new Map(); searchIndex.set(items, byLocale); }
  let entries = byLocale.get(locale);
  if (!entries) {
    // Offered items only: landmarks and disabled items are never search results.
    entries = items.map((item) => ({
      item,
      nameFields: [item.name[locale] ?? item.name.en, item.name.en],
      aliasFields: item.aliases ?? [],
    }));
    byLocale.set(locale, entries);
  }
  return entries;
}

/**
 * A field match is reweighted by which kind of field produced it before two items are ever
 * compared, so a match on an item's own catalogued name outranks a match reached only through
 * another item's alias even when the alias's raw coverage is better — "red" hitting the whole of
 * a short alias ("red") scores a higher raw coverage bonus than "red" hitting the first word of a
 * longer name ("Red Sunflower"), which on raw score alone puts an aliased apple tree above the
 * flower actually named for the colour. Disjoint bonus bands per field type settle it
 * unconditionally within a tier: alias tops out at `ALIAS_BONUS_CAP`, name starts strictly above at
 * `NAME_BONUS_FLOOR`. Both bands stay under `MAX_BONUS`, so the tier itself (word-start substring
 * / mid-word substring / subsequence — `fuzzy.ts`) still dominates everything: a name match can
 * never leapfrog into a higher tier than its own text quality earned.
 */
const ALIAS_BONUS_CAP = 400_000;
const NAME_BONUS_FLOOR = 500_000;

function reweight(rawScore: number, isName: boolean): number {
  const { tier, bonus } = tierAndBonus(rawScore);
  const share = bonus / MAX_BONUS; // 0..1, however the raw bonus was earned
  return isName
    ? tier + NAME_BONUS_FLOOR + Math.round(share * (MAX_BONUS - NAME_BONUS_FLOOR))
    : tier + Math.round(share * ALIAS_BONUS_CAP);
}

function bestOf(query: string, fields: readonly string[], isName: boolean): number | null {
  let best: number | null = null;
  for (const field of fields) {
    const score = fuzzyScore(query, field);
    if (score === null) continue;
    const weighted = reweight(score, isName);
    if (best === null || weighted > best) best = weighted;
  }
  return best;
}

/** The best `fuzzyScore` for one query term across an item's name fields and its aliases, plus the
 *  term's score against the item's category words when `category` is given — a category word alone
 *  must never widen a SINGLE-term query's matches (a lone "bridge" keeps meaning "named Bridge", not
 *  "is a Bridge"; see `scoreAllTerms`). The category facet shares the alias band (`reweight`'s
 *  `isName=false`): naming it explicitly here, rather than folding it into `aliasFields`, keeps a
 *  category word out of `CatalogItem.aliases` and so out of anything that iterates an item's own
 *  authored aliases (e.g. the codec, which never sees search facets at all). */
function bestFieldScore(term: string, entry: SearchEntry, category: number | null): number | null {
  const name = bestOf(term, entry.nameFields, true);
  const alias = bestOf(term, entry.aliasFields, false);
  let best = name;
  if (alias !== null && (best === null || alias > best)) best = alias;
  if (category !== null && (best === null || category > best)) best = category;
  return best;
}

/** Each term's score against one category's words, `null` where it misses. */
type CategoryScores = (category: CategoryId) => readonly (number | null)[];

/** An item's score against a whole (already-tokenized) query: every term must match some facet
 *  (and across terms — "red tree" is a red thing that is also a tree, not either alone), and the
 *  item's score is the sum of each term's own best facet score.
 *
 *  The category facet only opens up once there's more than one term: left open, a bare category
 *  word (e.g. "bridge") would match every item of that category instead of only the ones actually
 *  named for it (pinned: the object shelf's "bridge" search means "named Bridge", and the category
 *  tab already covers "is a Bridge"). */
function scoreAllTerms(terms: readonly string[], entry: SearchEntry, categoryScores: CategoryScores | null): number | null {
  const category = categoryScores ? categoryScores(entry.item.category) : null;
  let total = 0;
  for (const [i, term] of terms.entries()) {
    const score = bestFieldScore(term, entry, category ? category[i]! : null);
    if (score === null) return null;
    total += score;
  }
  return total;
}

function tokenize(query: string): string[] {
  return query.split(/\s+/).filter(Boolean);
}

/** A whole-string CJK query with no spaces short enough to plausibly be two unspaced words typed
 *  together (2-4 characters: "red flower" to "red-coloured blossom" in length, never a long sentence). */
const UNSPACED_CJK = /^[\u4E00-\u9FFF]{2,4}$/;

/** Every catalog item matching every whitespace-separated term in `query`, across its name
 *  (active locale or English), its authored aliases and its category (by the words `categoryTerms` supplies) — best
 *  score first (ties keep catalog order — `Array.sort` is stable). An empty or whitespace-only
 *  query returns no items, not all of them.
 *
 *  CJK carries no spaces between words, so "red flower" written as two unspaced characters and the same typed
 *  with a space must both work. If the whole unspaced query matches nothing, and it's short enough to
 *  plausibly be two unspaced CJK words, retry once with each character as its own and term. This
 *  fallback fires only on a total miss: a real whole-name match (e.g. "cherry blossom", a single
 *  flower) already succeeds on the first pass and must never be split into one term per character. */
export function searchCatalog(query: string, locale: Locale, categoryTerms: CategoryTerms = idTerms): CatalogItem[] {
  const q = query.trim();
  if (!q) return [];
  const rank = (terms: readonly string[]): CatalogItem[] => {
    // A term's category score depends only on the category, so each category's words (every
    // locale's) are scored once per search rather than once per item.
    const byCategory = new Map<CategoryId, readonly (number | null)[]>();
    const categoryScores: CategoryScores | null = terms.length > 1
      ? (category) => {
        let scores = byCategory.get(category);
        if (!scores) {
          const words = categoryTerms(category);
          scores = terms.map((term) => bestOf(term, words, false));
          byCategory.set(category, scores);
        }
        return scores;
      }
      : null;
    const scored: Array<{ item: CatalogItem; score: number }> = [];
    for (const entry of indexForLocale(locale)) {
      const score = scoreAllTerms(terms, entry, categoryScores);
      if (score !== null) scored.push({ item: entry.item, score });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.map((r) => r.item);
  };
  const results = rank(tokenize(q));
  if (results.length > 0 || !UNSPACED_CJK.test(q)) return results;
  return rank([...q]);
}
