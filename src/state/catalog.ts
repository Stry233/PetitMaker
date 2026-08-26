import { ItemCategory, type CatalogItem, type Locale } from '../core/model/types';
import { PLAZA_ID } from '../core/model/constants';
import { fuzzyScore, tierAndBonus, MAX_BONUS } from '../core/model/fuzzy';
import { facility } from '../config/catalog/facility';
import { building } from '../config/catalog/building';
import { tree } from '../config/catalog/tree';
import { flora } from '../config/catalog/flora';
import { road } from '../config/catalog/road';
import { bridge } from '../config/catalog/bridge';
import { ramp } from '../config/catalog/ramp';

// The 7 category barrels are assembled in a FIXED order: generation determinism
// depends on catalog iteration order, so this order must never change casually.
const catalogData = [...facility, ...building, ...tree, ...flora, ...road, ...bridge, ...ramp];

const byId = new Map<string, CatalogItem>();
const byCategory = new Map<string, CatalogItem[]>();

for (const item of catalogData as CatalogItem[]) {
  byId.set(item.id, item);
  const list = byCategory.get(item.category) ?? [];
  list.push(item);
  byCategory.set(item.category, list);
}

// The central plaza is an immutable, off-catalog object. It needs a catalog entry
// only for its TRAITS (terrainBase) — its size is per-map, carried on the
// PlacedObject (width/height). Registered byId only, so it never appears in any
// placement list (getCatalogByCategory).
const PLAZA_ITEM: CatalogItem = {
  id: PLAZA_ID, category: ItemCategory.Facility,
  name: { en: 'Central Plaza', zh: '中央广场' }, icon: 'plaza',
  width: 1, height: 1, loadValue: 0, rotatable: false, placementMode: 'point',
  traits: [{ type: 'terrainBase' }],
};
byId.set(PLAZA_ITEM.id, PLAZA_ITEM);

export function getCatalogItem(id: string): CatalogItem | undefined {
  return byId.get(id);
}

/** The `LoadValueLookup` the CommandExecutor takes: an item's chunk-load cost, 0 off-catalog. */
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
  byId.set(item.id, item);
  const list = byCategory.get(item.category) ?? [];
  if (!list.includes(item)) { list.push(item); byCategory.set(item.category, list); }
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

/** Placeable items in a category: the catalog category MINUS items whose placement rule is TBD
 *  (e.g. the station). Generation and the agent pick only from these, so a TBD item is never
 *  auto-placed.
 *
 *  EXTENSIBILITY CONTRACT — how future content/rules join generation automatically:
 *  - New catalog ITEMS: anything added to catalog.json enters its category pool here (buildings split
 *    into landmark "uniques" vs repeatable stalls by maxCount; fields/orchards/gardens sample any
 *    flora/tree). No generator change needed; set `ruleTBD` to keep an item out until its rule lands.
 *  - New placement RULES: every placement goes through tryPlace → the LIVE RuleRegistry
 *    (reject-and-skip), and terrain goes through repair.ts → validatePostStroke. A new rule is enforced
 *    on generated output the moment it registers — the generator never re-implements rule logic.
 *  - Editorial mappings (e.g. nature.ts TREE_BANDS climate bands) reference ids but FILTER against the
 *    live catalog and fall back to the full pool, so renames/removals degrade gracefully. */
export function getPlaceableByCategory(category: ItemCategory): CatalogItem[] {
  return getCatalogByCategory(category).filter((i) => !i.ruleTBD);
}

export function getAllCategories(): ItemCategory[] {
  return [...byCategory.keys()] as ItemCategory[];
}

/** Every catalog item, in authored order. Derived from byCategory rather than a second stored
 *  list: each barrel folder holds exactly one category (asserted by catalog-order.test.ts's
 *  id-set check), so categories never interleave and byCategory's own insertion order already
 *  IS the authored order — there is no separate list for a flatten to diverge from, and a
 *  registerCatalogItem fixture is visible here because it's the same map. */
export function getAllItems(): CatalogItem[] {
  return [...byCategory.values()].flat();
}

/** Header icon (a basename `iconUrl` resolves) + i18n title key for a placement-shelf category tab.
 *  Road has no entry: it's a brush surface laid from the Build panel, never a point-placed tab. */
const CATEGORY_META: Partial<Record<ItemCategory, { icon: string; titleKey: string }>> = {
  [ItemCategory.Building]: { icon: 'building', titleKey: 'menu.place_building' },
  [ItemCategory.Facility]: { icon: 'facility', titleKey: 'menu.place_facility' },
  [ItemCategory.Tree]: { icon: 'tree', titleKey: 'menu.place_tree' },
  [ItemCategory.Flora]: { icon: 'flower', titleKey: 'menu.place_flower' },
  [ItemCategory.Bridge]: { icon: 'bridge', titleKey: 'menu.place_bridge' },
  [ItemCategory.Ramp]: { icon: 'ramp', titleKey: 'menu.place_ramp' },
};

export function getCategoryMeta(category: ItemCategory): { icon: string; titleKey: string } | undefined {
  return CATEGORY_META[category];
}

/** A category's own Chinese name, for the search category facet below. English needs no table of
 *  its own: `ItemCategory`'s enum VALUE already IS the English word ('building', 'tree', ...), so
 *  storing it again here would just be the same fact with a chance to drift from it. */
const CATEGORY_LABEL_ZH: Partial<Record<ItemCategory, string>> = {
  [ItemCategory.Building]: '建筑',
  [ItemCategory.Tree]: '树木',
  [ItemCategory.Flora]: '花卉',
  [ItemCategory.Bridge]: '桥梁',
  [ItemCategory.Ramp]: '坡道',
  [ItemCategory.Facility]: '设施',
};

/** Extra words a person might type for a category that its own name doesn't carry — "house" for a
 *  building, "木" for a tree — authored once, beside `CATEGORY_META`, so the search category facet
 *  and the shelf's tab metadata sit together. */
const CATEGORY_SYNONYMS: Partial<Record<ItemCategory, readonly string[]>> = {
  [ItemCategory.Building]: ['house', 'home', 'cabin', '房', '屋', '家'],
  [ItemCategory.Tree]: ['树', '木'],
  [ItemCategory.Flora]: ['flower', 'plant', 'grass', '花', '草', '植物'],
  [ItemCategory.Bridge]: ['桥'],
  [ItemCategory.Ramp]: ['坡', 'slope'],
  [ItemCategory.Facility]: ['设施'],
};

function categoryTerms(category: ItemCategory): readonly string[] {
  const zh = CATEGORY_LABEL_ZH[category];
  const synonyms = CATEGORY_SYNONYMS[category] ?? [];
  return zh ? [category, zh, ...synonyms] : [category, ...synonyms];
}

interface SearchEntry {
  item: CatalogItem;
  /** Name in the active locale, then English — a query in one language still finds an item only
   *  translated into the other. Scored ahead of the other two facets (see `bestFieldScore`). */
  nameFields: readonly string[];
  /** Authored alternate names (`CatalogItem.aliases`): nicknames, material/colour words, common
   *  names a person would type that the item's own name doesn't carry. */
  aliasFields: readonly string[];
  /** The item's category, by every word a person might type for it (`categoryTerms`) — so "red
   *  tree" finds a tree, not just a name/alias containing "tree" literally. */
  categoryFields: readonly string[];
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
    // searchable too (the plaza, byId-only, is correctly excluded — it's off-catalog).
    entries = [...byCategory.values()].flat().map((item) => ({
      item,
      nameFields: [item.name[locale] ?? item.name.en, item.name.en],
      aliasFields: item.aliases ?? [],
      categoryFields: categoryTerms(item.category),
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

/** The best `fuzzyScore` for one query TERM across an item's name fields and its aliases, plus its
 *  category words when `includeCategory` — a category word alone must never widen a SINGLE-term
 *  query's matches (a lone "bridge" keeps meaning "named Bridge", not "is a Bridge"; see
 *  `scoreAllTerms`). The category facet shares the alias band (`reweight`'s `isName=false`): naming
 *  it explicitly here, rather than folding it into `aliasFields`, keeps a category word out of
 *  `CatalogItem.aliases` and so out of anything that iterates an item's own authored aliases (e.g.
 *  the codec, which never sees search facets at all). */
function bestFieldScore(term: string, entry: SearchEntry, includeCategory: boolean): number | null {
  const name = bestOf(term, entry.nameFields, true);
  const alias = bestOf(term, entry.aliasFields, false);
  const category = includeCategory ? bestOf(term, entry.categoryFields, false) : null;
  let best = name;
  if (alias !== null && (best === null || alias > best)) best = alias;
  if (category !== null && (best === null || category > best)) best = category;
  return best;
}

/** An item's score against a whole (already-tokenized) query: every term must match SOME facet
 *  (AND across terms — "red tree" is a red thing that is also a tree, not either alone), and the
 *  item's score is the sum of each term's own best facet score.
 *
 *  The category facet only opens up once there's more than one term: left open, a bare category
 *  word (e.g. "bridge") would match every item of that category instead of only the ones actually
 *  named for it (pinned: the object shelf's "bridge" search means "named Bridge", and the category
 *  tab already covers "is a Bridge"). */
function scoreAllTerms(terms: readonly string[], entry: SearchEntry): number | null {
  const includeCategory = terms.length > 1;
  let total = 0;
  for (const term of terms) {
    const score = bestFieldScore(term, entry, includeCategory);
    if (score === null) return null;
    total += score;
  }
  return total;
}

function tokenize(query: string): string[] {
  return query.split(/\s+/).filter(Boolean);
}

/** A whole-string CJK query with no spaces short enough to plausibly be two unspaced words typed
 *  together (2-4 characters: "红花", "红色花朵"-length territory, never a long sentence). */
const UNSPACED_CJK = /^[一-鿿]{2,4}$/;

/** Every catalog item matching every whitespace-separated TERM in `query`, across its name
 *  (active locale or English), its authored aliases and its category (`categoryTerms`) — best
 *  score first (ties keep catalog order — `Array.sort` is stable). An empty or whitespace-only
 *  query returns no items, not all of them.
 *
 *  CJK carries no spaces between words, so "红花" (a red flower) and "红 花" (the same, typed with
 *  a space) must both work. If the whole unspaced query matches nothing, and it's short enough to
 *  plausibly BE two unspaced CJK words, retry once with each character as its own AND term. This
 *  fallback fires only on a total miss: a real whole-name match (e.g. "樱花", a single flower)
 *  already succeeds on the first pass and must never be split into "does something match 樱, and
 *  separately does something match 花" instead. */
export function searchCatalog(query: string, locale: Locale): CatalogItem[] {
  const q = query.trim();
  if (!q) return [];
  const rank = (terms: readonly string[]): CatalogItem[] => {
    const scored: Array<{ item: CatalogItem; score: number }> = [];
    for (const entry of indexForLocale(locale)) {
      const score = scoreAllTerms(terms, entry);
      if (score !== null) scored.push({ item: entry.item, score });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.map((r) => r.item);
  };
  const results = rank(tokenize(q));
  if (results.length > 0 || !UNSPACED_CJK.test(q)) return results;
  return rank([...q]);
}
