/*
 * object-shelf.ts — the 物品 bar's tabs, and the sizes it lays them out at.
 *
 * The shelf spans the viewport: three rows anchored to the bottom edge, each as wide as the window
 * gives it. Nothing here is a position on a canvas, so a window narrower than the design's own
 * 3754 px shows the same rows with less room in them rather than a layout sliced off at the edge.
 *
 * Two measurements live side by side, and the difference matters. The ART keeps the design source's
 * own numbers and reaches screen through `units.ts:SHELF_SCALE` (which is what `usePx` resolves to
 * inside a shelf): a card is the 280 px tile the drawing made, drawn a notch under the frame's own
 * scale because a picture reads bigger than a plate. The LAYOUT — insets, gaps, the room around a
 * label — is authored directly in css px, because a tab is as wide as its own word and the spacing
 * around it is a judgement about how the row reads, not a coordinate to be recovered.
 *
 * The drawing shows eleven cards. That is a sample of a row that SCROLLS: the catalog holds 83
 * items today, 40 of them in one category, and is expected to reach hundreds. How a row of this
 * shelf answers a wheel is `row-scroll.ts`, since the row of names above the cards scrolls too and
 * the two have to answer it the same way.
 */
import { ItemCategory, type CatalogItem, type Locale } from '../../../core/model/types';
import { getCatalogByCategory, searchCatalog } from '../../../state/catalog';
import { EDGE, EDGE_RIGHT, PLATE_BAND, RAIL, SHELF_SCALE, SHELF_TABS, standsInNameRow } from '../units';
import { DARK_GROOVE, DARK_PLATE } from '../../design/tokens';

/** A category tab: the drawn order, with the SHORT name a tab has room for. `menu.place_*` is the
 *  action catalogue's own name for the category ("摆放建筑"), a sentence where this is a label. */
export interface ShelfTab {
  category: ItemCategory;
  labelKey: string;
}

/**
 * The six tabs, left to right as the design lays them out.
 *
 * Road is absent, and that is the catalog's own answer: `getCategoryMeta` returns undefined for it
 * because a road is a brush surface with its own build mode, never a point-placed item. Pinned
 * against the live catalog by `object-shelf.test.ts`, so a seventh category arrives as a failing
 * test rather than as a category with no way to reach it.
 */
export const TABS: readonly ShelfTab[] = [
  { category: ItemCategory.Building, labelKey: 'shelf.tab_building' },
  { category: ItemCategory.Tree, labelKey: 'shelf.tab_tree' },
  { category: ItemCategory.Flora, labelKey: 'shelf.tab_flora' },
  { category: ItemCategory.Bridge, labelKey: 'shelf.tab_bridge' },
  { category: ItemCategory.Ramp, labelKey: 'shelf.tab_ramp' },
  { category: ItemCategory.Facility, labelKey: 'shelf.tab_facility' },
];

/**
 * The shelf's own box, in css px: what its rows keep from the viewport's edges, and the room
 * between them.
 *
 * `left` is `units.ts:SHELF_TABS.left`, the edge BOTH shelves hang their row of names from, so
 * switching modes does not move the names.
 *
 * `right` is wider than `left` because the window's right edge is already spoken for: three
 * control clusters stand there, 44 wide at `EDGE` from the edge, and a card row that ran under
 * them would be half-reachable. The PLATE (`units.ts:PLATE_BAND`) still runs past both edges;
 * only the rows stop short.
 *
 * The whole stack is a height budget. The assistant occupies the left of the screen down to about
 * three fifths of it, so the shelf keeps to the bottom third and the map stays the biggest thing
 * on screen; a longer catalog costs scrolling, never height.
 */
export const SHELF_BOX = {
  left: SHELF_TABS.left,
  right: EDGE_RIGHT + RAIL.button + EDGE,
  bottom: 12,
  rowGap: 10,
} as const;

/**
 * The room between the names and the cards, in css px: whatever the row's floor leaves.
 *
 * It is not a judged gap of its own. The row's bottom edge stands at the floor both shelves share
 * (`units.ts:SHELF_TABS.floor`), and this shelf's rows are the shallower pair, so the difference
 * falls here, above the cards, which is where the hovered card's name is drawn anyway. Judging it
 * means moving that floor, which moves the other shelf too — that is the point of it.
 */
export function tabRowGap(): number {
  const underRow = (ROW.card + 2 * ROW.pad) * SHELF_SCALE + SHELF_BOX.rowGap
    + SCROLL.thumb.h * SHELF_SCALE + SHELF_BOX.bottom;
  return SHELF_TABS.floor - underRow;
}

/**
 * The search field, in css px. Its shape is the design source's (`搜索底图`, 476 x 82 design px with
 * a 44.5 px placeholder 50 px in); its SIZE is judged in the row it stands in.
 *
 * THE TEXT IS THE POINT. The placeholder is a THIRD of the plate's height in the drawing, and set at
 * `TEXT.label` — the 35 design px em a TOOL's caption is drawn at, a different thing that happens to
 * share a constant — a plate two and a half times its own text reads as an empty capsule, which is
 * what a search field is not: it holds a word. So the plate's height is the row's
 * (`SHELF_TABS.field`, grown past the drawing's own) and everything inside it keeps the drawing's
 * proportion to that height rather than to the design canvas.
 *
 * It stands IN the tab row, just past the last name, so `inset` is the gap that separates it from
 * the names without breaking the row.
 */
export const SEARCH = {
  w: Math.round((476 / 82) * SHELF_TABS.field),
  h: SHELF_TABS.field,
  /** The placeholder's own em, which the typed query takes too. */
  text: Math.round((44.5 / 82) * SHELF_TABS.field),
  padX: Math.round((50 / 82) * SHELF_TABS.field),
  inset: 26,
  /** The drawn plate's corner is half its own height, so it is a stadium at any size. The box the
   *  art stands in wears the same corner, which is what a focus ring reads its shape from. */
  radius: SHELF_TABS.field / 2,
  /**
   * How far the field's bottom edge stands above the tab row's own bottom, which is the mark's.
   *
   * THE DRAWING BRACKETS THE NAMES' INK WITH ITS PLATES, and `units.ts:standsInNameRow` is that one
   * rule, shared with the action pills of the other shelf: the field is centred on the words rather
   * than hung off the line box that carries them, which holds slack under the ink and puts anything
   * aligned to it low against the row.
   */
  bottom: standsInNameRow(SHELF_TABS.field),
} as const;

/**
 * HOW MUCH TALLER A CARD IS THAN THE BAND IT STANDS OUT OF, measured off the game itself.
 *
 * The drawing gives the tile 280 design px and the band 217, which comes out at a card barely bigger
 * than the band — and against a category name whose size is fixed, a card that small reads as a row
 * of stamps under a heading. The game's own shelf was photographed and measured (1080-tall frame):
 * an item card is 119 px, the band shows 97 px above the bottom edge, and a category name's ink is
 * 29 px, so a card is 1.227 bands and 3.6 names.
 *
 * ONE NUMBER SETTLES ALL THREE, because they are the same number: the band's
 * depth is fixed by the drawing and the type by this frame's rule, so the card's size is the only
 * free term. At this ratio the name comes to 0.28 of a card against the game's 0.277; the card
 * stands 0.55 of itself clear of the band against the game's 0.555; and the item's picture, centred
 * in it, has 42% of itself below the band's top edge against the game's 40%. Get the ratio wrong
 * and the icon sits half inside the dark bar.
 */
const CARD_OVER_BAND = 1.227;

/**
 * The card row. The tile is the ratio above; `gap` keeps the drawing's own proportion to it (a 38.6
 * gutter on a 280 tile, from `圆角矩形 26` and its ten copies at a 318.6 pitch), so the row scales as
 * one assembly. `pad` is breathing room inside the scroll viewport, since a hover grows a card by 3%
 * and the viewport clips on both axes (a scroll container cannot overflow visibly on one axis alone).
 */
const CARD_SIZE = (PLATE_BAND.top * CARD_OVER_BAND) / SHELF_SCALE;

export const ROW = { card: CARD_SIZE, gap: (38.6 / 280) * CARD_SIZE, pad: 12 } as const;

/**
 * The scrollbar under the row, in the design px its art was drawn at: a 3471 x 24 track with a
 * 147 x 33 thumb standing 4 px above its top, so the thumb is taller than the track and overhangs
 * it. The track is drawn at one width and stretched to the row's, which is the only length here
 * the window decides; the thumb's length is the fraction of the row that is on screen.
 *
 * BOTH SHAPES ARE DRAWN, NOT PLACED, and the fills are the ones their art carries. An `<img>` of an
 * SVG keeps its viewBox's aspect, so a shape put in a box of another ratio is scaled to FIT and
 * centred: the thumb was a 147 x 33 drawing in a box a fifth of the row wide and a scrollbar tall,
 * which came out as a stub of the drawing's own proportions floating in the middle of its box. It
 * could not reach either end of the track and its length said nothing about the row.
 */
export const SCROLL = {
  track: { y: 1860, w: 3471, h: 24, fill: DARK_GROOVE },
  thumb: { minW: 147, h: 33, y: 1856, fill: '#8B877C' },
} as const;

/**
 * The plate the shelf stands on. `shelf-object/bar.svg` is one filled rounded rect and nothing
 * else, and this is the fill it carries; the shape is DRAWN rather than placed because the shelf's
 * height is its rows' and an `<img>` of an SVG letterboxes inside a box of another ratio (the
 * viewBox keeps its own aspect). The corners are the design's, off both side edges, so what is left
 * on screen is a straight-edged band the map runs behind.
 */
export const BAR = { fill: DARK_PLATE, overhang: 84 * SHELF_SCALE } as const;

/**
 * What one card carries, in design px inside its 280 box: the sprite, the count standing on the
 * map, and the ring that marks it as the armed one.
 *
 * The drawing also gives the tile a turn mark, a footprint badge and a name band. None of the three
 * is here: a card is a picture and a count (`ItemCard.tsx` says which question each of them was
 * answering and where that question is answered instead).
 */
export const CARD = {
  // The sprite is the drawing's own PROPORTION of the tile, CENTRED: it sat high on the tile to
  // leave a band for the name underneath, and with the name gone that band is just a tile standing
  // off its own picture. A proportion rather than the drawing's absolute rect, because the tile is
  // now sized by the ratio above and a fixed picture inside a bigger card is an emptier card.
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
 * What the row shows: the search result while there is a query, the tab's category otherwise.
 *
 * `searchCatalog` reads the active locale AND English, so "apple" finds the apple tree with the
 * interface in Chinese, and it returns nothing for a blank query — which is the signal to show the
 * category rather than the whole catalog. Road items are dropped: they are laid by the road mode's
 * brush, and the shelf must not offer through search what it has no tab for.
 */
export function shelfItems(query: string, category: ItemCategory, locale: Locale): CatalogItem[] {
  const found = searchCatalog(query, locale);
  if (query.trim()) return found.filter((item) => item.category !== ItemCategory.Road);
  return getCatalogByCategory(category);
}
