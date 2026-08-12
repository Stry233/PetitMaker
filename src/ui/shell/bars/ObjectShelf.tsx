/*
 * ObjectShelf.tsx — the bottom bar for 物品 mode: six category tabs, a search box, and a scrolling
 * row of item cards.
 *
 * A card writes through `setEditMode({ mode: 'object', itemId })`, the only writer of the four tool
 * facts, and a null id in object mode resolves to rest — so arming and disarming are one call with
 * one argument, and what the row draws as selected is the store's own `selectedItemId` rather than
 * a second copy of it.
 *
 * IT IS A SHELF, WHICH IS WHY ITS PLATE IS A BAND. The design's `底边栏` is one shape running past
 * both side edges and past the bottom of the canvas, with its top edge partway UP the item cards:
 * the cards stand on it, half on the dark and half over the map, and the row of category names and
 * the search field sit above it on the map. A plate wrapped around every row instead would make
 * this a card with rows in it, which is a different object.
 *
 * THE SHELF SPANS THE VIEWPORT. Its three rows stack off the bottom edge at fixed css px and take
 * whatever width the window has: the tab row flows, so a tab is as wide as its own word and the
 * Russian row is simply longer than the Chinese one, and the card row scrolls, so the room it has
 * decides how many cards are in view rather than how big they are.
 *
 * The row SCROLLS. The drawing's eleven cards are a sample: 40 items sit in the flora category
 * alone, and the catalog is expected to reach hundreds, so the row is a native scroll container
 * (wheel, trackpad, touch and keyboard focus all move it) with the design's own bar drawn under it.
 *
 * Search reads the active locale AND English, so "apple" finds the apple tree with the interface in
 * Chinese. While a query stands it replaces the category and no tab reads as active, since a tab
 * that looked chosen while the row showed something else would be a lie; clicking one clears it.
 *
 * The hovered card's NAME is drawn HERE rather than on the card, in the gap above the row: the row
 * is a scroll container, so it clips on both axes and a label standing above a tile inside it would
 * be cut in half. The card reports where it is in the row's own coordinates and the scroll offset
 * is taken back off, so the name tracks the tile it belongs to while the row moves under it.
 */
import {
  useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState, type CSSProperties,
} from 'react';
import { AnimatePresence, motion, useReducedMotionConfig } from 'framer-motion';
import { ItemCategory } from '../../../core/model/types';
import type { CatalogItem } from '../../../core/model/types';
import { useT } from '../../../i18n/context';
import { getCatalogByCategory, getCatalogItem } from '../../../state/catalog';
import { subscribeMapStats } from '../../../state/map-stats';
import { getObjectIndex } from '../../../state/object-index';
import { useEditorStore } from '../../../state/store';
import type { MacroId } from '../../../tools/macros';
import { useScrollFade } from '../../primitives/scroll-fade';
import { ScaleProvider, usePx } from '../../design/scale';
import { btnReset, cursors, pressable, z } from '../../design/styles';
import { MAP_LABEL, MAP_SHAPE_EDGE, MUTED_INK, PLATE, PLATE_INK } from '../../design/tokens';
import { PLATE_BAND, SHELF_SCALE, TEXT } from '../units';
import { BarText, Plate } from './bar-atoms';
import { ItemCard, SmartCard } from './ItemCard';
import {
  BAR, ROW, SCROLL, SEARCH, SHELF_BOX, TABS, shelfItems, tabRowGap,
} from './object-shelf';
import { useFrameZoom, wheelGlider, wheelPush } from './row-scroll';
import { ShelfScrollbar } from './ShelfScrollbar';
import { ShelfTabs, TAB_ROW } from './ShelfTabs';

import searchArt from '../../../assets/shell/shelf-object/search-field.svg';
import { MOTIONS } from '../motion/registry';
import { useMotion } from '../motion/use-motion';

/** How far a fresh row of cards comes in from, in css px: the registry's own amplitude, since a
 *  distance typed at an element is the same unfindable decision a duration typed there is. */
const CARD_ARRIVE_X = MOTIONS['shelf.category.swap'].amplitude;

/** Inline style + the custom property `animations.css` colours the placeholder from. */
type PwStyle = CSSProperties & Record<`--pw-${string}`, string>;

/**
 * How far the field's text sits below the pill's own top edge, in css px.
 *
 * A single-line `<input>` is not a plain block: Chromium positions its text off the padding box's
 * own TOP, at the font's own natural metrics, and does not honour `line-height` for this at all
 * once the box has an explicit height — setting `lineHeight` to the pill's own height (the usual
 * way to centre text in a fixed-height box) is therefore a no-op here, and with no padding the
 * placeholder lands noticeably above the pill's true centre, not on it. `padding-bottom` is just as
 * inert, for the same reason: the text never moves off the top-anchored line to make room for it.
 * `padding-top` is the one property that does move it, so it is the one lever left to centre the
 * word by (screenshot-verified against `SEARCH.h`; a taller or shorter pill needs a re-check). The
 * field's own `lineHeight` stays set to the pill's height regardless: it still sizes the native
 * caret and the drag-select highlight to the field's full height, which is a real job of its own.
 */
const SEARCH_PAD_TOP = 4;

/** What the row's own box says about how far it scrolls. Both come from the element itself, never
 *  from a design width: the row is as wide as the window leaves it. */
interface Reach {
  /** Design px, which is what `ShelfScrollbar` reads and what `px()` converts back from. */
  viewportW: number;
  contentW: number;
}

/** The category the shelf opens on: the armed item's own, so leaving 物品 mode and coming back
 *  reopens where the user was. */
function initialCategory(itemId: string | null): ItemCategory {
  const armed = itemId ? getCatalogItem(itemId)?.category : undefined;
  return TABS.find((tab) => tab.category === armed)?.category ?? TABS[0]!.category;
}

/** The planting card's macro id for the tab it stands in — Tree-led or Flora-led, never both at
 *  once, so a card armed on one tab cannot plant the other tab's species. Null outside the two
 *  tabs the card stands in at all. */
function patchIdFor(category: ItemCategory): MacroId | null {
  if (category === ItemCategory.Tree) return 'patch-tree';
  if (category === ItemCategory.Flora) return 'patch-flora';
  return null;
}

/**
 * The shelf, under its own scale.
 *
 * Everything drawn in design px inside it — the cards, their sprites, the badges, the scrollbar —
 * comes through `usePx`, so declaring the scale once here is what brings the whole shelf down a
 * notch from the frame's. It has to be a WRAPPER rather than a provider inside the body, because
 * the body itself reads `usePx` for the row's own measurements.
 */
/**
 * `only` narrows what the row offers, for a caller that can use some items and not others.
 *
 * `pick` turns the shelf into a CHOOSER rather than the placement shelf: a press reports the item and
 * arms nothing. Without it a card writes `editMode`, which arms the placer and lights the object block
 * in the mode row — right when the shelf IS the placement tool, wrong when it is standing in for
 * another surface to answer one question, exactly as the scope screen is not really the terrain bar.
 */
export interface ObjectShelfProps {
  only?: (item: CatalogItem) => boolean;
  pick?: { current: string | null; onPick: (catalogId: string) => void };
}

export function ObjectShelf({ only, pick }: ObjectShelfProps = {}) {
  return (
    <ScaleProvider value={SHELF_SCALE}>
      <ObjectShelfBody only={only} pick={pick} />
    </ScaleProvider>
  );
}

function ObjectShelfBody({ only, pick }: ObjectShelfProps) {
  const { px, fw, scale } = usePx();
  const nameMotion = useMotion('item.name.reach');
  const swapMotion = useMotion('shelf.category.swap');
  const t = useT();
  const locale = useEditorStore((s) => s.locale);
  const selectedItemId = useEditorStore((s) => s.selectedItemId);
  const armedMacro = useEditorStore((s) => s.armedMacro);
  const setEditMode = useEditorStore((s) => s.setEditMode);
  const gridState = useEditorStore((s) => s.gridState);
  const eventBus = useEditorStore((s) => s.eventBus);

  const [category, setCategory] = useState<ItemCategory>(() => initialCategory(selectedItemId));
  const [query, setQuery] = useState('');
  const [reached, setReached] = useState<{ name: string; centre: number } | null>(null);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [reach, setReach] = useState<Reach>({ viewportW: 0, contentW: 0 });
  const zoom = useFrameZoom();
  const rootRef = useRef<HTMLDivElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotionConfig() ?? false;
  const wheelGlide = useRef(wheelGlider()).current;

  /**
   * Move the row. A GLIDE is the smooth arrival a press on the scrollbar asks for — a jump to
   * somewhere the pointer is not, where the travel is what says the row moved rather than jumped.
   * What has to stay under the pointer, and everything under reduced motion, takes its place at
   * once. The WHEEL is neither: it drives its own approach through `wheelGlide` (row-scroll.ts).
   *
   * `scrollTo` is the only way to ask a browser for the arrival, and where it is absent an
   * assignment lands there directly.
   */
  const scrollRowTo = useCallback((left: number, smooth: boolean): void => {
    const row = rowRef.current;
    if (!row) return;
    const to = Math.max(0, Math.min(row.scrollWidth - row.clientWidth, left));
    if (smooth && !reduced && typeof row.scrollTo === 'function') {
      row.scrollTo({ left: to, behavior: 'smooth' });
      return;
    }
    row.scrollLeft = to;
  }, [reduced]);

  // The index's `countByCatalog` is patched in place, so the read below is always current — what a
  // placement needs is a REPAINT. This is the shared rAF-coalesced map-changed tick, which is what
  // keeps a generate (thousands of objects) to one repaint per frame.
  const [, repaint] = useReducer((n: number) => n + 1, 0);
  useEffect(
    () => subscribeMapStats(eventBus, () => useEditorStore.getState().gridState, repaint),
    [eventBus],
  );
  const counts = gridState ? getObjectIndex(gridState).countByCatalog : null;

  const all = shelfItems(query, category, locale);
  const items = only ? all.filter(only) : all;
  /** The categories that still hold something under `only`. */
  const shownTabs = useMemo(
    () => (only ? TABS.filter((tab) => getCatalogByCategory(tab.category).some(only)) : TABS),
    [only],
  );
  const searching = query.trim().length > 0;
  const patchId = patchIdFor(category);
  const rowFade = useScrollFade(rowRef, 'x');

  // A narrower result (or another category) can leave the row scrolled past its own end, which the
  // browser clamps silently while the drawn thumb keeps reporting the old offset. The name goes
  // with it: the card it belonged to has been unmounted, which fires no pointer leave of its own.
  useEffect(() => {
    if (rowRef.current) rowRef.current.scrollLeft = 0;
    setScrollLeft(0);
    setReached(null);
  }, [category, query]);

  useLayoutEffect(() => {
    const measure = (): void => {
      const row = rowRef.current;
      if (!row) return;
      // The row's own box, never a client rect: `clientWidth`, `scrollWidth` and `scrollLeft` are
      // one coordinate space, and the scale only names it in the design px the scrollbar's props
      // are documented in — it cancels again on the way back through `onScrollTo`.
      const next: Reach = {
        viewportW: row.clientWidth / scale,
        contentW: row.scrollWidth / scale,
      };
      setReach((was) => (
        was.viewportW === next.viewportW && was.contentW === next.contentW ? was : next
      ));
    };
    measure();
    const root = rootRef.current;
    if (!root || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(root);
    return () => ro.disconnect();
  }, [items.length, category, scale]);

  const searchStyle: PwStyle = {
    position: 'relative', display: 'block', boxSizing: 'border-box',
    width: '100%', height: '100%',
    paddingLeft: SEARCH.padX, paddingRight: SEARCH.padX,
    paddingTop: SEARCH_PAD_TOP, paddingBottom: 0,
    background: 'transparent', border: 'none', outline: 'none',
    fontSize: SEARCH.text, fontWeight: fw(800), color: PLATE_INK,
    lineHeight: `${SEARCH.h}px`, cursor: cursors.text,
    '--pw-placeholder': MUTED_INK,
  };

  return (
    <div
      ref={rootRef}
      style={{
        position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: z.panel, pointerEvents: 'none',
        display: 'flex', flexDirection: 'column', alignItems: 'stretch',
        padding: `0 ${SHELF_BOX.right}px ${SHELF_BOX.bottom}px ${SHELF_BOX.left}px`,
      }}
    >
      {/* The shelf's backing, as the design draws it: a band at the bottom that the item cards
          stand UP out of, not a box around the rows. See `units.ts:PLATE_BAND`. */}
      <span
        style={{
          position: 'absolute',
          left: -PLATE_BAND.overhang, right: -PLATE_BAND.overhang,
          bottom: -PLATE_BAND.radius, height: PLATE_BAND.top + PLATE_BAND.radius,
          borderRadius: PLATE_BAND.radius, background: BAR.fill,
        }}
      />

      {/* The names and the field are ONE row, the field just past the last name: that is where the
          drawing puts it, and it is what makes the field read as this row's search rather than as a
          control belonging to the corner it would otherwise be pushed into. Its bottom edge stands
          at the floor BOTH shelves hang their names from, so the row does not move when the visitor
          switches mode; what is left of that floor is the room over the cards. */}
      <div
        style={{
          ...TAB_ROW, position: 'relative', marginBottom: tabRowGap(),
          // One line, always. The field keeps its place at the end of the names and the NAMES take
          // whatever shortfall a language brings, by scrolling (`ShelfTabs`): a field pushed onto a
          // line of its own lands at the shelf's left edge under the first name, which is where the
          // long languages had put it.
          flexWrap: 'nowrap',
        }}
      >
        <ShelfTabs
          label={t('mode.object')}
          // A NARROWED shelf shows only the categories it still has something in: a name over an
          // empty row is a promise of items that were filtered out, and the visitor cannot tell the
          // difference between "nothing here" and "nothing loaded".
          tabs={shownTabs.map((tab) => ({ id: tab.category, label: t(tab.labelKey) }))}
          active={searching ? null : category}
          // Switching category puts down whatever the shelf is carrying that does not belong to it
          // (an item card or a planting macro): the row that could put it away is the one about to
          // disappear, and the map must not go on offering a ghost with no card left to click away.
          // Switching TO the armed item's own category is not a mismatch — that is how the shelf
          // re-opens on an armed item at all (`initialCategory` above).
          onSelect={(next) => {
            setQuery('');
            setCategory(next);
            if (selectedItemId && getCatalogItem(selectedItemId)?.category !== next) {
              setEditMode({ mode: 'object', itemId: null });
            } else if (armedMacro && armedMacro !== patchIdFor(next)) {
              setEditMode({ mode: 'object', macro: null });
            }
          }}
        />

        {/* The focus ring goes on the BOX, not on the input: an outline follows its own element's
            corner, and the input is a rectangle laid over the drawn capsule. `pw-field-wrap` +
            `pw-field-input` is the pair `animations.css` already moves a ring up for. */}
        <div
          className="pw-field-wrap"
          style={{
            position: 'relative', flex: 'none', marginLeft: SEARCH.inset,
            // The row's own bottom edge is the mark's, and the field stands off the names' INK
            // above it (`SEARCH.bottom`), not off the line box that carries them.
            marginBottom: SEARCH.bottom,
            width: SEARCH.w, height: SEARCH.h, borderRadius: SEARCH.radius,
            pointerEvents: 'auto',
          }}
        >
          {/* The plate wears the hairline every drawing standing on the map wears
              (`tokens.ts:MAP_SHAPE_EDGE`), on the art itself rather than on the box, so what is
              outlined is the capsule's own silhouette and not the rectangle around it. */}
          <Plate
            src={searchArt}
            style={{ inset: 0, width: '100%', height: '100%', filter: MAP_SHAPE_EDGE }}
          />
          <input
            type="search"
            className="pw-search-field pw-field-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label={t('shelf.search')}
            // The drawing writes the placeholder with a trailing ellipsis, which invites typing. It
            // is not part of the field's NAME, so a reader hears "Search" and not the dots.
            placeholder={t('shelf.search_ph')}
            style={searchStyle}
          />
        </div>

      </div>

      <div
        style={{
          position: 'relative', display: 'flex', alignItems: 'center',
          marginBottom: SHELF_BOX.rowGap,
        }}
      >
        <div
          id="shell-shelf-row"
          ref={rowRef}
          className="pw-noscroll"
          onScroll={(e) => setScrollLeft(e.currentTarget.scrollLeft / scale)}
          // A row of tiles is scrolled with a wheel that reports its travel DOWN, so that is what
          // is turned along the row here, and it GLIDES the way the sideways axis already does on a
          // smooth-scrolling mouse (row-scroll.ts has the whole story). The two travel the same
          // distance per notch: the wheel reports in the page's pixels and the row is drawn in the
          // frame's zoomed ones, which `wheelPush` takes back out.
          onWheel={(e) => {
            const push = wheelPush(e, e.currentTarget.clientWidth, zoom);
            if (push) wheelGlide.wheel(e.currentTarget, push.by, reduced);
          }}
          style={{
            // Positioned, so a card's `offsetLeft` is measured from the row's own content box and
            // the name above it needs nothing but the scroll offset to follow it.
            position: 'relative', flex: '1 1 auto', minWidth: 0,
            display: 'flex', alignItems: 'center',
            boxSizing: 'border-box', padding: px(ROW.pad),
            height: px(ROW.card + 2 * ROW.pad),
            overflowX: 'auto', overflowY: 'hidden', pointerEvents: 'auto',
            ...rowFade,
          }}
        >
          {/*
            THE CARDS ARRIVE. Picking another name must not swap the whole row between two frames —
            that is the one place in this shelf where something would change and nothing say so.
            They come in from the right, which is the direction the row itself travels.

            One motion over the reel rather than a stagger down it: a category holds forty items and
            the row shows eight, so a per-card entrance would spend most of itself off screen and
            the last card would land three quarters of a second after the first.

            Keyed, so it REMOUNTS and plays: this is a swap, not a list that grew. A SEARCH is one
            key, not one per query — the row narrows under the visitor's own typing, which is its own
            feedback, and replaying an entrance per keystroke is noise. The reel is unpositioned, so
            a card's `offsetLeft` is still measured from the row and the hovered name above it needs
            nothing but the scroll offset to follow.
          */}
          <motion.div
            key={searching ? 'search' : category}
            initial={{ opacity: 0, x: CARD_ARRIVE_X }}
            animate={{ opacity: 1, x: 0 }}
            transition={swapMotion}
            style={{ display: 'flex', alignItems: 'center', gap: px(ROW.gap), flex: 'none' }}
          >
            {/* PLANTING, first in the list: the shelf's other way of placing things — one press
                lays a designed patch instead of one item — offered as a card because picking a
                thing and aiming it is exactly what this row already means. The armed item and the
                armed planting are one choice (`setEditMode` puts the other down). It stands only
                in the two categories it plants — trees and flowers — since a patch of buildings or
                bridges is not a thing the placement rules would ever accept; and not in a search,
                since a query names items and this is not one. */}
            {/* A NARROWED shelf offers no planting card either. `only` is a caller saying which
                ITEMS it can use, and a patch is not an item at all: it is a press that designs its
                own, which a letter cannot be tiled with. */}
            {!searching && patchId && !only ? (
              <SmartCard
                selected={armedMacro === patchId}
                onToggle={() => setEditMode({
                  mode: 'object',
                  macro: armedMacro === patchId ? null : patchId,
                })}
                onReach={setReached}
              />
            ) : null}
            {items.map((item) => (
              <ItemCard
                key={item.id}
                item={item}
                placed={counts?.get(item.id) ?? 0}
                selected={pick ? pick.current === item.id : selectedItemId === item.id}
                onToggle={() => {
                  // A chooser REPORTS. Arming here would put the map under a placement cursor and
                  // light the object block, for a press that was answering a generator's question.
                  if (pick) { pick.onPick(item.id); return; }
                  setEditMode({ mode: 'object', itemId: selectedItemId === item.id ? null : item.id });
                }}
                onReach={setReached}
              />
            ))}
          </motion.div>
        </div>

        {/* The hovered card's name, in the gap the row keeps above it. It rises the last few pixels
            into place so it reads as coming off the tile rather than appearing over the map. */}
        <AnimatePresence>
          {reached ? (
            <motion.span
              key={reached.name}
              data-testid="shell-card-name"
              initial={{ opacity: 0, x: '-50%', y: 4 }}
              animate={{ opacity: 1, x: '-50%', y: 0 }}
              exit={{ opacity: 0, x: '-50%' }}
              transition={nameMotion}
              style={{
                position: 'absolute', bottom: '100%', left: reached.centre - scrollLeft * scale,
                fontSize: TEXT.label, fontWeight: 800, lineHeight: 1.15,
                whiteSpace: 'nowrap', pointerEvents: 'none', ...MAP_LABEL,
              }}
            >
              {reached.name}
            </motion.span>
          ) : null}
        </AnimatePresence>

        {items.length === 0 ? (
          <div
            style={{
              position: 'absolute', inset: 0, pointerEvents: 'none',
              display: 'flex', flexDirection: 'column', alignItems: 'center',
              justifyContent: 'center', gap: 12,
            }}
          >
            <BarText size={TEXT.label} onMap>
              {t('shelf.no_match', { q: query.trim() })}
            </BarText>
            <motion.button
              type="button"
              {...pressable}
              onClick={() => setQuery('')}
              style={{
                ...btnReset, cursor: cursors.clickable, pointerEvents: 'auto',
                display: 'flex', alignItems: 'center', padding: '7px 20px',
                borderRadius: 999, background: PLATE,
              }}
            >
              <BarText size={TEXT.label} color={PLATE_INK}>{t('shelf.clear_search')}</BarText>
            </motion.button>
          </div>
        ) : null}
      </div>

      <div
        ref={trackRef}
        style={{ position: 'relative', height: px(SCROLL.thumb.h), pointerEvents: 'none' }}
      >
        <ShelfScrollbar
          scrollLeft={scrollLeft}
          viewportW={reach.viewportW}
          contentW={reach.contentW}
          onScrollTo={(left, smooth) => scrollRowTo(left * scale, smooth)}
        />
      </div>
    </div>
  );
}
