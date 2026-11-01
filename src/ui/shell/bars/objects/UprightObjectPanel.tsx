/**
 * The object shelf on an upright window: the dark panel the bar raises, with the tabs and a search
 * button over a grid of cards, each named only while selected or reached for. Arming a card folds
 * the panel down to that card so the map is free; a press on it opens the panel again. While a card
 * is carried the panel keeps only the line saying a release over it puts the card back; the rest
 * stays mounted out of sight, since the carried card holds the pointer.
 */
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { motion, useReducedMotionConfig } from 'framer-motion';
import { getCatalogItem } from '../../../../state/catalog';
import { useTransition } from '../../../design/motion/use-motion';
import { localizedName, useLocale, useT } from '../../../../i18n/context';
import { ScaleProvider, TOUCH_TARGET, usePx } from '../../../design/scale';
import { cursors } from '../../../design/styles';
import { ON_DARK } from '../../../design/tokens';
import { MOTIONS } from '../../../design/motion/registry';
import { mapEdgeAttr } from '../../../primitives/map-edge';
import { SCROLL_FADE, useScrollFade } from '../../../primitives/scroll-fade';
import { withinStop } from '../../../primitives/scroll-geometry';
import { useWheelToHorizontal } from '../../../primitives/wheel-horizontal';
import { useSwapClip } from '../../../primitives/use-swap-clip';
import { MORPH_PIECE_ATTR, MORPHING_ATTR, morphScope, type MorphFirst } from '../../../primitives/morph';
import { MorphOnChange } from '../../../primitives/MorphOnChange';
import { useUiPreview } from '../../../design/preview';
import { SEAM_HANDLE, SeamHandle } from '../../../primitives/SeamHandle';
import { createSignal } from '../../../../core/base/signal';
import { helpTargetAttr } from '../../../session/help-targets';
import { useFrameLayout } from '../../frame-layout';
import { useFrameReadableWeight, useFrameZoom } from '../../use-frame-zoom';
import { EDGE, SHELF_SCALE, TEXT, UPRIGHT_SPACE } from '../../units';
import { BAR_LINE_HEIGHT, BarText } from '../bar-atoms';
import { PanelTone, UPRIGHT_FOOT, useBarSurface } from '../bar-panel';
import { CarryCancel } from './CarryCancel';
import { ItemCard, SmartCard } from './ItemCard';
import { FOLDED_CARD, ROW, UPRIGHT_GRID, uprightCardFit } from './object-shelf';
import { ShelfSearchPill, underOpenSearch } from './ShelfSearchPill';
import { ShelfBrushButton } from './ShelfBrushButton';
import { centreIn } from '../row-scroll';
import { TAB_MARK_DEPTH } from '../ShelfTabs';
import { BAR_PANEL_DRAG_VAR } from '../ShelfBand';
import { NoMatch, ShelfCategoryTabs, type ObjectShelfModel } from './use-object-shelf';

/** How far a fresh grid of cards comes in from: the registry's own amplitude, as the row's. */
const CARD_ARRIVE_X = MOTIONS['shelf.category.swap'].amplitude;

/** The planting card's key where an item's catalog id stands. */
const PATCH = 'patch';

/** The tabs and search row over the grid, in frame px. */
const UPRIGHT_HEAD_H = TOUCH_TARGET;

/** One grid cell's depth: the card and the name under it, in frame px at the shelf's scale. */
function uprightCellH(px: (n: number) => number): number {
  return px(ROW.card) + UPRIGHT_GRID.gap / 2 + TEXT.small * BAR_LINE_HEIGHT;
}

/** What the upright object panel stands around its grid of cards: its handle, its head, the row gap
 *  and its foot, in frame px. */
const GRID_SURROUND = SEAM_HANDLE.h + UPRIGHT_HEAD_H + UPRIGHT_SPACE.row + UPRIGHT_FOOT;

/**
 * The upright object grid's height and the most a handle may draw it to, in frame px. A height the
 * handle set (`asked`) is kept between one row (`least`) and what the panel's `reach` leaves it, over
 * the column up to the top row; with none set, the grid stands at its `resting` rows, kept within
 * what `room` leaves it, so a resting panel stands clear of undo and redo (`FrameLayout.bar`). A grid
 * that would rest short of `turn`, where its cards stand in a grid, rests at one row instead, since
 * they then stand in one sideways row. `kept` holds any height a handle asks for between least and most,
 * the drag's own clamp; `step` is where a keyboard step of `by` from the resting height asks for, so a
 * step up from one row reaches the grid rather than resting at one row again.
 */
export function uprightGridHeight({ asked, least, turn, resting, room, reach }: {
  asked: number | null; least: number; turn: number; resting: number; room?: number; reach?: number;
}): { height: number; most: number; kept: (h: number) => number; step: (by: number) => number } {
  const gridFor = (panel: number | undefined) => Math.max(least, (panel ?? Infinity) - GRID_SURROUND);
  const most = gridFor(reach ?? room);
  const kept = (h: number) => Math.min(most, Math.max(least, h));
  const rest = (h: number) => (h < turn ? least : h);
  const height = rest(asked !== null ? kept(asked) : Math.min(gridFor(room), kept(resting)));
  const step = (by: number) => kept(by > 0 && height < turn ? Math.max(turn, height + by) : height + by);
  return { most, kept, step, height };
}

/** The least the upright object panel works in: its handle, its head and one row of cards with the
 *  panel's padding (`bar-panel.tsx:useBarSurface`'s `least`). */
export function uprightObjectLeast(px: (n: number) => number): number {
  return GRID_SURROUND + uprightGridLeast(px);
}

/** The grid's least height, in frame px: one row of cards. */
function uprightGridLeast(px: (n: number) => number): number {
  return uprightCellH(px) + UPRIGHT_GRID.gap;
}

/** The least height the cards stand in a grid at, in frame px: one row with its names, the gap and the
 *  next row's cards whole, whose names show only for a selected or reached card and scroll into view. */
function uprightGridTurn(px: (n: number) => number): number {
  return uprightCellH(px) + UPRIGHT_GRID.gap + px(ROW.card);
}

/** How far past the grid's turning height a held handle draws it before the cards turn, either way, in
 *  frame px: half the grid's gap, so a finger resting at the turn never flaps between the two. */
const TURN_SLACK = UPRIGHT_GRID.gap / 2;

/** The first card a re-arrangement found in view, and the morph measured from where the cards stood. */
interface Before { lead: string | null; first: MorphFirst | null }

/** The cards of `grid`, in reading order. */
const cellsOf = (grid: HTMLElement) => Array.from(grid.querySelectorAll<HTMLElement>(`:scope > [${MORPH_PIECE_ATTR}]`));

/** The axis the grid scrolls along in the arrangement it stands in now. */
const axisOf = (grid: HTMLElement): 'x' | 'y' => (grid.dataset.arrangement === 'row' ? 'x' : 'y');

/** The first cell of `grid`, in reading order, that shows past the fade at the start of its view:
 *  the top left one in view. Read in the grid's own px, so the zoom never enters it. */
function leadIn(grid: HTMLElement): string | null {
  const x = axisOf(grid) === 'x';
  const at = x ? grid.scrollLeft : grid.scrollTop;
  const view = x ? grid.clientWidth : grid.clientHeight;
  const fade = withinStop(at) ? 0 : SCROLL_FADE;
  const cell = cellsOf(grid).find((el) => {
    const start = (x ? el.offsetLeft : el.offsetTop) - at;
    return start + (x ? el.offsetWidth : el.offsetHeight) > fade && start < view;
  });
  return cell?.getAttribute(MORPH_PIECE_ATTR) ?? null;
}

/** Where the view starts so `offset` stands just past the fade at the start of the view. */
const leadAt = (offset: number) => Math.max(0, offset - SCROLL_FADE);

/** The grid's height the panel's handle last set, in frame px, kept for the page's session; null
 *  until the handle is first dragged. */
const askedGrid = createSignal<number | null>(null);
const readAskedGrid = () => askedGrid.get();
const watchAskedGrid = (tell: () => void) => askedGrid.subscribe(() => tell());

/** Forgets the height the handle set, as a fresh page would. */
export function __resetUprightGrid(): void {
  askedGrid.emit(null);
}

export function UprightObjectPanel({ model }: { model: ObjectShelfModel }) {
  const { items, counts, query, patch, isSelected, revealing, revealed: onRevealed } = model;
  const gridRef = useRef<HTMLDivElement>(null);
  const swapMotion = useTransition('shelf.category.swap');
  const swapKey = model.searching ? 'search' : model.category;
  const swap = useSwapClip(swapKey);
  /** The armed item, which the folded panel shows; a chooser's shelf never folds and carries nothing. */
  const armedItem = !model.pick && model.selectedItemId ? getCatalogItem(model.selectedItemId) ?? null : null;
  const folds = !model.pick;
  const carries = !model.pick;
  const layout = useFrameLayout()!;
  const { px: shelfPx, scale } = usePx();
  // The grid's cards and the depths reckoned from them stand at the share that fits the columns.
  const { columns, fit: cardFit } = uprightCardFit(layout.width - layout.edgeLeft - layout.edgeRight, ROW.card * scale);
  const px = (n: number) => shelfPx(n * cardFit);
  const t = useT();
  const locale = useLocale();
  const weightAt = useFrameReadableWeight();
  const [folded, setFolded] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const reduced = useReducedMotionConfig();
  const under = underOpenSearch(searchOpen, reduced);
  /** Whether a held handle drives the grid's height, which it writes past React on each move. */
  const [following, setFollowing] = useState(false);
  const followingNow = useRef(false);
  const gridBoxRef = useRef<HTMLDivElement>(null);
  /** A card of this panel is in the hand. */
  const [carrying, setCarrying] = useState(false);
  /** The catalog id of the card the pointer or keyboard is on. */
  const [reachedId, setReachedId] = useState<string | null>(null);
  const isFolded = folded && folds && (!!armedItem || !!patch?.selected);
  // Open, the panel needs its head and a row of cards; folded to the armed card, all of it, measured.
  // The grid caps its own height, so the root does not scroll.
  // Open, the handle stands in the panel's top padding.
  const { root, reveal } = useBarSurface('dark', {
    least: isFolded ? undefined : uprightObjectLeast(px),
    ...(isFolded ? {} : { top: 0 }), scroll: false,
    following,
  });
  const asked = useSyncExternalStore(watchAskedGrid, readAskedGrid, readAskedGrid);
  const zoom = useFrameZoom();

  const fold = () => { setReachedId(null); setFolded(true); };
  const unfold = () => setFolded(false);
  const toggleItem = (id: string, multi = false) => {
    const arming = !isSelected(id);
    model.toggleItem(id, multi);
    // Picking a card beside the armed ones keeps the grid open for the next.
    if (arming && !multi) fold();
  };
  const togglePatch = () => {
    const arming = !patch!.selected;
    patch!.onToggle();
    if (arming) fold();
  };

  // A revealed card opens the panel, then the grid brings it to the middle.
  useEffect(() => {
    if (!revealing) return;
    if (folded) { setFolded(false); return; }
    const grid = gridRef.current;
    const card = Array.from(grid?.querySelectorAll<HTMLElement>('[data-catalog-id]') ?? []).find((el) => el.dataset.catalogId === revealing);
    if (!grid || !card) return;
    centreIn(grid, card, 'y');
    onRevealed();
  }, [revealing, folded, items, onRevealed]);

  // A fresh grid holds no reached card.
  useEffect(() => setReachedId(null), [swapKey]);

  const nameH = TEXT.small * BAR_LINE_HEIGHT;
  const cellH = uprightCellH(px);
  const gridLeast = uprightGridLeast(px);
  const turnAt = uprightGridTurn(px);
  const { most: gridMost, height: settledGrid, kept: keptGrid, step: stepGrid } = uprightGridHeight({
    asked, least: gridLeast, turn: turnAt, resting: UPRIGHT_GRID.rows * (cellH + UPRIGHT_GRID.gap), room: layout.bar.room, reach: layout.bar.reach,
  });
  const gridMax = settledGrid;
  // Room for less than the grid's turn: the cards stand in one row that scrolls sideways, each in the column
  // width the grid would give it, with the grid's gap, so a switch keeps every card's size. A carry
  // keeps the arrangement it began in, so the carried card's slot never moves under it; a held handle
  // turns the cards as its live height passes the turn by `TURN_SLACK` (`heldRow`, null at rest).
  const roomForOneRow = gridMax < turnAt;
  const [heldRow, setHeldRow] = useState<boolean | null>(null);
  const carriedRow = useRef(roomForOneRow);
  if (!carrying) carriedRow.current = heldRow ?? roomForOneRow;
  const oneRow = carriedRow.current;
  /** The arrangement standing now, read by the handle's moves between renders. */
  const shownRow = useRef(oneRow);
  shownRow.current = oneRow;
  const columnW = (layout.width - layout.edgeLeft - layout.edgeRight - (columns - 1) * UPRIGHT_GRID.gap) / columns;
  const gridFade = useScrollFade(gridRef, oneRow ? 'x' : 'y');
  // Laid out in columns the grid scrolls down by itself, and the hook stands aside.
  useWheelToHorizontal(gridRef, { zoom, smooth: true });
  // The cards travel between the arrangements; the card first in view before a turn leads the view after it.
  const preview = useUiPreview();
  const still = reduced === true || preview;
  const [morph] = useState(morphScope);
  useEffect(() => () => morph.stop(), [morph]);
  const arrangement = oneRow ? 'row' : 'grid';
  /** A fresh grid (another category or the search) has painted; a turn before that has nothing seen to
   *  travel from. A turn soon after another needs no wait: its pass draws each card where it stood, held
   *  or flying, which is where the measure finds it. */
  const painted = useRef(false);
  useLayoutEffect(() => {
    painted.current = false;
    if (typeof requestAnimationFrame !== 'function') { painted.current = true; return; }
    // The first frame's callbacks run before it paints; the second's after it has.
    let frame = requestAnimationFrame(() => { frame = requestAnimationFrame(() => { painted.current = true; }); });
    return () => cancelAnimationFrame(frame);
  }, [swapKey]);
  const measureTurn = (grid: HTMLElement): Before => ({ lead: leadIn(grid), first: still || !painted.current ? null : morph.measure(grid) });
  /** A turn measured as the handle let go, while the grid still stood at the height the finger held: the
   *  release's commit first sets the old height back (`follow(null)`) and the new one after. */
  const released = useRef<Before | null>(null);
  const takeTurn = (): Before | null => {
    const was = released.current;
    released.current = null;
    const grid = gridRef.current;
    return was ?? (grid ? measureTurn(grid) : null);
  };
  // A release measured for a turn its commit did not make is dropped with the hold it set on the grid.
  useLayoutEffect(() => {
    if (!released.current) return;
    released.current = null;
    gridRef.current?.removeAttribute(MORPHING_ATTR);
  });
  const leadTurn = ({ lead }: Before) => {
    const grid = gridRef.current;
    if (!grid) return;
    const cell = lead ? cellsOf(grid).find((el) => el.getAttribute(MORPH_PIECE_ATTR) === lead) : null;
    if (oneRow) grid.scrollLeft = cell ? leadAt(cell.offsetLeft) : 0;
    else grid.scrollTop = cell ? leadAt(cell.offsetTop) : 0;
  };
  const playTurn = ({ first }: Before) => { if (first) morph.play(first, 'shelf.layout.morph'); };
  const release = (dy: number) => {
    let next = keptGrid(settledGrid - dy / zoom);
    // Let go within the slack, the height keeps to the side of the turn the cards stand on, so they
    // stay as the finger left them.
    if (heldRow !== null) next = heldRow ? Math.min(next, turnAt - 1) : Math.max(next, turnAt);
    const grid = gridRef.current;
    if (grid && !carrying && (next < turnAt) !== oneRow) released.current = measureTurn(grid);
    askedGrid.emit(next);
  };
  /** A held handle's drag of `dy` visual px: the grid's box and the bar's band take the height at once,
   *  and React hears only that the hold began and ended. */
  const follow = (dy: number | null) => {
    if (dy === null) {
      // Back to the settled height, which a release's new height then replaces in React's commit.
      for (const el of [gridBoxRef.current, gridRef.current]) if (el) el.style.height = `${settledGrid}px`;
      followingNow.current = false;
      setFollowing(false);
      setHeldRow(null);
      return;
    }
    if (!followingNow.current) { followingNow.current = true; setFollowing(true); }
    // Moves before React has committed the hold write nothing, so the panel's size is claimed as it
    // stood before the hold.
    if (!following) return;
    const live = keptGrid(settledGrid - dy / zoom);
    for (const el of [gridBoxRef.current, gridRef.current]) if (el) el.style.height = `${live}px`;
    document.documentElement.style.setProperty(BAR_PANEL_DRAG_VAR, `${live - settledGrid}px`);
    // React hears the drag only where the cards turn: the commit re-arranges them at the live height
    // the writes above left, since the heights it renders have not changed.
    const row = shownRow.current ? live < turnAt + TURN_SLACK : live < turnAt - TURN_SLACK;
    if (!carrying && row !== shownRow.current) {
      shownRow.current = row;
      setHeldRow(row);
    }
  };
  /** A drag of `dy` visual px kept to what leaves the grid between its least and most. */
  const clampDrag = (dy: number) => Math.min((settledGrid - gridLeast) * zoom, Math.max((settledGrid - gridMost) * zoom, dy));
  const nameShown = (id: string, selected: boolean) => (reachedId ? reachedId === id : selected);
  const onReach = (id: string) => (at: unknown) => setReachedId((was) => (at ? id : was === id ? null : was));
  const cell = (key: string, name: string, shown: boolean, card: ReactNode) => (
    <div key={key} {...(preview ? {} : { [MORPH_PIECE_ATTR]: key })} style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: UPRIGHT_GRID.gap / 2, minWidth: 0 }}>
      {card}
      <span
        data-testid="shell-card-name"
        aria-hidden
        title={shown ? name : undefined}
        style={{
          display: 'block', width: '100%', height: nameH, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          textAlign: 'center', fontSize: TEXT.small, lineHeight: BAR_LINE_HEIGHT, fontWeight: weightAt(800, TEXT.small),
          color: ON_DARK, pointerEvents: 'none',
        }}
      >
        {shown ? name : ''}
      </span>
    </div>
  );
  // The folded card shows its name beside it, so it reports no reach.
  const quiet = () => {};

  return (
    <motion.div
      {...helpTargetAttr('objects')}
      {...mapEdgeAttr('bottom')}
      {...reveal}
      {...root}
      style={{
        ...root.style,
        display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: UPRIGHT_SPACE.row,
      }}
    >
      <PanelTone tone="dark">
        {/* Upright, the panel covers the map for any pointer, so it collapses for a mouse carry too. */}
        {carrying ? <CarryCancel style={{ paddingTop: UPRIGHT_SPACE.pad }} /> : null}
        {/* Out of flow and out of sight while carrying, never unmounted: unmounting the carried card ends its carry. */}
        <div style={carrying
          ? { position: 'absolute', left: 0, right: 0, top: 0, display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: UPRIGHT_SPACE.row, visibility: 'hidden' }
          : { display: 'contents' }}
        >
          {isFolded ? null : (
            <SeamHandle
              label={t('shelf.resize')}
              zoom={zoom}
              value={{ now: Math.round(gridMax), min: Math.round(gridLeast), max: Math.round(gridMost) }}
              clamp={clampDrag}
              onDrag={follow}
              onRelease={release}
              follows
              onStep={(direction) => askedGrid.emit(stepGrid(-direction * (cellH + UPRIGHT_GRID.gap) / 2))}
              plate="dark"
              testId="shell-shelf-handle"
              helpTarget={{ page: 'touch', anchor: 'touch-upright' }}
              // The head's row stands over the strip's foot and keeps its presses, so a fingertip's reach grows
              // from the grip up over the map past the panel's edge, closed where the panel stands drawn so
              // near its most that the top row is in that reach.
              reach={null}
              gripReach={{ bottom: false, top: gridMost - gridMax >= TOUCH_TARGET }}
              // The panel's column gap stands under it; the handle's own strip is the air over the head.
              style={{ position: 'relative', flex: 'none', marginBottom: -UPRIGHT_SPACE.row, zIndex: 1 }}
            />
          )}
          {isFolded ? (
            // The panel folded to the armed card: a press anywhere on it opens the panel again.
            <div data-testid="shell-shelf-folded" onClick={unfold} style={{ display: 'flex', alignItems: 'center', gap: EDGE, cursor: cursors.clickable }}>
              <ScaleProvider value={SHELF_SCALE * FOLDED_CARD}>
                {armedItem ? (
                  <ItemCard item={armedItem} placed={counts?.get(armedItem.id) ?? 0} selected onToggle={unfold} onReach={quiet}
                    carries={carries} onCarry={setCarrying} />
                ) : (
                  <SmartCard selected onToggle={unfold} onReach={quiet} />
                )}
              </ScaleProvider>
              <BarText size={TEXT.label} onMap>{armedItem ? localizedName(armedItem.name, locale) : t('smart.patch')}</BarText>
              {/* The brush button stands with the folded card, so Paint shows and opens without unfolding. */}
              {model.brushes ? (
                <span onClick={(e) => e.stopPropagation()} style={{ marginLeft: 'auto', display: 'flex' }}>
                  <ShelfBrushButton size={TOUCH_TARGET} paints={model.paints} />
                </span>
              ) : null}
            </div>
          ) : (
            <>
              {model.sourced ? null : (
                <div style={{ position: 'relative', zIndex: 1, display: 'flex', alignItems: 'center', minHeight: UPRIGHT_HEAD_H }}>
                  {/* The names stay under the open field, out of reach, so closing it shows them where they were;
                      they fade as the field grows over the whole row and return as it shrinks. */}
                  <div {...under.attrs} style={{ flex: '1 1 auto', minWidth: 0, display: 'flex', marginRight: 2 * (TOUCH_TARGET + UPRIGHT_GRID.gap), ...under.style }}>
                    <ShelfCategoryTabs model={model} />
                  </div>
                  {/* Beside the search button, giving way to the open field as the names do (EDIT-64). */}
                  {model.brushes ? <div
                    {...under.attrs}
                    style={{
                      position: 'absolute', right: TOUCH_TARGET + UPRIGHT_GRID.gap, top: '50%', marginTop: -(TOUCH_TARGET + TAB_MARK_DEPTH) / 2,
                      display: 'flex', ...under.style,
                    }}
                  >
                    <ShelfBrushButton size={TOUCH_TARGET} paints={model.paints} />
                  </div> : null}
                  {/* Level with the names rather than with the names and their marks. */}
                  <ShelfSearchPill size={TOUCH_TARGET} open={searchOpen} onOpenChange={setSearchOpen} query={query}
                    setQuery={model.setQuery} reduced={reduced} style={{ top: '50%', marginTop: -(TOUCH_TARGET + TAB_MARK_DEPTH) / 2 }} />
                </div>
              )}
              {/* One box as tall whatever the category holds, so a switch neither moves the panel nor lets the
                  arriving grid travel past its edge. */}
              {items.length === 0 ? <NoMatch model={model} style={{ height: gridMax }} /> : (
                <div ref={gridBoxRef} style={{ display: 'flex', flexDirection: 'column', height: gridMax, ...swap.clip }}>
                  <MorphOnChange<Before> key={swapKey} change={arrangement} measure={takeTurn} committed={leadTurn} play={playTurn}>
                    <motion.div
                      ref={gridRef}
                      key={swapKey}
                      data-testid="shell-shelf-grid"
                      data-arrangement={arrangement}
                      className="pw-noscroll"
                      initial={{ opacity: 0, x: CARD_ARRIVE_X }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={swapMotion}
                      onAnimationComplete={swap.settle}
                      style={{
                        position: 'relative', display: 'grid', gap: UPRIGHT_GRID.gap, height: gridMax, overscrollBehavior: 'contain',
                        ...(oneRow
                          ? { gridAutoFlow: 'column', gridAutoColumns: columnW, alignContent: 'center', overflowX: 'auto', overflowY: 'hidden' }
                          : { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, alignContent: 'start', overflowY: 'auto', overflowX: 'hidden' }),
                        ...gridFade,
                      }}
                    >
                      <ScaleProvider value={scale * cardFit}>
                        {patch ? cell(PATCH, t('smart.patch'), nameShown(PATCH, patch.selected),
                          <SmartCard selected={patch.selected} onToggle={togglePatch} onReach={onReach(PATCH)} />) : null}
                        {items.map((item) => {
                          const selected = isSelected(item.id);
                          return cell(item.id, localizedName(item.name, locale), nameShown(item.id, selected),
                            <ItemCard item={item} placed={counts?.get(item.id) ?? 0} selected={selected}
                              onToggle={(multi) => toggleItem(item.id, multi)} onReach={onReach(item.id)} carries={carries} pan={oneRow ? 'x' : 'y'} onCarry={setCarrying} />);
                        })}
                      </ScaleProvider>
                    </motion.div>
                  </MorphOnChange>
                </div>
              )}
            </>
          )}
        </div>
      </PanelTone>
    </motion.div>
  );
}
