/*
 * The object shelf: category tabs, bilingual search and a scrolling card row. Selection is edit state;
 * searching clears the category; hovered names draw outside the clipping row at their card's scrolled place.
 * On an upright window it is the dark panel the bar raises: the tabs and a search button over a grid
 * of cards, folding to the armed card once one is armed so the map is free. While a finger carries a
 * card off the row, the band shows only the line saying a release over it puts the card back.
 */
import { ShelfSearchField } from './ShelfSearchField';
import { mapEdgeAttr } from '../../../primitives/map-edge';
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { motion, useReducedMotionConfig } from 'framer-motion';
import { useT } from '../../../../i18n/context';
import { useScrollRow } from '../../../primitives/use-scroll-row';
import { useSwapReel } from '../../../primitives/use-swap-clip';
import { ScaleProvider, usePx } from '../../../design/scale';
import { roleSize } from '../../../design/text-weight';
import { SHELF_SCALE, SHELF_TABS } from '../../units';
import { CardNameBubble, type CardNameReach } from '../CardNameBubble';
import { useTouchMode } from '../../../design/input-mode';
import { ShelfBand } from '../ShelfBand';
import { centreIn } from '../row-scroll';
import { wideBarRoot } from '../bar-panel';
import { CarryCancel } from './CarryCancel';
import { ItemCard, SmartCard } from './ItemCard';
import { UprightObjectPanel } from './UprightObjectPanel';
import { ShelfBrushButton } from './ShelfBrushButton';
import { ROW, SCROLL, SEARCH, SHELF_BOX, searchFolds, tabRowGap, twoNamesWide } from './object-shelf';
import { ShelfSearchPill, underOpenSearch } from './ShelfSearchPill';
import { plateShapeEdge } from '../../../design/tokens';
import { NoMatch, ShelfCategoryTabs, useObjectShelf, type ObjectShelfModel, type ObjectShelfProps } from './use-object-shelf';
import { useFrameZoom } from '../../use-frame-zoom';
import { useFrameLayout, usePlanGlide, useRailClearance } from '../../frame-layout';
import { LANDSCAPE_BAR } from '../../frame-plan';
import { cssMotion, seconds } from '../../../design/motion';
import { ShelfScrollbar, useShelfScrollbar } from '../ShelfScrollbar';
import { TAB_ROW, namesIndent } from '../ShelfTabs';
import { helpTargetAttr } from '../../../session/help-targets';
import { useObservedSize } from '../../../primitives/use-observed-size';
import { useMorph, useMorphGroup } from '../../../primitives/morph';

/** The card row's id, which its scrollbar names as what it scrolls. */
const ROW_ID = 'shell-shelf-row';

/** The shelf under its own scale; the body reads `usePx` for its own measurements, so the scale wraps it. */
export function ObjectShelf(props: ObjectShelfProps = {}) {
  return (
    <ScaleProvider value={SHELF_SCALE}>
      <ObjectShelfBody {...props} />
    </ScaleProvider>
  );
}

/** One model, drawn as the upright panel or as the wide row; only the shape showing runs its hooks. */
function ObjectShelfBody(props: ObjectShelfProps) {
  const model = useObjectShelf(props);
  const layout = useFrameLayout();
  return layout?.shape === 'portrait' ? <UprightObjectPanel model={model} /> : <ObjectRow model={model} />;
}

/** The shelf on a wide window: the names and the field over one scrolling row of cards. */
function ObjectRow({ model }: { model: ObjectShelfModel }) {
  const { px, scale } = usePx();
  const t = useT();
  const { pick, items, counts, searching, sourced, query, revealing, revealed } = model;
  const [reached, setReached] = useState<CardNameReach | null>(null);
  /** In touch mode, where a held card carries rather than names itself, the selected card's name stands. */
  const [selectedName, setSelectedName] = useState<CardNameReach | null>(null);
  const touch = useTouchMode();
  /** A finger carries a card of the row: its contents stay mounted, out of sight, under the cancel line. */
  const [carrying, setCarrying] = useState(false);
  const carried = touch && carrying;
  const out: CSSProperties | null = carried ? { visibility: 'hidden' } : null;
  const zoom = useFrameZoom();
  const layout = useFrameLayout();
  const bar = layout?.bar ?? LANDSCAPE_BAR;
  const clearance = useRailClearance(SHELF_BOX.bottom, bar.tabsTop + roleSize('title') - SHELF_BOX.bottom);
  const right = layout ? layout.edgeRight + clearance : SHELF_BOX.right;
  const rowRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotionConfig() ?? false;

  const rowFade = useScrollRow(rowRef, { zoom, pointerEvents: 'auto' });
  const reelKey = searching ? 'search' : model.category;
  const swap = useSwapReel(reelKey);

  // A narrower result can leave the row scrolled past its end, and the hovered name's card is gone.
  // The wheel glides the row itself (`primitives/scroll-input.ts:wheelGlider`).
  const scroll = useShelfScrollbar(rowRef, { id: ROW_ID, content: [items.length, model.category], reset: `${model.category}|${query}` });
  const { scrollLeft } = scroll;
  useEffect(() => setReached(null), [model.category, query]);

  useEffect(() => {
    const row = rowRef.current;
    if (!revealing || !row) return;
    const card = Array.from(row.querySelectorAll<HTMLElement>('[data-catalog-id]')).find(el => el.dataset.catalogId === revealing);
    if (!card) return;
    centreIn(row, card, 'x');
    revealed();
  }, [revealing, items, revealed]);

  // Read off the pressed card itself, which carries its shown name and its place in the row.
  useLayoutEffect(() => {
    const card = touch ? rowRef.current?.querySelector<HTMLElement>('[aria-pressed="true"]') : null;
    const next = card ? { name: card.getAttribute('aria-label') ?? '', centre: card.offsetLeft + card.offsetWidth / 2 } : null;
    setSelectedName((was) => (was?.name === next?.name && was?.centre === next?.centre ? was : next));
  }, [touch, model.selectedItemId, model.armedMacro, pick, items, scroll.bar.viewportW, scroll.bar.contentW]);

  // Where the names start past the character the row is shortest, and a tab's gap of air keeps their
  // fade clear of the group.
  const groupLead = layout?.compact ? (bar.tabsLeft === undefined ? 0 : SHELF_TABS.gap) : SEARCH.inset;
  const namesRowRef = useRef<HTMLDivElement>(null);
  const [folded, setFolded] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  // The row's width and the names' own, never the names' box, so what folding the field frees never feeds back into it.
  useObservedSize(() => namesRowRef.current, ([row]) => {
    if (!row || row.clientWidth === 0) return;
    const least = twoNamesWide(Array.from(row.querySelectorAll<HTMLElement>('[role="tab"]'), (tab) => tab.offsetWidth));
    setFolded((was) => searchFolds(was, { row: row.clientWidth, lead: groupLead, least }));
  }, [t, model.tabs, groupLead, sourced]);
  const folds = folded && !sourced;
  useEffect(() => { if (!folds) setSearchOpen(false); }, [folds]);
  // The field shrinks into the round button, or grows back out of it, in one motion: the group's width
  // glides and the button stands in for the field once it is round. The first fold a mount lands on,
  // reduced motion and a typed query take the new shape at once.
  const [glides, setGlides] = useState(false);
  useEffect(() => {
    if (typeof requestAnimationFrame !== 'function') return undefined;
    const frame = requestAnimationFrame(() => setGlides(true));
    return () => cancelAnimationFrame(frame);
  }, []);
  const [round, setRound] = useState(false);
  const atOnce = !glides || reduced || query !== '';
  useEffect(() => {
    if (!folds) { setRound(false); return undefined; }
    if (atOnce) { setRound(true); return undefined; }
    // A width that does not change fires no transition end; the motion's own length stands in for it.
    const late = setTimeout(() => setRound(true), seconds('shelf.search.expand') * 1000 + 50);
    return () => clearTimeout(late);
  }, [folds, atOnce]);
  const fieldShows = !folds || !round;
  // A query typed before the field folded stays in sight.
  const searchShown = folds && (searchOpen || query !== '');
  const under = underOpenSearch(searchShown, reduced);
  const named = reached ?? selectedName;
  // Pieces of the chrome's morph as on every wide surface in the bar's place (`bar-panel.tsx:useBarSurface`),
  // a row each, since the names' indent past the character is the row's own and changes with the mode.
  const group = useMorphGroup();
  const tabsPiece = useMorph('shelf-tabs', 'span-start');
  const glide = usePlanGlide('frame.layout.adapt');
  const cardsPiece = useMorph('shelf-cards', 'span-start');
  const trackPiece = useMorph('shelf-track', 'span-start');

  return (
    <div
      {...group}
      {...helpTargetAttr('objects')}
      {...mapEdgeAttr('bottom')}
      style={{
        ...wideBarRoot(bar),
        display: 'flex', flexDirection: 'column', alignItems: 'stretch',
        padding: `0 ${right}px ${SHELF_BOX.bottom}px ${SHELF_BOX.left}px`,
        transition: glide(['padding-right']),
      }}
    >
      <ShelfBand morph="bar-band" />
      {carried ? <CarryCancel style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: bar.height }} /> : null}

      {/* The names and the search group are one row on the floor both shelves share, the group just past the last name. */}
      <div
        ref={namesRowRef}
        {...tabsPiece}
        style={{
          ...TAB_ROW, position: 'relative', marginBottom: tabRowGap(bar.tabsTop), marginLeft: namesIndent(bar),
          // One line always: the names scroll to absorb a long language, the field keeps its place.
          flexWrap: 'nowrap', ...out,
        }}
      >
        {/* Folded, the names take the row up to the group, so the group stands at its end, where the pill opens from. */}
        <div {...under.attrs} style={{ display: 'flex', alignItems: 'flex-end', minWidth: 0, flex: folds ? '1 1 auto' : '0 1 auto', ...under.style }}>
          <ShelfCategoryTabs model={model} />
        </div>

        {/* The brush button and the field are one group, the button first, as wide as the field alone
            was; a pill the button grows into takes its room from the field, so the group keeps its width.
            Folded, the field is a round search button that grows over the row into the field (UI-28). */}
        {sourced ? null : (
          <div
            onTransitionEnd={(e) => { if (e.target === e.currentTarget && e.propertyName === 'width' && folds) setRound(true); }}
            style={{
              flex: 'none', display: 'flex', alignItems: 'center', gap: SEARCH.group.gap,
              width: folds ? 2 * SEARCH.h + SEARCH.group.gap : SEARCH.group.w, maxWidth: folds ? undefined : '45%',
              transition: glides ? cssMotion('shelf.search.expand', ['width'], reduced) : 'none',
              marginLeft: groupLead,
              // The row's own bottom edge is the mark's, and the group stands off the names' ink
              // above it (`SEARCH.bottom`), not off the line box that carries them.
              marginBottom: SEARCH.bottom,
            }}
          >
            {/* A chooser's row keeps the button's place empty, so the field never moves (EDIT-64). */}
            {model.brushes
              ? <span {...under.attrs} style={{ flex: 'none', display: 'flex', ...under.style }}>
                <ShelfBrushButton size={SEARCH.h} paints={model.paints} {...(folds ? {} : { expands: { room: SEARCH.w - SEARCH.h } })} />
              </span>
              : <span aria-hidden style={{ flex: 'none', width: SEARCH.h }} />}
            {fieldShows ? <ShelfSearchField
              wordsHidden={folds}
              value={query}
              onChange={model.setQuery}
              ariaLabel={t('shelf.search')}
              // The drawing writes the placeholder with a trailing ellipsis, which invites typing. It
              // is not part of the field's name, so a reader hears "Search" and not the dots.
              placeholder={t('shelf.search_ph')}
              wrapStyle={{ flex: '1 1 0', minWidth: SEARCH.h, width: 'auto', pointerEvents: 'auto' }}
              wrapAttrs={helpTargetAttr('search')}
            /> : null}
          </div>
        )}
        {folds && round ? (
          <ShelfSearchPill size={SEARCH.h} open={searchShown} onOpenChange={setSearchOpen} query={query}
            setQuery={model.setQuery} reduced={reduced} style={{ bottom: SEARCH.bottom, boxShadow: plateShapeEdge() }} />
        ) : null}

      </div>

      <div
        {...cardsPiece}
        style={{
          position: 'relative', display: 'flex', alignItems: 'center',
          marginBottom: SHELF_BOX.rowGap, ...out,
        }}
      >
        <div
          {...scroll.row}
          ref={rowRef}
          className="pw-noscroll"
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
            typing never replays it. The reel and the box it travels in are unpositioned, so card offsets still
            measure from the row.
          */}
          <div style={{ display: 'flex', flex: 'none', ...swap.clip }}>
            <motion.div
              key={reelKey}
              {...swap.reel}
              style={{ display: 'flex', alignItems: 'center', gap: px(ROW.gap), flex: 'none' }}
            >
              {/* The planting card stands first, only in the categories it plants and never in a search. */}
              {/* A narrowed shelf offers no planting card: a patch is not an item a caller can use. */}
              {model.patch ? (
                <SmartCard
                  selected={model.patch.selected}
                  onToggle={model.patch.onToggle}
                  onReach={setReached}
                />
              ) : null}
              {items.map((item) => (
                <ItemCard
                  key={item.id}
                  item={item}
                  placed={counts?.get(item.id) ?? 0}
                  selected={model.isSelected(item.id)}
                  onToggle={(multi) => model.toggleItem(item.id, multi)}
                  onReach={setReached}
                  carries={!pick}
                  onCarry={setCarrying}
                />
              ))}
            </motion.div>
          </div>
        </div>

        {/* The reached card's name, else the selected one's in touch mode, in the gap the row keeps
            above it. It rises the last few pixels into place so it reads as coming off the tile
            rather than appearing over the map. */}
        <CardNameBubble
          reached={named ? { ...named, centre: named.centre - scrollLeft * scale } : null}
        />

        {items.length === 0 ? <NoMatch model={model} style={{ position: 'absolute', inset: 0 }} /> : null}
      </div>

      <div
        ref={trackRef}
        {...trackPiece}
        style={{ position: 'relative', height: px(SCROLL.thumb.h), pointerEvents: 'none', ...out }}
      >
        <ShelfScrollbar {...scroll.bar} />
      </div>
    </div>
  );
}