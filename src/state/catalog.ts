import { ItemCategory, type CatalogItem } from '../core/model/types';
import { PLAZA_ID } from '../core/model/constants';
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

const items: CatalogItem[] = catalogData as CatalogItem[];
const byId = new Map<string, CatalogItem>();
const byCategory = new Map<string, CatalogItem[]>();

for (const item of items) {
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
  name: { en: 'Central Plaza', zh: '中央广场' }, emoji: '', icon: 'plaza',
  width: 1, height: 1, loadValue: 0, rotatable: false, placementMode: 'point',
  traits: [{ type: 'terrainBase' }],
};
byId.set(PLAZA_ITEM.id, PLAZA_ITEM);

export function getCatalogItem(id: string): CatalogItem | undefined {
  return byId.get(id);
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
}

export function getCatalogByCategory(category: ItemCategory): CatalogItem[] {
  return byCategory.get(category) ?? [];
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

export function getAllItems(): CatalogItem[] {
  return items;
}
