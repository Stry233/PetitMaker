import { ItemCategory, type CatalogItem, type Locale } from '../core/model/types';
import { PLAZA_ID } from '../core/model/constants';
import { fuzzyScore, tierAndBonus, MAX_BONUS } from '../core/model/fuzzy';
import { CATEGORIES } from '../config/catalog/categories';
import landmark from '../config/catalog/landmark.json';
import { PLANET_PROFILE } from '../core/model/game-profile';

// Assembled in the category registry's order, which generation determinism depends on.
const catalogData = CATEGORIES.flatMap((c) => c.items);

// byId knows every item a save or renderer may meet; byCategory offers only what may still be placed.
const byId = new Map<string, CatalogItem>();
const byCategory = new Map<string, CatalogItem[]>();
const known: CatalogItem[] = [];

function index(item: CatalogItem): void {
  byId.set(item.id, item);
  if (!known.includes(item)) known.push(item);
  if (item.disabled) return;
  const list = byCategory.get(item.category) ?? [];
  if (!list.includes(item)) { list.push(item); byCategory.set(item.category, list); }
}

for (const item of catalogData as CatalogItem[]) index(item);

// The template landmark is locked on every map outside the planet session.
// It needs a catalog entry only for its traits and its one-per-map cap; its size is per-map,
// carried on the PlacedObject (width/height). Registered byId only, so it never appears in any
// placement list (getCatalogByCategory). Its halfStep trait is a game fact: the landmark sits on half
// cells, as the built-in planets' plaza positions show.
const LANDMARK_ITEM: CatalogItem = { ...(landmark as Omit<CatalogItem, 'id' | 'icon'>), id: PLAZA_ID, icon: PLANET_PROFILE.landmarkIcon };
byId.set(LANDMARK_ITEM.id, LANDMARK_ITEM);

/** The template landmark's item. */
export function landmarkItem(): CatalogItem {
  return LANDMARK_ITEM;
}

export function getCatalogItem(id: string): CatalogItem | undefined {
  return byId.get(id);
}

/** The item only if it may still be placed: known, enabled and not the plaza. */
export function getOfferedItem(id: string): CatalogItem | undefined {
  const item = byId.get(id);
  return item && byCategory.get(item.category)?.includes(item) ? item : undefined;
}

/** An item's regional load, 0 off-catalog: the one price every load check and display reads. */
export function catalogLoadValue(catalogId: string): number {
  return byId.get(catalogId)?.loadValue ?? 0;
}

/** A placed object's category, the full 7-way ItemCategory. A PlacedObject carries none of its
 *  own — `catalogId` determines it — so this is the ONE way to ask. Undefined for a catalogId the
 *  catalog does not know, which json-codec drops on load. */
export function categoryOf(obj: { catalogId: string }): ItemCategory | undefined {
  return byId.get(obj.catalogId)?.category;
}

/** Whether a placed object is a DECORATION (a tree or a flower): the vegetation that generation
 *  sweeps out of gate strips, crossing clearances and paved cells. */
export function isDecoration(obj: { catalogId: string }): boolean {
  const cat = categoryOf(obj);
  return cat === ItemCategory.Tree || cat === ItemCategory.Flora;
}

/**
 * Test-support: register a catalog item at runtime so rule unit tests can use
 * fixtures with controlled footprints (e.g. a 2x2 house) independent of the
 * shipped catalog. Not used in production code.
 */
export function registerCatalogItem(item: CatalogItem): void {
  index(item);
  searchIndex = null;
  epoch++;
}

/**
 * How many times the catalog has changed.
 *
 * The catalog is a module singleton every layer above reads, and several of them memoize what they
 * read from it — the species a colour family offers, say. Nothing may import UPWARD to tell those
 * caches a fixture has been registered, so the catalog publishes the one fact they need instead:
 * a cache keyed on this number is stale exactly when the catalog is not the one it was built from.
 */
export function catalogEpoch(): number {
  return epoch;
}

let epoch = 0;

export function getCatalogByCategory(category: ItemCategory): CatalogItem[] {
  return byCategory.get(category) ?? [];
}

/** Every road surface a tile brush can lay, in authored order. */
export function getRoadMaterials(): CatalogItem[] {
  return getCatalogByCategory(ItemCategory.Road);
}

/** Placeable items in a category: the catalog category MINUS items whose placement rule is TBD.
 *  Generation and the agent pick only from these, so a TBD item is never auto-placed. */
export function getPlaceableByCategory(category: ItemCategory): CatalogItem[] {
  return getCatalogByCategory(category).filter((i) => !i.ruleTBD);
}

/** Every item still offered, in authored order: each barrel folder holds one category, so the
 *  flattened byCategory keeps the authored sequence. */
export function getAllItems(): CatalogItem[] {
  return [...byCategory.values()].flat();
}

/** Every item a save may name, disabled ones included, in authored order. */
export function getKnownItems(): CatalogItem[] {
  return known;
}

/** The words a search may use for a category, supplied by the caller in its own locale. */
export type CategoryTerms = (category: ItemCategory) => readonly string[];

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

// Lazily built and memoized per locale (a catalog of this size makes a linear scan over a prebuilt
// index cheap on every keystroke). registerCatalogItem drops the whole cache, since a fixture a test
// adds mid-run must be searchable without another module reaching in to invalidate it by hand.
let searchIndex: Map<Locale, SearchEntry[]> | null = null;

function indexForLocale(locale: Locale): SearchEntry[] {
  searchIndex ??= new Map();
  let entries = searchIndex.get(locale);
  if (!entries) {
    // Sourced from byCategory, the catalog's one list, so a fixture registerCatalogItem adds is
    // searchable too; the plaza, registered by id only, is not.
    entries = [...byCategory.values()].flat().map((item) => ({
      item,
      nameFields: [item.name[locale] ?? item.name.en, item.name.en],
      aliasFields: item.aliases ?? [],
    }));
    searchIndex.set(locale, entries);
  }
  return entries;
}

/**
 * A field match is reweighted by WHICH KIND of field produced it before two items are ever
 * compared, so a match on an item's own catalogued name outranks a match reached only through
 * another item's alias EVEN WHEN the alias's raw coverage is better — "red" hitting the whole of
 * a short alias ("red") scores a higher raw coverage bonus than "red" hitting the first word of a
 * longer name ("Red Sunflower"), which on raw score alone puts an aliased apple tree above the
 * flower actually named for the colour. Disjoint bonus BANDS per field type settle it
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

/** The best `fuzzyScore` for one query TERM across an item's name fields and its aliases, plus the
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
type CategoryScores = (category: ItemCategory) => readonly (number | null)[];

/** An item's score against a whole (already-tokenized) query: every term must match SOME facet
 *  (AND across terms — "red tree" is a red thing that is also a tree, not either alone), and the
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
const UNSPACED_CJK = /^[一-鿿]{2,4}$/;

/** Every catalog item matching every whitespace-separated TERM in `query`, across its name
 *  (active locale or English), its authored aliases and its category (by the words `categoryTerms` supplies) — best
 *  score first (ties keep catalog order — `Array.sort` is stable). An empty or whitespace-only
 *  query returns no items, not all of them.
 *
 *  CJK carries no spaces between words, so "red flower" written as two unspaced characters and the same typed
 *  with a space must both work. If the whole unspaced query matches nothing, and it's short enough to
 *  plausibly BE two unspaced CJK words, retry once with each character as its own AND term. This
 *  fallback fires only on a total miss: a real whole-name match (e.g. "cherry blossom", a single
 *  flower) already succeeds on the first pass and must never be split into one term per character. */
export function searchCatalog(query: string, locale: Locale, categoryTerms: CategoryTerms = idTerms): CatalogItem[] {
  const q = query.trim();
  if (!q) return [];
  const rank = (terms: readonly string[]): CatalogItem[] => {
    // A term's category score depends only on the category, so each category's words (every
    // locale's) are scored once per search rather than once per item.
    const byCategory = new Map<ItemCategory, readonly (number | null)[]>();
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
