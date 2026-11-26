/**
 * What the object shelf shows, both shapes alike: its tabs, the category it opens on, the items a
 * search or a tab offers, the planting card, and whether the brush button stands and can paint. A
 * planet session's row offers the landmarks the planet editor places instead, with no tabs or search.
 * The planting card a category plants is the macros' answer, handed in as `patchOf`.
 */
import type { CatalogItem } from '../core/model/types';
import type { Locale } from '../core/model/locale';
import { landmarkSpec } from '../core/game/profile';
import { CATEGORY_BY_ID, placedCategories, type ItemCategory } from '../config/catalog/categories';
import type { I18nKey } from '../i18n/keys';
import { getCatalogByCategory, getCatalogItem, landmarkItems } from './catalog';
import { searchCatalog, type CategoryTerms } from './catalog-search';
import { armedMacroOf, armedPicksOf, type EditModeInputs } from './editing/edit-mode';
import { placesOneAtATime } from './object-geometry';

/** A category tab: the drawn order, with the short name a tab has room for. `menu.place_*` is the
 *  action catalogue's own name for the category ("Place building" in Chinese), a sentence where this is a label. */
interface ShelfTab {
  category: ItemCategory;
  labelKey: I18nKey;
}

/** The tabs left to right: every category placed item by item (roads are a brush surface of their own). */
export const OBJECT_SHELF_TABS: readonly ShelfTab[] = placedCategories('shelfRank').map((c) => ({ category: c.id, labelKey: c.placement.tabKey }));

/** The planting card a category's row offers, or null. */
type PatchOf<M extends string = string> = (category: ItemCategory) => M | null;

/** The category the shelf opens on: the armed item's or planting card's, so returning reopens where the
 *  visitor was, else the tab `left` names, else the first. */
export function openingCategory(
  armed: { itemId: string | null; macro: string | null }, patchOf: PatchOf<string>, left: ItemCategory | null = null,
): ItemCategory {
  const category = armed.itemId
    ? getCatalogItem(armed.itemId)?.category
    : armed.macro ? OBJECT_SHELF_TABS.find((tab) => patchOf(tab.category) === armed.macro)?.category : undefined;
  return OBJECT_SHELF_TABS.find((tab) => tab.category === (category ?? left))?.category ?? OBJECT_SHELF_TABS[0]!.category;
}

/**
 * What the row shows: the search result while there is a query (active locale and English, the
 * categories named by `categoryTerms`), the tab's category otherwise; items of a category with no tab
 * are never offered.
 */
export function shelfItems(query: string, category: ItemCategory, locale: Locale, categoryTerms: CategoryTerms): CatalogItem[] {
  if (query.trim()) {
    return searchCatalog(query, locale, categoryTerms).filter((item) => !!CATEGORY_BY_ID.get(item.category)?.placement);
  }
  return getCatalogByCategory(category);
}

/** What the planet session's shelf offers: the landmarks the planet editor places, in profile order.
 *  The placer lays each at its profile footprint, unturned. */
export function planetShelfItems(): CatalogItem[] {
  return landmarkItems().filter((item) => landmarkSpec(item.id)?.editorPlaceable);
}

/** Whether the shelf offers `itemId` as a card: one of the planet session's landmarks while a planet
 *  is being edited, else an item of a category with a tab. */
export function shelfOffers(itemId: string, planetSession: boolean): boolean {
  if (planetSession) return planetShelfItems().some((item) => item.id === itemId);
  const category = getCatalogItem(itemId)?.category;
  return OBJECT_SHELF_TABS.some((tab) => tab.category === category) && getCatalogByCategory(category!).some((item) => item.id === itemId);
}

/** What one shelf's row reads. */
interface ShelfViewInputs<M extends string = string> {
  query: string;
  category: ItemCategory;
  /** The catalog row (`shelfItems`) or, in a planet session, its own. */
  all: readonly CatalogItem[];
  /** Narrows the row to the items a caller can use. */
  only?: (item: CatalogItem) => boolean;
  /** A chooser reports an item and arms nothing. */
  chooser: boolean;
  /** A planet session's row, which has no categories and no search. */
  sourced: boolean;
  patchOf: PatchOf<M>;
}

export interface ShelfView<M extends string = string> {
  items: readonly CatalogItem[];
  /** The categories that still hold something under `only`; a sourced row has none. */
  tabs: readonly ShelfTab[];
  searching: boolean;
  /** The planting card the row offers first: only in the categories it plants and never in a
   *  search; a narrowed or sourced row offers none, since a patch is not an item a caller can use. */
  patchId: M | null;
  /** Whether the brush button stands in the names' row: on the live shelf rather than a chooser's or a planet session's. */
  brushes: boolean;
  /** Whether some item the row shows can be painted (`placesOneAtATime`); where none can, the button is unavailable. */
  paints: boolean;
}

export function objectShelfView<M extends string>({ query, category, all, only, chooser, sourced, patchOf }: ShelfViewInputs<M>): ShelfView<M> {
  const items = only ? all.filter(only) : all;
  const searching = !sourced && query.trim().length > 0;
  const patchId = patchOf(category);
  return {
    items,
    tabs: sourced ? [] : only ? OBJECT_SHELF_TABS.filter((tab) => getCatalogByCategory(tab.category).some(only)) : OBJECT_SHELF_TABS,
    searching,
    patchId: !searching && !only && !sourced ? patchId : null,
    brushes: !chooser && !sourced,
    paints: items.some((item) => !placesOneAtATime(item)),
  };
}

/** Why the brush bar is refused: a planting card is armed, which lays its own planting; an armed item
 *  is placed one at a time; or the row shows no item a stroke can lay (EDIT-69). */
export type BrushBarRefusal = 'planting' | 'one-at-a-time' | 'row';

/** Why the object shelf's brush bar may not open over what `s` has armed and a row that `paints`
 *  (`ShelfView.paints`; a caller that sees no row passes none), or null where it may. The brush button
 *  says it and `slices/edit.ts:setObjectBrushBar` refuses by it. */
export function brushBarRefusal(s: { editMode: EditModeInputs }, paints = true): BrushBarRefusal | null {
  if (armedMacroOf(s) !== null) return 'planting';
  if (armedPicksOf(s).some((id) => placesOneAtATime(getCatalogItem(id)))) return 'one-at-a-time';
  return paints ? null : 'row';
}

/** The card a reveal asked for, once the row it stands in is the one showing: its category's tab,
 *  with no query. */
export function revealingCard(pending: string | null, query: string, category: ItemCategory): string | null {
  return pending && !query && category === getCatalogItem(pending)?.category ? pending : null;
}
