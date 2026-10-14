/*
 * The object shelf: category tabs, bilingual search and a scrolling card row. Selection is edit state;
 * searching clears the category; hovered names draw outside the clipping row at their card's scrolled place.
 */
import { disarmOutsideCategory, toggleArmedItem, toggleArmedMacro } from '../../../../editor/editing/object-shelf';
import { ShelfSearchField } from './ShelfSearchField';
import { ActionButton } from '../../../primitives/ActionButton';
import { mapEdgeAttr } from '../../../primitives/map-edge';
import {
  useCallback, useEffect, useMemo, useRef, useState,
  } from 'react';
import { motion, useReducedMotionConfig } from 'framer-motion';
import { ItemCategory } from '../../../../config/catalog/categories';
import type { CatalogItem } from '../../../../core/model/types';
import { useLocale, useT } from '../../../../i18n/context';
import { getCatalogByCategory, getCatalogItem } from '../../../../state/catalog';
import { getObjectIndex } from '../../../../state/object-index';
import { useEditorStore } from '../../../../state/store';
import { macroForShelfCategory } from '../../../../tools/macros';
import { useScrollRow } from '../../../primitives/use-scroll-row';
import { ScaleProvider, usePx } from '../../../design/scale';
import { btnReset, cursors, z, radii } from '../../../design/styles';
import { PLATE, PLATE_INK } from '../../../design/tokens';
import { SHELF_SCALE, SHELF_TABS, TEXT } from '../../units';
import { BarText } from '../bar-atoms';
import { CardNameBubble } from '../CardNameBubble';
import { ShelfBand } from '../ShelfBand';
import { ItemCard, SmartCard } from './ItemCard';
import {
  ROW, SCROLL, SEARCH, SHELF_BOX, TABS, shelfItems, tabRowGap,
} from './object-shelf';
import { useFrameZoom } from '../../use-frame-zoom';
import { useFrameLayout, useRailClearance } from '../../frame-layout';
import { cssMotion } from '../../../design/motion';
import { ShelfScrollbar } from './ShelfScrollbar';
import { ShelfTabs, TAB_ROW } from '../ShelfTabs';

import { helpTargetAttr } from '../../../session/help-targets';
import { MOTIONS } from '../../../design/motion/registry';
import { useTransition } from '../../../design/motion/use-motion';
import { useObservedSize } from '../../../primitives/use-observed-size';
import { useMapRevision } from '../../../session/use-map-revision';
import { armedItemOf, armedMacroOf } from '../../../../state/editing/edit-mode';

/** How far a fresh row of cards comes in from, in css px: the registry's own amplitude, since a
 *  distance typed at an element is the same unfindable decision a duration typed there is. */
const CARD_ARRIVE_X = MOTIONS['shelf.category.swap'].amplitude;

/** What the row's own box says about how far it scrolls. Both come from the element itself, never
 *  from a design width: the row is as wide as the window leaves it. */
interface Reach {
  /** Design px, which is what `ShelfScrollbar` reads and what `px()` converts back from. */
  viewportW: number;
  contentW: number;
}

/** The category the shelf opens on: the armed item's or planting card's, so returning reopens where the visitor was. */
function initialCategory(itemId: string | null, macro: string | null): ItemCategory {
  const armed = itemId
    ? getCatalogItem(itemId)?.category
    : macro ? TABS.find((tab) => macroForShelfCategory(tab.category) === macro)?.category : undefined;
  return TABS.find((tab) => tab.category === armed)?.category ?? TABS[0]!.category;
}

/**
 * `only` narrows the row to the items a caller can use; `pick` makes the shelf a chooser that reports an
 * item and arms nothing.
 */
interface ObjectShelfProps {
  only?: (item: CatalogItem) => boolean;
  pick?: { current: string | null; onPick: (catalogId: string) => void };
  /** A query the pictured shelf shows as typed, standing in for the field's own state; the live
   *  shelf never passes this and keeps typing into its own. */
  posedQuery?: string;
  /** The whole row while a planet session is open, in place of the catalog's tabs and search. */
  source?: () => CatalogItem[];
}

/** The shelf under its own scale; the body reads `usePx` for its own measurements, so the scale wraps it. */
export function ObjectShelf({ only, pick, posedQuery, source }: ObjectShelfProps = {}) {
  return (
    <ScaleProvider value={SHELF_SCALE}>
      <ObjectShelfBody only={only} pick={pick} posedQuery={posedQuery} source={source} />
    </ScaleProvider>
  );
}

function ObjectShelfBody({ only, pick, posedQuery, source }: ObjectShelfProps) {
  const { px, scale } = usePx();
  const swapMotion = useTransition('shelf.category.swap');
  const t = useT();
  const locale = useLocale();
  const selectedItemId = useEditorStore(armedItemOf);
  const armedMacro = useEditorStore(armedMacroOf);
  const gridState = useEditorStore((s) => s.gridState);
  const eventBus = useEditorStore((s) => s.eventBus);
  const sourced = useEditorStore((s) => !!s.planetSession) && !!source;

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

  /**
   * Moves the row: a glide for a press on the scrollbar, at once for what must stay under the pointer and
   * under reduced motion; the wheel glides itself (`row-scroll.ts:wheelGlide`).
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

  // Counts are patched in place, so a placement needs only the once-a-frame map revision.
  useMapRevision(true, 'frame');
  const counts = gridState ? getObjectIndex(gridState).countByCatalog : null;

  // The row re-renders per card hover and per scroll tick; the catalog ranking only owes the
  // renders where its own inputs moved.
  const all = useMemo(
    () => (sourced ? source!() : shelfItems(query, category, locale)),
    [sourced, source, query, category, locale],
  );
  const items = useMemo(() => (only ? all.filter(only) : all), [all, only]);
  /** The categories that still hold something under `only`; a sourced row has none. */
  const shownTabs = useMemo(
    () => (sourced ? [] : only ? TABS.filter((tab) => getCatalogByCategory(tab.category).some(only)) : TABS),
    [only, sourced],
  );
  const searching = !sourced && query.trim().length > 0;
  const patchId = macroForShelfCategory(category);
  const rowFade = useScrollRow(rowRef, { zoom, pointerEvents: 'auto' });

  // A narrower result can leave the row scrolled past its end, and the hovered name's card is gone.
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

  useObservedSize(() => rootRef.current, () => {
    const row = rowRef.current;
    if (!row) return;
    // The row's own box, never a client rect: width, scroll width and offset are one coordinate space.
    const next: Reach = {
      viewportW: row.clientWidth / scale,
      contentW: row.scrollWidth / scale,
    };
    setReach((was) => (
      was.viewportW === next.viewportW && was.contentW === next.contentW ? was : next
    ));
  }, [items.length, category, scale]);

  return (
    <div
      ref={rootRef}
      {...helpTargetAttr('objects')}
      {...mapEdgeAttr('bottom')}
      style={{
        position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: z.panel, pointerEvents: 'none',
        display: 'flex', flexDirection: 'column', alignItems: 'stretch',
        padding: `0 ${right}px ${SHELF_BOX.bottom}px ${SHELF_BOX.left}px`,
        transition: cssMotion('frame.layout.adapt', ['padding-right']),
      }}
    >
      <ShelfBand />

      {/* The names and the field are one row on the floor both shelves share, the field just past the last name. */}
      <div
        style={{
          ...TAB_ROW, position: 'relative', marginBottom: tabRowGap(),
          // One line always: the names scroll to absorb a long language, the field keeps its place.
          flexWrap: 'nowrap',
        }}
      >
        <ShelfTabs
          label={t('mode.object')}
          // A narrowed shelf shows only the categories it still has items in.
          tabs={shownTabs.map((tab) => ({ id: tab.category, label: t(tab.labelKey) }))}
          active={searching ? null : category}
          // Switching category puts down an armed item or planting card the new row does not hold; the armed item's
          // own category is how the shelf reopens on it.
          onSelect={(next) => {
            setInnerQuery('');
            setCategory(next);
            disarmOutsideCategory(next);
          }}
        />

        {sourced ? null : <ShelfSearchField
          value={query}
          onChange={setInnerQuery}
          ariaLabel={t('shelf.search')}
          // The drawing writes the placeholder with a trailing ellipsis, which invites typing. It
          // is not part of the field's name, so a reader hears "Search" and not the dots.
          placeholder={t('shelf.search_ph')}
          wrapStyle={{
            flex: 'none', width: SEARCH.w, maxWidth: '45%',
            marginLeft: layout?.compact ? 0 : SEARCH.inset,
            // The row's own bottom edge is the mark's, and the field stands off the names' ink
            // above it (`SEARCH.bottom`), not off the line box that carries them.
            marginBottom: SEARCH.bottom,
            pointerEvents: 'auto',
          }}
          wrapAttrs={helpTargetAttr('search')}
        />}

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
          style={{
            // Positioned, so a card's `offsetLeft` is measured from the row's own content box and
            // the name above it needs nothing but the scroll offset to follow it.
            position: 'relative', flex: '1 1 auto', minWidth: 0,
            display: 'flex', alignItems: 'center',
            boxSizing: 'border-box', padding: px(ROW.pad),
            height: px(ROW.card + 2 * ROW.pad),
            ...rowFade,
          }}
        >
          {/*
            The cards arrive from the right as one reel on a category swap, keyed so it plays; a search is one key, so
            typing never replays it. The reel is unpositioned, so card offsets still measure from the row.
          */}
          <motion.div
            key={searching ? 'search' : category}
            initial={{ opacity: 0, x: CARD_ARRIVE_X }}
            animate={{ opacity: 1, x: 0 }}
            transition={swapMotion}
            style={{ display: 'flex', alignItems: 'center', gap: px(ROW.gap), flex: 'none' }}
          >
            {/* The planting card stands first, only in the categories it plants and never in a search. */}
            {/* A narrowed shelf offers no planting card: a patch is not an item a caller can use. */}
            {!searching && patchId && !only && !sourced ? (
              <SmartCard
                selected={armedMacro === patchId}
                onToggle={() => toggleArmedMacro(patchId)}
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
                  // A chooser reports. Arming here would put the map under a placement cursor and
                  // light the object block, for a press that was answering a generator's question.
                  if (pick) { pick.onPick(item.id); return; }
                  toggleArmedItem(item.id);
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
            <ActionButton
              interaction="tile"
              onClick={() => setInnerQuery('')}
              style={{
                ...btnReset, cursor: cursors.clickable, pointerEvents: 'auto',
                display: 'flex', alignItems: 'center', padding: '6px 20px',
                borderRadius: radii.pill, background: PLATE,
              }}
            >
              <BarText size={TEXT.label} color={PLATE_INK}>{t('shelf.clear_search')}</BarText>
            </ActionButton>
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