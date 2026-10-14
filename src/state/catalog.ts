import { isCoatingItem, isSurfacePrint, isPlantRole, type CategoryRole } from '../core/model/traits';
import type { CategoryId } from '../core/model/types';
import type { CatalogEntry } from '../config/catalog/catalog-entry';
import { CATEGORIES, CATEGORY_BY_ID } from '../config/catalog/categories';
import { LANDMARK_ITEMS as LANDMARK_BODIES } from '../config/catalog/landmarks';
import { ANCHOR_LANDMARK, LANDMARKS } from '../core/game/profile';

// Assembled in the category registry's order, which generation determinism depends on.
const catalogData = CATEGORIES.flatMap((c) => c.items);

// byId knows every item a save or renderer may meet; byCategory offers only what may still be placed.
const byId = new Map<string, CatalogEntry>();
const byCategory = new Map<string, CatalogEntry[]>();
const known: CatalogEntry[] = [];

/** The offered items in authored order, rebuilt whenever an item is indexed; a cache of what the
 *  catalog offers keys on this array's identity. */
let offered: readonly CatalogEntry[] = [];

function index(item: CatalogEntry): void {
  byId.set(item.id, item);
  if (!known.includes(item)) known.push(item);
  if (item.disabled) return;
  const list = byCategory.get(item.category) ?? [];
  if (!list.includes(item)) { list.push(item); byCategory.set(item.category, list); }
  offered = [...byCategory.values()].flat();
}

for (const item of catalogData) index(item);

// Every landmark's item (`config/catalog/landmarks.ts`) takes its footprint from the game profile, and
// the profile's icon where it names one. It is known, so saves and renderers meet it, but listed in no
// category, so no placement list offers it; it is locked on every map outside the planet session.
const LANDMARK_ITEMS: CatalogEntry[] = LANDMARKS.map((spec) => {
  const body = LANDMARK_BODIES.find((i) => i.id === spec.id);
  if (!body) throw new Error(`catalog: no item for landmark ${spec.id}`);
  const item = { ...body, width: spec.width, height: spec.height, ...(spec.icon ? { icon: spec.icon } : {}) } as CatalogEntry;
  byId.set(item.id, item);
  known.push(item);
  return item;
});

/** The anchor landmark's item; a game without an anchor (`ANCHOR_LANDMARK` undefined) has none to give. */
export function landmarkItem(): CatalogEntry {
  const item = ANCHOR_LANDMARK && LANDMARK_ITEMS.find((i) => i.id === ANCHOR_LANDMARK!.id);
  if (!item) throw new Error('catalog: the game has no anchor landmark');
  return item;
}

/** Every landmark's item, in profile order. */
export function landmarkItems(): readonly CatalogEntry[] {
  return LANDMARK_ITEMS;
}

export function getCatalogItem(id: string): CatalogEntry | undefined {
  return byId.get(id);
}

/** The item only if it may still be placed: known, enabled and not a landmark. */
export function getOfferedItem(id: string): CatalogEntry | undefined {
  const item = byId.get(id);
  return item && byCategory.get(item.category)?.includes(item) ? item : undefined;
}

/** An item's regional load, 0 off-catalog: the one price every load check and display reads. */
export function catalogLoadValue(catalogId: string): number {
  return byId.get(catalogId)?.loadValue ?? 0;
}

/** A placed object's category, read from its catalog item since a PlacedObject carries none of its
 *  own. Undefined for a catalogId the catalog does not know, which json-codec drops on load. */
export function categoryOf(obj: { catalogId: string }): CategoryId | undefined {
  return byId.get(obj.catalogId)?.category;
}

/** The role an item's category plays, or undefined for a category with none or a missing item. */
export function itemRole(item: { category: CategoryId } | undefined | null): CategoryRole | undefined {
  return item ? CATEGORY_BY_ID.get(item.category)?.role : undefined;
}

/** The role a placed object's category plays, read through its catalog item like `categoryOf`. */
export function roleOf(obj: { catalogId: string }): CategoryRole | undefined {
  return itemRole(byId.get(obj.catalogId));
}

/** The category that plays `role`, or undefined for a game without one. */
export function categoryWithRole(role: CategoryRole): CategoryId | undefined {
  return CATEGORIES.find((c) => c.role === role)?.id;
}

/** Whether a placed object is a decoration, a plant: the vegetation that generation sweeps out of
 *  gate strips, crossing clearances and paved cells. */
export function isDecoration(obj: { catalogId: string }): boolean {
  return isPlantRole(roleOf(obj));
}

/**
 * Test-support: register a catalog item at runtime so rule unit tests can use
 * fixtures with controlled footprints (e.g. a 2x2 house) independent of the
 * shipped catalog. Not used in production code.
 */
export function __setCatalogItem(item: CatalogEntry): void {
  index(item);
}

export function getCatalogByCategory(category: CategoryId): CatalogEntry[] {
  return byCategory.get(category) ?? [];
}

/** Every offered item of the category that plays `role`, in authored order. */
export function getCatalogByRole(role: CategoryRole): CatalogEntry[] {
  const category = categoryWithRole(role);
  return category === undefined ? [] : getCatalogByCategory(category);
}

/** Every road surface a tile brush can lay, in authored order. */
export function getRoadMaterials(prints = false): CatalogEntry[] {
  return getAllItems().filter(item => isCoatingItem(item) && isSurfacePrint(item) === prints);
}

/** Automatic placement excludes unimplemented rules and prints, which need an explicit decoration choice. */
export function getPlaceableByCategory(category: CategoryId): CatalogEntry[] {
  return getCatalogByCategory(category).filter((i) => !i.ruleTBD && !isSurfacePrint(i));
}

/** `getPlaceableByCategory` for the category that plays `role`. */
export function getPlaceableByRole(role: CategoryRole): CatalogEntry[] {
  const category = categoryWithRole(role);
  return category === undefined ? [] : getPlaceableByCategory(category);
}

/** Every item `keep` accepts, in authored order, under the same exclusions as `getPlaceableByCategory`:
 *  a pool chosen by trait rather than by category. */
export function getPlaceableWhere(keep: (item: CatalogEntry) => boolean): CatalogEntry[] {
  return getAllItems().filter((i) => !i.ruleTBD && !isSurfacePrint(i) && keep(i));
}

/** Every item still offered, in authored order: each barrel folder holds one category, so the
 *  flattened byCategory keeps the authored sequence. The same array until the catalog changes. */
export function getAllItems(): readonly CatalogEntry[] {
  return offered;
}

/** Every item a save may name, disabled ones included, in authored order. */
export function getKnownItems(): CatalogEntry[] {
  return known;
}
