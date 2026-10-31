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
import { categorySearchTerms } from '../../../../i18n/terms/category-terms';
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

/** The room between the names and the cards, in css px: what the row floor both shelves share
 *  (`frame-plan.ts:FrameLayout.bar.tabsTop`) leaves. */
export function tabRowGap(floor: number = SHELF_TABS.floor): number {
  const underRow = (ROW.card + 2 * ROW.pad) * SHELF_SCALE + SHELF_BOX.rowGap
    + SCROLL.thumb.h * SHELF_SCALE + SHELF_BOX.bottom;
  return floor - underRow;
}

/** The wide names' row's search group in CSS pixels: the brush button, then the field, together as
 *  wide as the design's 476 × 82 field drawing alone, which carries a 44.5 px em and 50 px inset. */
const SEARCH_GROUP = { w: Math.round((476 / 82) * SHELF_TABS.field), gap: SHELF_TABS.gap } as const;

/** Search geometry in CSS pixels: the field at rest, beside the brush button in `group`. */
export const SEARCH = {
  w: SEARCH_GROUP.w - SEARCH_GROUP.gap - SHELF_TABS.field,
  h: SHELF_TABS.field,
  group: SEARCH_GROUP,
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
 * Whether the wide names' row, the whole search group standing `lead` px past its names, would leave the
 * names less than `least` px, the room two of them need whole, so the names row is hard to scroll and the
 * field folds to a round search button (`was` says whether it stands folded now). Names that merely
 * overflow scroll. All in the row's px. Folded, it unfolds only once a tab's gap more is free, so a row
 * resting near the threshold never flips back and forth.
 */
export function searchFolds(was: boolean, { row, lead, least }: { row: number; lead: number; least: number }): boolean {
  const names = row - lead - SEARCH.group.w;
  return was ? names < least + SHELF_TABS.gap : names < least;
}

/** The room two names need whole in the row: the two widest and the gap between them, from their own widths. */
export function twoNamesWide(widths: readonly number[]): number {
  const [a = 0, b = 0] = [...widths].sort((x, y) => y - x);
  return a + b + SHELF_TABS.gap;
}

/**
 * The card row: the tile from the ratio above, the design's gutter proportion, and inner padding for a
 * hovered card's 3% growth inside the clipping viewport.
 */
const CARD_SIZE = (PLATE_BAND.top * CARD_OVER_BAND) / SHELF_SCALE;

export const ROW = { card: CARD_SIZE, gap: (38.6 / 280) * CARD_SIZE, pad: 12 } as const;

/**
 * The cards on an upright window: a grid of at least `minColumns` columns `gap` css px apart, showing
 * `rows` rows before it scrolls (a part row says there is more).
 */
export const UPRIGHT_GRID = { minColumns: 3, rows: 2.5, gap: 8 } as const;

/**
 * The upright grid's columns across `room` frame px and the share of their own size its cards, `card`
 * frame px wide, stand at: the column count whose cards come nearest their own size with the grid's
 * gap between them, never fewer than `minColumns`, the cards then sized to fill the room exactly, so
 * the width left over goes to the cards rather than to the gaps.
 */
export function uprightCardFit(room: number, card: number): { columns: number; fit: number } {
  const { gap, minColumns } = UPRIGHT_GRID;
  const columns = Math.max(minColumns, Math.round((room + gap) / (card + gap)));
  return { columns, fit: (room - (columns - 1) * gap) / columns / card };
}

/** How small the armed card stands in the bar the upright panel folds to, against its grid size. */
export const FOLDED_CARD = 0.6;

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
