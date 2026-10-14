/*
 * The Objects bar's tabs and sizes. The rows span the viewport from its bottom edge; the art keeps the
 * design's numbers through `units.ts:SHELF_SCALE`, the layout is authored in css px. Every row scrolls
 * (`row-scroll.ts`).
 */
import type { CatalogItem } from '../../../../core/model/types';
import { type Locale } from '../../../../core/model/locale';
import { getCatalogByCategory, landmarkItems } from '../../../../state/catalog';
import { searchCatalog } from '../../../../state/catalog-search';
import { landmarkSpec } from '../../../../core/game/profile';
import { EDGE, EDGE_RIGHT, PLATE_BAND, RAIL, SHELF_SCALE, SHELF_TABS, standsInNameRow } from '../../units';
import { DARK_GROOVE, SHELF_THUMB } from '../../../design/tokens';
import { CATEGORY_BY_ID, placedCategories, ItemCategory } from '../../../../config/catalog/categories';
import { categorySearchTerms } from '../../../../i18n/category-terms';
import type { I18nKey } from '../../../../i18n/keys';

/** A category tab: the drawn order, with the short name a tab has room for. `menu.place_*` is the
 *  action catalogue's own name for the category ("Place building" in Chinese), a sentence where this is a label. */
interface ShelfTab {
  category: ItemCategory;
  labelKey: I18nKey;
}

/** The tabs left to right: every category placed item by item (roads are a brush surface of their own). */
export const TABS: readonly ShelfTab[] = placedCategories('shelfRank').map((c) => ({ category: c.id, labelKey: c.placement.tabKey }));

/**
 * The shelf's own box in css px. `left` is the edge both shelves hang their names from; `right` keeps the
 * rows off the rail clusters while the plate runs past both edges. The shelf keeps to the bottom third.
 */
export const SHELF_BOX = {
  left: SHELF_TABS.left,
  right: EDGE_RIGHT + RAIL.button + EDGE,
  bottom: 12,
  rowGap: 10,
} as const;

/** The room between the names and the cards, in css px: what the row floor both shelves share leaves. */
export function tabRowGap(): number {
  const underRow = (ROW.card + 2 * ROW.pad) * SHELF_SCALE + SHELF_BOX.rowGap
    + SCROLL.thumb.h * SHELF_SCALE + SHELF_BOX.bottom;
  return SHELF_TABS.floor - underRow;
}

/** Search geometry in CSS pixels; the 476 × 82 drawing carries a 44.5 px em and 50 px inset. */
export const SEARCH = {
  w: Math.round((476 / 82) * SHELF_TABS.field),
  h: SHELF_TABS.field,
  /** The placeholder's own em, which the typed query takes too. */
  text: SHELF_TABS.fieldText,
  padX: Math.round((50 / 82) * SHELF_TABS.field),
  inset: 26,
  /** The drawn plate's corner is half its own height, so it is a stadium at any size. The box the
   *  art stands in wears the same corner, which is what a focus ring reads its shape from. */
  radius: SHELF_TABS.field / 2,
  /** How far the field's foot stands above the tab row's, centring it on the names' ink (`standsInNameRow`). */
  bottom: standsInNameRow(SHELF_TABS.field),
} as const;

/**
 * How much taller a card is than the band it stands out of, measured off the game's own shelf: one ratio
 * sets the card to the band and to the fixed type, with the item's picture 40% below the band's top.
 */
const CARD_OVER_BAND = 1.227;

/**
 * The card row: the tile from the ratio above, the design's gutter proportion, and inner padding for a
 * hovered card's 3% growth inside the clipping viewport.
 */
const CARD_SIZE = (PLATE_BAND.top * CARD_OVER_BAND) / SHELF_SCALE;

export const ROW = { card: CARD_SIZE, gap: (38.6 / 280) * CARD_SIZE, pad: 12 } as const;

/**
 * The scrollbar under the row in its art's design px: the track stretched to the row, the thumb as long as
 * the share of the row on screen, both drawn rather than placed so neither letterboxes.
 */
export const SCROLL = {
  track: { y: 1860, w: 3471, h: 24, fill: DARK_GROOVE },
  thumb: { minW: 147, h: 33, y: 1856, fill: SHELF_THUMB },
} as const;


/** What one card carries in design px inside its 280 box: the sprite, the count and the armed ring. */
export const CARD = {
  // The sprite keeps the drawing's proportion of the tile, centred, now that no name band sits under it.
  icon: {
    x: (28 / 280) * CARD_SIZE,
    y: (1 - 168 / 280) * CARD_SIZE / 2,
    w: (224 / 280) * CARD_SIZE,
    h: (168 / 280) * CARD_SIZE,
  },
  badge: { right: (12 / 280) * CARD_SIZE, y: (12 / 280) * CARD_SIZE, h: (46 / 280) * CARD_SIZE },
  ring: (8 / 280) * CARD_SIZE,
  radius: (32 / 280) * CARD_SIZE,
} as const;

/**
 * What the row shows: the search result while there is a query (active locale and English), the tab's
 * category otherwise; items of a category with no tab are never offered.
 */
export function shelfItems(query: string, category: ItemCategory, locale: Locale): CatalogItem[] {
  const found = searchCatalog(query, locale, categorySearchTerms(locale));
  if (query.trim()) return found.filter((item) => !!CATEGORY_BY_ID.get(item.category)?.placement);
  return getCatalogByCategory(category);
}

/** What the planet session's shelf offers: the landmarks the planet editor places, in profile order.
 *  The placer lays each at its profile footprint, unturned. */
export function planetShelfItems(): CatalogItem[] {
  return landmarkItems().filter((item) => landmarkSpec(item.id)?.editorPlaceable);
}
