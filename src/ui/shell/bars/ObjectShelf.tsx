/*
 * Object-mode shelf with localized category tabs, bilingual search, and a native scrolling card
 * row. Selection comes directly from edit state. Search clears the active category, and hovered
 * names render outside the clipped scroller while tracking their card's scroll-adjusted position.
 */
import { useFrameReadableWeight } from '../use-frame-zoom';
import {
  useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState,
  type CSSProperties, type HTMLAttributes,
} from 'react';
import { motion, useReducedMotionConfig } from 'framer-motion';
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
import { MUTED_INK, PLATE, PLATE_INK } from '../../design/tokens';
import { ShapeEdge } from '../../design/shape-edge';
import { FIELD_INPUT_CLASS, FIELD_WRAP_CLASS } from '../../design/focus-source';
import { PLATE_BAND, SHELF_SCALE, SHELF_TABS, TEXT } from '../units';
import { BarText, Plate } from './bar-atoms';
import { CardNameBubble } from './CardNameBubble';
import { ItemCard, SmartCard } from './ItemCard';
import {
  BAR, ROW, SCROLL, SEARCH, SHELF_BOX, TABS, shelfItems, tabRowGap,
} from './object-shelf';
import { useFrameZoom, wheelGlider, wheelPush } from './row-scroll';
import { useFrameLayout, useRailClearance } from '../frame-layout';
import { cssMotion } from '../motion/use-motion';
import { ShelfScrollbar } from './ShelfScrollbar';
import { ShelfTabs, TAB_ROW } from './ShelfTabs';

import searchArt from '../../../assets/shell/shelf-object/search-field.svg';
import { helpTargetAttr } from '../../chrome/modals/help/targets';
import { MOTIONS } from '../motion/registry';
import { useMotion } from '../motion/use-motion';

/** How far a fresh row of cards comes in from, in css px: the registry's own amplitude, since a
 *  distance typed at an element is the same unfindable decision a duration typed there is. */
const CARD_ARRIVE_X = MOTIONS['shelf.category.swap'].amplitude;

/** Inline style + the custom property `animations.css` colours the placeholder from. */
type PwStyle = CSSProperties & Record<`--pw-${string}`, string>;

/**
 * The search capsule as ONE part: the drawn plate, its silhouette hairline and the field laid over
 * it, at the sizes `SEARCH` declares. The shelf mounts it live; the Help Center's search figure
 * mounts the same part read-only, so the pictured field is this field rather than a copy of its
 * values.
 */
export function ShelfSearchField({ value, onChange, placeholder, ariaLabel, readOnly, wrapStyle, wrapAttrs }: {
  value: string;
  onChange?: (next: string) => void;
  placeholder?: string;
  ariaLabel?: string;
  readOnly?: boolean;
  /** The room the capsule keeps in the row it stands in; the box itself is `SEARCH`'s. */
  wrapStyle?: CSSProperties;
  wrapAttrs?: HTMLAttributes<HTMLDivElement>;
}) {
  const weightAt = useFrameReadableWeight();
  const searchStyle: PwStyle = {
    position: 'relative', display: 'block', boxSizing: 'border-box',
    width: '100%', height: '100%',
    paddingLeft: SEARCH.padX, paddingRight: SEARCH.padX,
    paddingTop: 0, paddingBottom: 0,
    background: 'transparent', border: 'none', outline: 'none',
    fontSize: SEARCH.text, fontWeight: weightAt(800, SEARCH.text), color: PLATE_INK,
    lineHeight: 'normal', cursor: cursors.text,
    '--pw-placeholder': MUTED_INK,
  };
  return (
    // The focus ring goes on the BOX, not on the input: an outline follows its own element's
    // corner, and the input is a rectangle laid over the drawn capsule. The pair is declared in
    // `design/focus-source.ts`, which is where the whole rule reads.
    <div
      className={FIELD_WRAP_CLASS}
      style={{ position: 'relative', width: SEARCH.w, height: SEARCH.h, borderRadius: SEARCH.radius, ...wrapStyle }}
      {...wrapAttrs}
    >
      {/* The plate wears the hairline every drawing standing on the map wears
          (`shape-edge.tsx:ShapeEdge`), on the art itself rather than on the box, so what is
          outlined is the capsule's own silhouette and not the rectangle around it. */}
      <ShapeEdge style={{ position: 'absolute', inset: 0 }}>
        <Plate src={searchArt} style={{ inset: 0, width: '100%', height: '100%' }} />
      </ShapeEdge>
      <input
        type="search"
        className={`pw-search-field ${FIELD_INPUT_CLASS}`}
        value={value}
        onChange={onChange ? (e) => onChange(e.target.value) : undefined}
        readOnly={readOnly}
        aria-label={ariaLabel}
        placeholder={placeholder}
        style={searchStyle}
      />
    </div>
  );
}

/** What the row's own box says about how far it scrolls. Both come from the element itself, never
 *  from a design width: the row is as wide as the window leaves it. */
interface Reach {
  /** Design px, which is what `ShelfScrollbar` reads and what `px()` converts back from. */
  viewportW: number;
  contentW: number;
}

/** The category the shelf opens on: the armed card's own, so leaving 物品 mode and coming back
 *  reopens where the user was. An item names its category; a planting macro stands in the tab
 *  that leads it (`patchIdFor`). */
function initialCategory(itemId: string | null, macro: string | null): ItemCategory {
  const armed = itemId
    ? getCatalogItem(itemId)?.category
    : macro ? TABS.find((tab) => patchIdFor(tab.category) === macro)?.category : undefined;
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
  /** A query the pictured shelf shows as typed, standing in for the field's own state; the live
   *  shelf never passes this and keeps typing into its own. */
  posedQuery?: string;
}

/**
 * The shelf's backing, as the design draws it: a band at the bottom that the item cards stand UP
 * out of, not a box around the rows. See `units.ts:PLATE_BAND`. Exported so the Help Center's shelf
 * figure stands its cards on this SAME band rather than a plate drawn to guess at it.
 */
export function ShelfBand() {
  return (
    <span
      data-testid="bar-plate"
      style={{
        position: 'absolute',
        left: -PLATE_BAND.overhang, right: -PLATE_BAND.overhang,
        bottom: -PLATE_BAND.radius, height: PLATE_BAND.top + PLATE_BAND.radius,
        borderRadius: PLATE_BAND.radius, background: BAR.fill,
        // The plate is SOLID: the shelf's root is pointer-transparent so the map stays reachable
        // around the shelf, but input over the visible dock belongs to the dock — without this a
        // drag across it panned the map underneath.
        pointerEvents: 'auto',
      }}
    />
  );
}

export function ObjectShelf({ only, pick, posedQuery }: ObjectShelfProps = {}) {
  return (
    <ScaleProvider value={SHELF_SCALE}>
      <ObjectShelfBody only={only} pick={pick} posedQuery={posedQuery} />
    </ScaleProvider>
  );
}

function ObjectShelfBody({ only, pick, posedQuery }: ObjectShelfProps) {
  const { px, scale } = usePx();
  const swapMotion = useMotion('shelf.category.swap');
  const t = useT();
  const locale = useEditorStore((s) => s.locale);
  const selectedItemId = useEditorStore((s) => s.selectedItemId);
  const armedMacro = useEditorStore((s) => s.armedMacro);
  const setEditMode = useEditorStore((s) => s.setEditMode);
  const gridState = useEditorStore((s) => s.gridState);
  const eventBus = useEditorStore((s) => s.eventBus);

  const [category, setCategory] = useState<ItemCategory>(() => initialCategory(selectedItemId, armedMacro));
  const [innerQuery, setInnerQuery] = useState('');
  const [pendingReveal, setPendingReveal] = useState(() => pick ? null : selectedItemId);
  useEffect(() => {
    if (pick) return;
    const reveal = ({ catalogId }: { catalogId: string }) => {
      setCategory(initialCategory(catalogId, null));
      setInnerQuery('');
      setPendingReveal(catalogId);
    };
    eventBus.on('catalog-reveal', reveal);
    return () => eventBus.off('catalog-reveal', reveal);
  }, [eventBus, pick]);
  // The one point `query` is read from: a posed figure overrides it for both ranking and display,
  // and the field itself keeps typing into `innerQuery` untouched, so the live shelf never sees it.
  const query = posedQuery ?? innerQuery;
  const [reached, setReached] = useState<{ name: string; centre: number } | null>(null);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [reach, setReach] = useState<Reach>({ viewportW: 0, contentW: 0 });
  const zoom = useFrameZoom();
  const layout = useFrameLayout();
  const clearance = useRailClearance(SHELF_BOX.bottom, SHELF_TABS.floor + TEXT.shelfTab - SHELF_BOX.bottom);
  const right = layout ? layout.edgeRight + clearance : SHELF_BOX.right;
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

  // The row re-renders per card hover and per scroll tick; the catalog ranking only owes the
  // renders where its own inputs moved.
  const all = useMemo(() => shelfItems(query, category, locale), [query, category, locale]);
  const items = useMemo(() => (only ? all.filter(only) : all), [all, only]);
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

  useEffect(() => {
    if (!pendingReveal || query || category !== getCatalogItem(pendingReveal)?.category) return;
    const card = Array.from(rowRef.current?.querySelectorAll<HTMLElement>('[data-catalog-id]') ?? [])
      .find(el => el.dataset.catalogId === pendingReveal);
    const row = rowRef.current;
    if (!card || !row) return;
    scrollRowTo(card.offsetLeft + card.offsetWidth / 2 - row.clientWidth / 2, false);
    setPendingReveal(null);
  }, [pendingReveal, query, category, items, scrollRowTo]);

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

  return (
    <div
      ref={rootRef}
      {...helpTargetAttr('objects')}
      style={{
        position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: z.panel, pointerEvents: 'none',
        display: 'flex', flexDirection: 'column', alignItems: 'stretch',
        padding: `0 ${right}px ${SHELF_BOX.bottom}px ${SHELF_BOX.left}px`,
        transition: cssMotion('frame.layout.adapt', 'padding-right'),
      }}
    >
      <ShelfBand />

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
          // line of its own lands at the shelf's left edge under the first name, which is where a
          // long language puts it.
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
            setInnerQuery('');
            setCategory(next);
            if (selectedItemId && getCatalogItem(selectedItemId)?.category !== next) {
              setEditMode({ mode: 'object', itemId: null });
            } else if (armedMacro && armedMacro !== patchIdFor(next)) {
              setEditMode({ mode: 'object', macro: null });
            }
          }}
        />

        <ShelfSearchField
          value={query}
          onChange={setInnerQuery}
          ariaLabel={t('shelf.search')}
          // The drawing writes the placeholder with a trailing ellipsis, which invites typing. It
          // is not part of the field's NAME, so a reader hears "Search" and not the dots.
          placeholder={t('shelf.search_ph')}
          wrapStyle={{
            flex: 'none', width: SEARCH.w, maxWidth: '45%',
            marginLeft: layout?.compact ? 0 : SEARCH.inset,
            // The row's own bottom edge is the mark's, and the field stands off the names' INK
            // above it (`SEARCH.bottom`), not off the line box that carries them.
            marginBottom: SEARCH.bottom,
            pointerEvents: 'auto',
          }}
          wrapAttrs={helpTargetAttr('search')}
        />

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
        <CardNameBubble
          reached={reached ? { ...reached, centre: reached.centre - scrollLeft * scale } : null}
        />

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
              onClick={() => setInnerQuery('')}
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
