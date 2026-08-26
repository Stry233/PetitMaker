/**
 * The panel the layer count opens, at both of the sizes it opens at.
 *
 * What is worth pinning is not the plate: it is that the panel is a VIEW of the map rather than a
 * copy of it. Every row's figure is the cumulative count the rest of the app derives, an empty
 * floor is still a floor and keeps its row, the eye and the lock write straight through to the
 * store the map reads, and a paint refused by a locked layer says which layer refused it, where
 * the cell that was refused is off-screen.
 *
 * The SIZE ladder is the second subject. Three sizes are one control, so what has to hold is that
 * the arrows walk between them and stop at both ends, that the same nine floors are listed in every
 * one of them (which is what lets a floor travel rather than be redrawn), and that a press on the
 * count lands on the size THIS WINDOW can hold rather than on a size somebody preferred once.
 */
// @ts-ignore - node:fs is untyped here (no @types/node)
import { readFileSync } from 'node:fs';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { EventBus } from '../../../core/commands/event-bus';
import { ELEVATION_MAX } from '../../../core/model/constants';
import { bumpCellsVersion } from '../../../core/model/grid-model';
import { CellZone, CommandType, TerrainType, type Command, type EditorEvents, type GridState } from '../../../core/model/types';
import { I18nProvider } from '../../../i18n/context';
import { useEditorStore } from '../../../state/store';
import { LAYER_MODES, planRail, railStack, RAIL_TOP, stepLayerMode } from '../../../ui/shell/frame';
import { plateDepth, PLATE_DEPTH } from '../../../ui/shell/windows/LayerPanel';
import { Rail } from '../../../ui/shell/Rail';
import { ACTIVE, INK, MAP_EDGE_ALPHA } from '../../../ui/design/tokens';
import { EDGE_RIGHT, RAIL, ZOOM } from '../../../ui/shell/units';
import { frameFit } from '../../../ui/design/scale';
import { makeState, setTerrain, setZone } from '../../rules/_helpers';

/** A map with a shape to it: a broad first floor, a narrower second, one cell on the third. */
function stepped(): GridState {
  const state = makeState();
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) setTerrain(state, x, y, TerrainType.Mountain, 1);
  for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) setTerrain(state, x, y, TerrainType.Mountain, 2);
  setTerrain(state, 0, 0, TerrainType.Mountain, 3);
  return state;
}

function mount() {
  return render(<I18nProvider><Rail hidden={false} onHide={() => {}} /></I18nProvider>);
}

/** Mount on a window of a given height. The column is planned against it, so which arrangement the
 *  rail is in is a fact about the window and has to be stated before anything is rendered. */
function mountAt(windowHeight: number) {
  window.innerHeight = windowHeight;
  return mount();
}

/** The zoom the live Rail runs under: the authored zoom times the window's fit (jsdom's window is
 *  below the design reference, so the fit is in force here). */
const zoomAt = (windowHeight: number) => ZOOM * frameFit(window.innerWidth, windowHeight);

/** The column's plan for that window, which is what the rail is reading. `mode` is the size the
 *  layer control is in, since the plate's own depth is one of the plan's inputs. */
function planAt(windowHeight: number, open: boolean, mode: 'column' | 'grid' = 'grid') {
  return planRail(windowHeight / zoomAt(windowHeight), { open, plateDepth: plateDepth(open ? mode : 'pill') });
}

const topOf = (el: HTMLElement) => parseFloat(el.style.top);

/** Open the panel the way a visitor does: by pressing the count. */
function openPanel(): void {
  fireEvent.click(screen.getByTestId('shell-layer-readout').parentElement!);
}

/** How many floors the panel is drawing on one row, read off the grid the tiles stand in. */
function columnsShown(): number {
  const grid = screen.getByTestId('shell-layer-row-0').closest('[style*="grid-template-columns"]') as HTMLElement;
  return Number(/repeat\((\d+)/.exec(grid.style.gridTemplateColumns)![1]);
}

/** Walk one rung of the size ladder, the way a visitor does. */
function press(dir: 'smaller' | 'bigger'): void {
  fireEvent.click(screen.getByTestId(`shell-layer-${dir}`));
}

/** Put the panel away the way a visitor does: the left arrow, until the pill is back. */
function closePanel(): void {
  for (let i = 0; i < LAYER_MODES.length && !screen.queryByTestId('shell-layer-readout'); i++) press('smaller');
}

const count = (elev: number) => screen.getByTestId(`shell-layer-count-${elev}`).textContent;

/** The two chevrons, by the path each is drawn with (`ui/shell/glyph-icons`), so a test can say
 *  which way a mark points rather than which component was reached for. */
const CHEVRON = { left: 'M15 5l-7 7 7 7', right: 'M9 5l7 7-7 7' } as const;

/** How far the floor's bar is filled. The fill carries a pixel floor under the share so that a
 *  handful of cells is still visible; that minimum is a legibility rule, not the reading, so what
 *  is read back here is the share itself. */
function width(elev: number): string {
  const w = screen.getByTestId(`shell-layer-bar-${elev}`).style.width;
  return /([\d.]+%)/.exec(w)?.[1] ?? w;
}

beforeEach(() => {
  // The window the interface is judged on, unless a test says otherwise: the arrangement of the
  // column is a fact about the window, so leaving one test's height standing would decide the next.
  window.innerHeight = 900;
  useEditorStore.setState({
    locale: 'en',
    eventBus: new EventBus<EditorEvents>(),
    gridState: stepped(),
    activeLayer: 2,
    displayLayer: null,
    layerVisibility: {},
    layerLocked: {},
  });
});
afterEach(cleanup);

describe('the layer panel', () => {
  /**
   * It REPLACES the count and it STAYS. The count is what opens it and the left arrow at its head
   * is what walks back to it; while it is up the collapsed pair is not also there, since the panel
   * says which floor is active and every floor in it is pressable.
   *
   * Nothing else closes it: not a click on the map, not Escape. A stack you work against is a thing
   * to leave up beside the map, and one that vanished when the pointer went to the map would be
   * unusable exactly while it was being used.
   */
  it('replaces the count, and only the arrow in it walks back', async () => {
    mount();
    expect(screen.queryByTestId('shell-layer-panel'), 'the interface is at rest').toBeNull();
    const opener = screen.getByTestId('shell-layer-readout').parentElement!;
    expect(opener.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(opener);
    expect(screen.getByTestId('shell-layer-panel')).toBeTruthy();
    expect(screen.queryByTestId('shell-layer-readout'), 'the collapsed count is gone').toBeNull();
    expect(screen.queryByLabelText('Raise the build layer')).toBeNull();

    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.pointerDown(document.body);
    fireEvent.click(document.body);
    expect(screen.getByTestId('shell-layer-panel'), 'still up').toBeTruthy();

    // It has to LOOK like the way out or it is not one: a heading nobody presses is how the panel
    // came to have no way back at all. The arrow inherits exactly what the count wore for that
    // reason — the same filled pill every in-force control here wears, carrying a mark.
    //
    // THE WAY BACK IS THE RIGHT-HAND ARROW, and that is a fact about where the panel is rather than
    // about the ladder's index. The plate hangs off the window's right edge and grows leftward, so
    // the arrow pointing into the map opens it and the arrow pointing at the edge puts it away. The
    // inheritance follows the way back and not a position, so it moved with it.
    const back = screen.getByTestId('shell-layer-smaller');
    const out = screen.getByTestId('shell-layer-bigger');
    const filled = document.createElement('div');
    filled.style.background = ACTIVE;
    expect(back.style.background, 'the way back is a plate, not type').toBe(filled.style.background);
    expect(back.querySelector('svg'), 'and it carries a mark saying which way it goes').toBeTruthy();
    expect(out.compareDocumentPosition(back) & Node.DOCUMENT_POSITION_FOLLOWING,
      'and it stands to the right of the way on').toBeTruthy();
    // The marks point the way the PLATE travels, which is the whole of the correction: a chevron
    // pointing away from what it does is worse than no chevron.
    expect(back.querySelector('path')!.getAttribute('d'), 'back points at the window\'s edge')
      .toBe(CHEVRON.right);
    expect(out.querySelector('path')!.getAttribute('d'), 'and on points into the map')
      .toBe(CHEVRON.left);

    closePanel();
    // The panel leaves under AnimatePresence, so it is still mounted for the length of its exit.
    await waitFor(() => expect(screen.queryByTestId('shell-layer-panel')).toBeNull());
    expect(screen.getByTestId('shell-layer-readout')).toBeTruthy();
  });

  /**
   * THE HEAD DOES NOT NAME THE ACTIVE FLOOR, because the plate marks that floor on the floor's own
   * tile. A head that named it too would be the one thing on the plate said twice, from two
   * derivations that can disagree.
   *
   * What the word carries is FINDABILITY, so the arrow inherits that instead: the plate, the corner,
   * the size. The absence and the inheritance are held together here, since the absence on its own
   * takes the findability with it.
   */
  it('does not repeat the active floor in its head, and hands the way back the pill it wore', () => {
    useEditorStore.setState({ activeLayer: 3 });
    mount();
    openPanel();
    const head = screen.getByTestId('shell-layer-smaller').parentElement!.parentElement!;
    expect(head.textContent, 'the head says no floor name at all').not.toContain('Layer 3');
    expect(screen.getByTestId('shell-layer-row-3').getAttribute('aria-pressed'), 'the tile says it')
      .toBe('true');
    // Both arrows are the same object at the same size, so neither reads as the lesser one.
    const smaller = screen.getByTestId('shell-layer-smaller');
    const bigger = screen.getByTestId('shell-layer-bigger');
    expect(bigger.style.background).toBe(smaller.style.background);
    expect(bigger.style.padding).toBe(smaller.style.padding);
    expect(bigger.style.borderRadius).toBe(smaller.style.borderRadius);
  });

  /**
   * THE LADDER HAS A BOTTOM AND A TOP AND NEITHER WRAPS.
   *
   * Three sizes with two arrows is a ladder, not a cycle: a cycle would put the pill one press past
   * the square, so a person reaching for more of the stack would lose the panel instead. Each end
   * therefore SPENDS its arrow, the way the pill's own two steps spend themselves at the ends of the
   * stack, and the spent arrow stays on the plate so the ladder always shows both directions.
   */
  it('walks the three sizes with the two arrows, and stops at both ends', async () => {
    mountAt(1440);
    openPanel();
    expect(columnsShown(), 'the count opens the file, which is the rung above the pill').toBe(1);
    expect((screen.getByTestId('shell-layer-bigger') as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByTestId('shell-layer-smaller') as HTMLButtonElement).disabled).toBe(false);

    press('bigger');
    expect(columnsShown(), 'and the arrow into the map steps up to the square').toBe(3);
    expect((screen.getByTestId('shell-layer-bigger') as HTMLButtonElement).disabled, 'nothing bigger')
      .toBe(true);

    press('smaller');
    expect(columnsShown(), 'and back down again').toBe(1);

    // Down the whole ladder: the pill is the bottom rung, so the arrow that has been walking down
    // reaches it rather than stopping one short.
    closePanel();
    await waitFor(() => expect(screen.queryByTestId('shell-layer-panel')).toBeNull());
    expect(screen.getByTestId('shell-layer-readout')).toBeTruthy();
  });

  /** The ladder itself, without a window around it: it is the one place the order of the three
   *  sizes is written, and clamping at both ends is what the arrows read off it. */
  it('orders the three sizes smallest first and clamps the ladder at both ends', () => {
    expect([...LAYER_MODES]).toEqual(['pill', 'column', 'grid']);
    expect(stepLayerMode('pill', -1), 'nothing smaller than the pill').toBe('pill');
    expect(stepLayerMode('pill', 1)).toBe('column');
    expect(stepLayerMode('column', 1)).toBe('grid');
    expect(stepLayerMode('grid', 1), 'nothing bigger than the square').toBe('grid');
    expect(stepLayerMode('grid', -1)).toBe('column');
  });

  /**
   * OPENING IS ONE STEP OF THE LADDER, AT EVERY WINDOW.
   *
   * The three sizes are one control, so the way in is the way the arrows go: pill, file, square.
   * A press that landed on whichever of the two the window had room for would make the one press
   * give two different panels: the middle rung skipped on a tall monitor and the only rung on a
   * laptop, with the file reachable only by stepping back DOWN to it.
   *
   * What the window does decide is where the plate STANDS once it is open (`planRail`), which is a
   * different question and is held below.
   */
  it('opens the same size at every window, one step up the ladder', () => {
    for (const h of [720, 900, 1440]) {
      mountAt(h);
      openPanel();
      expect(columnsShown(), `${h}px opens the file`).toBe(1);
      // And the square is one press away from there, at every one of them: it is a size, not a
      // capability the window grants.
      press('bigger');
      expect(columnsShown(), `${h}px`).toBe(3);
      cleanup();
    }
  });

  /**
   * A TILE'S LAYOUT IS A FACT ABOUT ITS SIZE, AND THE TWO SIZES ARE SHORT OF DIFFERENT THINGS.
   *
   * The file's floors stand one above another, so what a tile costs in depth it costs nine times
   * over, and it has width the square does not need: its name, count and toggles share ONE line.
   * The square is three floors deep whatever the tile costs and has no width to spare, so it keeps
   * the roomier three-line tile the panel was drawn with. Giving both the file's crowded line took
   * the square from 417 css px wide to 622, which is a third of the island behind an opaque plate
   * to save a size that was not short of depth.
   *
   * The bar has its own line at BOTH sizes. It is the one thing on a tile that is a picture of a
   * quantity rather than a statement of one, and squeezed into what a row of words leaves over it
   * would be too short to compare with the floor above it.
   */
  it('gives the file one line of words and the square three lines', () => {
    mount();
    openPanel();
    const line = () => screen.getByTestId('shell-layer-line-2');
    expect(line().textContent, 'the file names the floor on its one line').toContain('Layer 2');
    for (const id of ['shell-layer-count-2', 'shell-layer-eye-2', 'shell-layer-lock-2']) {
      expect(line().contains(screen.getByTestId(id)), `the file's line carries ${id}`).toBe(true);
    }
    const bar = () => screen.getByTestId('shell-layer-bar-2');
    expect(line().contains(bar()), 'and not the bar').toBe(false);
    // Two, and no more: the tile's content column is the line and the bar's track.
    expect(line().parentElement!.childElementCount, 'so the file\'s tile is two rows').toBe(2);

    press('bigger');
    expect(line().textContent, 'the square names the floor on a line of its own').toContain('Layer 2');
    for (const id of ['shell-layer-count-2', 'shell-layer-eye-2', 'shell-layer-lock-2']) {
      expect(line().contains(screen.getByTestId(id)), `the square keeps ${id} off it`).toBe(false);
    }
    const content = line().parentElement!;
    expect(content.childElementCount, 'so the square\'s tile is three rows').toBe(3);
    const figures = content.children[1]!;
    for (const id of ['shell-layer-count-2', 'shell-layer-eye-2', 'shell-layer-lock-2']) {
      expect(figures.contains(screen.getByTestId(id)), `on the second line: ${id}`).toBe(true);
    }
    expect(content.lastElementChild!.contains(bar())).toBe(true);
  });

  /**
   * THE FILE IS SHORT AND IT SCROLLS, AND THAT IS ITS ORDINARY STATE.
   *
   * It draws five of the nine floors. Showing all of them made the LOWER rung of the ladder the
   * DEEPER of the two plates — 470 css px against the square's 323 — so stepping up shrank the
   * panel, and a plate that deep is in the column's lane on no window at all. What it is bounded by
   * is the square, the size one press above it: as many whole floors as stand inside that depth.
   *
   * Both sides are declared numbers, so this is arithmetic rather than a measurement and can be
   * held here rather than in a browser.
   */
  it('draws the file shorter than the square, and scrolls the rest of the stack', () => {
    expect(plateDepth('column')).toBeLessThan(PLATE_DEPTH);
    mount();
    openPanel();
    const floors = screen.getByTestId('shell-layer-floors');
    expect(floors.childElementCount, 'every floor is IN it, whether or not it is showing')
      .toBe(ELEVATION_MAX + 1);
    expect(floors.style.overflowY).toBe('auto');
  });

  /**
   * AND WHERE THE LANE CANNOT GIVE EVEN THAT, THE HEIGHT FOLLOWS THE ROOM. The plate draws at its
   * own depth or at what the column can hand it, whichever is less: the lane is the harder bound,
   * since a plate that ran past it would stand on the bottom shelf or over the buttons.
   */
  it('takes the room the lane can give when that is less than its own depth', () => {
    // 336 device px sits in the fit floor's region, where the frame stops shrinking with the
    // window and the lane genuinely runs out of room.
    for (const [h, mode] of [[336, 'column'], [1440, 'column'], [1440, 'grid']] as const) {
      const room = planAt(h, true, mode).plateMaxH;
      const drawn = Math.min(plateDepth(mode), room);
      expect(drawn, `${h}px, ${mode}`).toBeCloseTo(h === 336 ? room : plateDepth(mode), 6);
    }
    // The short window is the one where the bound bites, and it bites on the LANE rather than on
    // the size: at 336 device px the column has less to give than five floors take.
    expect(planAt(336, true, 'column').plateMaxH).toBeLessThan(plateDepth('column'));
  });

  /**
   * ONE CONTROL AT EITHER END OF THE HEAD, AT ONE SIZE.
   *
   * The head carries two unrelated things: what the MAP shows (the layer numbers over the island)
   * and what size THIS PANEL is. So they take opposite ends rather than standing together at one
   * with the rest of the plate empty beside them, and the panel's own pair goes to the right, which
   * is the end the plate hangs off and the end the way back walks toward.
   *
   * And they are drawn in the same box. Two controls at the two ends of one row read as a pair
   * whatever they do, so one of them at its own size reads as the lesser of the two.
   */
  it('stands the numbers toggle and the size arrows at opposite ends, at one size', () => {
    mount();
    openPanel();
    const numbers = screen.getByTestId('shell-layer-numbers');
    const arrows = screen.getByTestId('shell-layer-bigger').parentElement!;
    const head = screen.getByTestId('shell-layer-head');
    expect(head.style.justifyContent, 'the two ends of the head').toBe('space-between');
    expect(numbers.compareDocumentPosition(arrows) & Node.DOCUMENT_POSITION_FOLLOWING,
      'the numbers toggle first, the arrows after it').toBeTruthy();
    // The same drawn box as an arrow: the pill's padding, its height and its rounding — and its
    // WIDTH, which the `#` holds as a minimum because the glyph in it is narrower than a chevron.
    const arrow = screen.getByTestId('shell-layer-bigger');
    for (const prop of ['padding', 'height', 'boxSizing', 'borderRadius'] as const) {
      expect(numbers.style[prop], prop).toBe(arrow.style[prop]);
    }
    expect(numbers.style.minWidth, 'as wide as a chevron\'s own box')
      .toBe(`${arrow.querySelector('svg')!.getAttribute('width')}px`);
  });

  /**
   * A SHAPE CHANGES SHAPE; WHAT IS WRITTEN ON IT ONLY MOVES.
   *
   * Framer projects a layout animation as a SCALE on the box, and every child inherits it, so a
   * plate whose contents are plain elements stretches its words and its icons between the two sizes
   * like a bitmap being resized — on both axes, since the two sizes differ in width and in depth.
   * The answer is the standard nesting: a box whose shape changes carries `layout`, and the content
   * standing in it carries `layout="position"`, which corrects the inherited scale and leaves the
   * child travelling.
   *
   * jsdom lays nothing out, so a rendered assertion cannot see a projection at all. What is held
   * here is the RULE in the source: the tile's content is declared once (`carried`) as position-only
   * and every piece of it is spread from that, so a new line on a tile cannot quietly be added as a
   * plain element. The frame itself was checked in a browser, mid-flight.
   */
  it('carries the tile\'s content position-only, so the resize cannot stretch it', () => {
    const src = readFileSync('src/ui/shell/windows/LayerPanel.tsx', 'utf8');
    expect(src, 'the tile declares its content\'s projection once')
      .toContain("const carried = { ...shape, layout: 'position' as const }");
    // The three pieces of a tile's words, and the head's two controls.
    expect(src.match(/\{\.\.\.carried\}/g) ?? [], 'every piece of a tile\'s words takes it')
      .toHaveLength(3);
    // On its own line, which is how a prop is written here and how a mention of one in the prose
    // above is not.
    expect(src.match(/^\s*layout="position"$/gm) ?? [], 'and both head controls').toHaveLength(2);
  });

  /**
   * THE HEAD STAYS PUT WHILE THE FLOORS MOVE. It carries the two size arrows and the layer-numbers
   * toggle, which are the panel's own controls rather than part of the stack: a control that leaves
   * the plate as the visitor reads down it is a control they have to scroll back for.
   *
   * It is not sticky. A sticky element's offsets are measured from the scrollport's own edge, so it
   * would pin over the plate's padding and ride its rounded corner, and it would still sit inside
   * the box whose scroll the size travel projects through. So the plate is a column of two and only
   * the second one scrolls, which is what this holds.
   */
  it('keeps its head on the plate while the floors scroll under it', () => {
    mountAt(720);
    openPanel();
    const floors = screen.getByTestId('shell-layer-floors');
    const head = screen.getByTestId('shell-layer-head');
    expect(floors.contains(head), 'the head is outside the box that scrolls').toBe(false);
    expect(head.contains(screen.getByTestId('shell-layer-smaller'))).toBe(true);
    expect(head.contains(screen.getByTestId('shell-layer-numbers'))).toBe(true);
    expect(floors.contains(screen.getByTestId('shell-layer-row-0')), 'and every floor is inside it')
      .toBe(true);
    expect(floors.style.overflowY).toBe('auto');
    expect(screen.getByTestId('shell-layer-panel').style.overflow, 'the plate itself does not scroll')
      .toBe('hidden');
  });

  /**
   * A BAR ONLY WHERE THERE IS SOMETHING TO SCROLL TO. A scrollbar on a stack that is all showing
   * says there is more below when there is not, and it takes a lane out of the tiles for nothing.
   * The panel knows which it is before it draws: both the depth and the room are declared.
   *
   * Which is now a difference between the two SIZES rather than between two windows. The file draws
   * five floors of nine, so it has something to scroll to at every window; the square shows the
   * whole stack, so it has one only where the lane cannot hand it its 323.
   */
  it('wears a scrollbar on the size that scrolls and not on the one that does not', () => {
    mountAt(900);
    openPanel();
    expect(columnsShown()).toBe(1);
    expect(screen.getByTestId('shell-layer-floors').classList.contains('pw-noscroll'), 'the file')
      .toBe(false);

    press('bigger');
    expect(screen.getByTestId('shell-layer-floors').classList.contains('pw-noscroll'), 'the square')
      .toBe(true);
  });

  /**
   * The floors wear the same soft edge every scroller in the shell does
   * (`ui/primitives/scroll-fade.ts`). It coexists with the Framer `layout`/`layoutScroll` props on
   * the same box: a mask is not a transform, so it never fights the size-change projection. jsdom
   * lays nothing out, so what is worth pinning is that the box's own scroll metrics decide the
   * mask. The mask now arrives and leaves over a settle loop rather than popping, so this reads it
   * back with `waitFor` against the real `requestAnimationFrame` instead of synchronously against
   * the triggering scroll event.
   */
  it('fades the floors only where scroll metrics say there is room', async () => {
    mount();
    openPanel();
    const floors = screen.getByTestId('shell-layer-floors');
    expect(floors.style.maskImage).toBe('');

    Object.defineProperty(floors, 'scrollHeight', { value: 900, configurable: true });
    Object.defineProperty(floors, 'clientHeight', { value: 400, configurable: true });
    Object.defineProperty(floors, 'scrollTop', { value: 50, configurable: true });
    fireEvent.scroll(floors);
    await waitFor(() => {
      expect(floors.style.maskImage).toContain('linear-gradient(to bottom,');
      expect(floors.style.maskImage).toContain('transparent 0');
      expect(floors.style.maskImage).toContain('transparent 100%');
    });

    Object.defineProperty(floors, 'scrollHeight', { value: 400, configurable: true });
    Object.defineProperty(floors, 'scrollTop', { value: 0, configurable: true });
    fireEvent.scroll(floors);
    await waitFor(() => expect(floors.style.maskImage).toBe(''));
  });

  /**
   * IT MEETS THE MAP WITH A HAIRLINE, NOT A SHADOW. Nothing in this frame casts one — the design
   * source has no layer effect in it, and `frame-margins.test.ts` fails the build on a shadow
   * written anywhere under `ui/shell`. What a cream plate standing on the island still needs is one
   * dark pixel between it and whatever is under it, which is the same thing a word gets from
   * `MAP_LABEL` and a drawing from `MAP_SHAPE_EDGE`: the same ink at the same alpha, drawn as a
   * plain border because a panel is a rectangle rather than a silhouette.
   */
  /**
   * THE PLATE RE-CLAIMS THE POINTER. It stands in a carrier that is deaf on purpose (the air
   * between rail buttons lets the map through), and a deaf plate hands every press and wheel in
   * its box to the canvas underneath — the head's buttons dead, the floors unscrollable, with only
   * the toggles' own re-claims still answering.
   */
  it('re-claims pointer events from its deaf carrier', () => {
    mount();
    openPanel();
    expect(screen.getByTestId('shell-layer-panel').style.pointerEvents).toBe('auto');
  });

  it('stands on the island behind a hairline rather than a shadow', () => {
    mount();
    openPanel();
    const plate = screen.getByTestId('shell-layer-panel');
    expect(plate.style.boxShadow, 'no shadow').toBe('');
    expect(plate.style.borderStyle).toBe('solid');
    expect(parseFloat(plate.style.borderWidth)).toBeGreaterThan(0);
    expect(parseFloat(plate.style.borderWidth), 'a hairline, not a keyline').toBeLessThanOrEqual(1);
    // The ink is the one every edge on the map is drawn in, at the alpha that makes it the shape's
    // own shading rather than a line somebody drew around it. Read back as channels, since the
    // colour is authored as one hex string and reported as another notation.
    const rgb = [1, 3, 5].map((i) => parseInt(INK.slice(i, i + 2), 16));
    expect(plate.style.borderColor).toBe(`rgba(${rgb.join(', ')}, ${MAP_EDGE_ALPHA})`);
  });

  /**
   * THE SAME NINE FLOORS, IN BOTH SIZES. A floor TRAVELS from the row it was on to the row it is now
   * on (`layout`), which needs it to be the same element in both arrangements — a plate redrawn with
   * nine new tiles has nothing to travel. jsdom lays nothing out, so what a DOM test can hold is
   * that structure: every floor is listed in both sizes, and nothing else is.
   */
  it('lists the same nine floors in both sizes, so a floor can travel between them', () => {
    const listed = () => [...document.querySelectorAll('[data-testid^="shell-layer-row-"]')]
      .map((el) => Number(el.getAttribute('data-testid')!.replace('shell-layer-row-', '')));
    mountAt(1440);
    openPanel();
    const square = listed();
    expect(square).toHaveLength(ELEVATION_MAX + 1);

    press('smaller');
    const file = listed();
    expect([...file].sort((a, b) => a - b), 'the file holds the same floors')
      .toEqual([...square].sort((a, b) => a - b));
  });

  /**
   * The rows are memoized and the grid is mutated IN PLACE, so nothing about `gridState` changes
   * when a map is generated; the panel's own subscription is what reports it, and that runs only
   * while it is open. Generating with the panel CLOSED therefore has to be picked up by opening it,
   * or the panel reads whatever the map held when the component mounted — one Ground row at zero,
   * which is what a whole generated island was being reported as.
   */
  it('reads the map as it is on opening, not as it was when the rail mounted', () => {
    useEditorStore.setState({ gridState: makeState(), activeLayer: 0 });
    mount();
    openPanel();
    expect(count(0)).toBe('0');
    closePanel();

    // A map built while the panel was away.
    useEditorStore.setState({ gridState: stepped() });
    openPanel();
    expect(count(1)).toBe('16');
    expect(count(2)).toBe('4');
  });

  it('counts a floor cumulatively', () => {
    mount();
    openPanel();
    // 4x4 at layer 1 with a 2x2 second storey and one cell on the third: the block on layer 3
    // counts on 1 and 2 as well. Nothing in the panel says so in words, so the figures are the
    // only place that fact is visible and the only place to hold it.
    expect(count(1)).toBe('16');
    expect(count(2)).toBe('4');
    expect(count(3)).toBe('1');
  });

  /**
   * THE WHOLE STACK, ALWAYS. The floors a map can hold is a fact about the map and not about what
   * has been built yet, so every one of them is listed whatever the terrain reaches: a panel that
   * grew a tile as the visitor built moved the tiles under their pointer.
   */
  it('lists every floor the map can hold, occupied or not', () => {
    mount();
    openPanel();
    for (let e = 0; e <= ELEVATION_MAX; e++) expect(screen.getByTestId(`shell-layer-row-${e}`), `floor ${e}`).toBeTruthy();
    expect(screen.queryByTestId(`shell-layer-row-${ELEVATION_MAX + 1}`), 'and no more than it can').toBeNull();
    expect(count(0), 'nothing stands on the ground of this map').toBe('0');
    expect(count(ELEVATION_MAX), 'nor anywhere near the top of it').toBe('0');
  });

  /**
   * WHERE THE LANE CAN HOLD IT, IT STANDS ON THE RAIL'S OWN LINE. The plate's right edge is the
   * round buttons' right edge, so the two square up down the window rather than the plate stopping a
   * button's width short of the lane, which reads as a misalignment.
   *
   * That puts it ACROSS the lane, so the pair below moves: the two facts are one decision and are
   * asserted together. The pair drops to the lowest the column allows and the plate takes the room
   * it left, which on this window is the whole plate with a group's separation to spare.
   */
  it('keeps the buttons\' own line where the lane can hold it, and the pair steps down under it', () => {
    const open = planAt(1152, true);
    expect(open.plateInLane, 'a 1152 window has the room').toBe(true);
    mountAt(1152);
    const pair = screen.getByTestId('shell-rail-history');
    const resting = topOf(pair);
    expect(resting).toBeCloseTo(planAt(1152, false).historyTop, 6);

    openPanel();
    // The square, since it is the size these numbers are the plan's for; the count opens the file,
    // which is the rung below it.
    press('bigger');
    const inset = parseFloat(screen.getByTestId('shell-layer-panel').style.right);
    expect(inset, 'flush with the buttons, not clear of their lane').toBeCloseTo(EDGE_RIGHT, 6);
    expect(topOf(pair), 'and the pair has stepped down out of the plate').toBeCloseTo(open.historyTop, 6);
    expect(topOf(pair)).toBeGreaterThan(resting);
    // Under the whole plate, not merely lower: the point of the step is that nothing is covered.
    expect(topOf(pair)).toBeGreaterThanOrEqual(RAIL_TOP + PLATE_DEPTH + RAIL.groupMin);

    closePanel();
    expect(topOf(pair), 'and back when it closes').toBeCloseTo(resting, 6);
  });

  /**
   * AND WHERE NO ARRANGEMENT CAN, THE PLATE MOVES RATHER THAN THE COLUMN. The column will fold a
   * group to seat the plate, but a fold that would still leave it out over the map buys nothing, so
   * where the ladder does not reach, the plate steps one file of buttons plus a group's separation
   * out of the lane and the column is left exactly as it was.
   *
   * It is the plate that gives because it is the thing that just arrived. Standing it over the
   * column instead leaves six controls behind an opaque plate, which is what this replaced; moving
   * the column sideways instead would take eight buttons the width of the whole plate across the
   * map to save one from moving 62 px.
   *
   * The FILE is what is read back here at both windows, since it is the size the count opens and
   * neither window seats it. The square is deeper still, so it steps aside at both too.
   */
  it('steps out of the lane where no fold would seat the plate, and leaves the column alone', () => {
    for (const h of [432, 720]) {
      const open = planAt(h, true, 'column');
      expect(open.plateInLane, `${h}px cannot hold the file in the lane`).toBe(false);
      mountAt(h);
      const pair = screen.getByTestId('shell-rail-history');
      const resting = planAt(h, false, 'column').historyTop;
      expect(topOf(pair), `${h}px, at rest`).toBeCloseTo(resting, 6);

      openPanel();
      expect(columnsShown(), `${h}px, at the file`).toBe(1);
      const inset = parseFloat(screen.getByTestId('shell-layer-panel').style.right);
      // Clear of the widest thing standing in the lane on this window, by a group's separation. The
      // kit runs in two files on a short one, so the step is not a constant.
      expect(inset, `${h}px`).toBeCloseTo(EDGE_RIGHT + railStack(open.kitFiles) + RAIL.groupMin, 6);
      expect(inset).toBeGreaterThanOrEqual(EDGE_RIGHT + RAIL.button + RAIL.groupMin);
      expect(topOf(pair), `${h}px, the pair has no reason to move`).toBeCloseTo(resting, 6);
      // And it is standing where the pair stands, not where the plate would have pushed it: the
      // plate is over no part of the lane, so there is nothing to step out of.
      const pairH = railStack(Math.ceil(2 / open.historyFiles));
      expect(topOf(pair) + pairH, `${h}px, still above the kit`).toBeLessThanOrEqual(open.kitTop);
      cleanup();
    }
  });

  /**
   * A SQUARE, READ UPWARD. Nine floors over the ground are three rows of three, and the rows are
   * filled from the ground up: every floor in the DOM's first row stands above every floor in the
   * one after it, which is what keeps "higher is up" true of a wrapped list, and each row itself
   * ascends left to right. The panel draws the rows in that order, so the plate's bottom row is the
   * bottom of the stack.
   */
  it('lays the stack out as a square, upper rows first', () => {
    // One press past the file, which is what the count opens at every window.
    mountAt(1440);
    openPanel();
    press('bigger');
    const listed = [...document.querySelectorAll('[data-testid^="shell-layer-row-"]')]
      .map((el) => Number(el.getAttribute('data-testid')!.replace('shell-layer-row-', '')));
    const cols = Math.ceil(Math.sqrt(ELEVATION_MAX + 1));
    expect(cols, 'nine floors over the ground make three rows of three').toBe(3);

    const bands: number[][] = [];
    for (let i = 0; i < listed.length; i += cols) bands.push(listed.slice(i, i + cols));
    for (const band of bands) {
      expect(band, 'a row ascends left to right').toEqual([...band].sort((a, b) => a - b));
    }
    for (let i = 1; i < bands.length; i++) {
      expect(Math.max(...bands[i]!), 'and every row stands above the one after it')
        .toBeLessThan(Math.min(...bands[i - 1]!));
    }
    expect(bands[bands.length - 1], 'the last row drawn is the ground one').toContain(0);
  });

  /**
   * AND THE FILE IS THE SAME RULE WITH ONE FLOOR ON A ROW: the stack read downward, top floor first,
   * ground last. It is not a second layout — the same chunk-and-reverse produces both — which is
   * what keeps "higher is up" true of the file without a branch that could disagree with the square.
   */
  it('reads the file downward, top floor first', () => {
    mountAt(720);
    openPanel();
    expect(columnsShown(), 'the count opens the file').toBe(1);
    const listed = [...document.querySelectorAll('[data-testid^="shell-layer-row-"]')]
      .map((el) => Number(el.getAttribute('data-testid')!.replace('shell-layer-row-', '')));
    expect(listed).toEqual([...listed].sort((a, b) => b - a));
    expect(listed[0]).toBe(ELEVATION_MAX);
    expect(listed[listed.length - 1], 'the ground is the bottom of the file').toBe(0);
  });

  /**
   * THE BAR IS ABSOLUTE. It says how much of the island this floor covers, not how this floor
   * compares with the busiest one: a floor's own reading must not change because something was
   * built somewhere else, which is exactly what the relative bar did — laying a taller storey
   * rescaled every bar on the plate.
   */
  it('measures a floor against the map rather than against the busiest floor', async () => {
    mount();
    openPanel();
    // 20x20 of grass, 16 cells reaching layer 1 and 4 reaching layer 2.
    expect(width(1)).toBe('4%');
    expect(width(2)).toBe('1%');

    const state = useEditorStore.getState().gridState!;
    for (let y = 0; y < 4; y++) for (let x = 4; x < 8; x++) setTerrain(state, x, y, TerrainType.Mountain, 1);
    bumpCellsVersion(state);
    act(() => { useEditorStore.getState().eventBus.emit('cells-changed', { cells: [{ x: 4, y: 0 }] }); });

    await waitFor(() => expect(width(1), 'the floor that grew').toBe('8%'));
    expect(width(2), 'and the one that did not').toBe('1%');
  });

  /**
   * CAPACITY IS THE BUILDABLE CELLS. Sea, beach, boundary and the plaza refuse every edit, so they
   * are not room a floor could ever take: measured against the whole template a fully covered floor
   * would stop a third of the way along its own track and the bar could never say "full".
   */
  it('counts only the cells a floor could occupy as its capacity', () => {
    const state = stepped();
    for (let y = 0; y < 20; y++) for (let x = 10; x < 20; x++) setZone(state, x, y, CellZone.Void);
    useEditorStore.setState({ gridState: state });
    mount();
    openPanel();
    // The same 16 cells, on an island of 200 buildable ones rather than 400.
    expect(width(1)).toBe('8%');
  });

  /**
   * A count is cells PLUS the objects standing on them, and an object is one however many cells it
   * covers, so a fully built and fully decorated floor totals more than the island holds. Full is
   * where the bar stops: a fill running past the end of its own track is a worse reading than the
   * relative bar it replaced.
   */
  it('stops the bar at full rather than letting it run past its track', () => {
    const full = makeState();
    for (let y = 0; y < 20; y++) for (let x = 0; x < 20; x++) setTerrain(full, x, y, TerrainType.Mountain, 1);
    full.objects.set('o', {
      id: 'o', catalogId: 'flower_red', position: { x: 0, y: 0 }, rotation: 0, elevation: 1,
    });
    useEditorStore.setState({ gridState: full });
    mount();
    openPanel();
    expect(count(1), 'four hundred cells and a flower standing on one of them').toBe('401');
    expect(width(1)).toBe('100%');
  });

  /**
   * ONE NAME PER FLOOR. The ground is the implicit base and stores no terrain cell at all, so it has
   * a word rather than an index, and two places derive that word: deriving it separately gives a
   * plate reading "Layer 0" over a tile reading "Ground".
   *
   * The head is not one of those places, so the pair guarded here is the COLLAPSED COUNT and the
   * tiles — the same two derivations, one click apart.
   */
  it('names a floor the same way on the count as in its tiles', () => {
    useEditorStore.setState({ activeLayer: 0 });
    mount();
    expect(screen.getByTestId('shell-layer-readout').textContent).toBe('Ground');
    openPanel();
    expect(screen.getByTestId('shell-layer-row-0').getAttribute('aria-label')).toBe('Ground');

    fireEvent.click(screen.getByTestId('shell-layer-row-3'));
    expect(screen.getByTestId('shell-layer-row-3').getAttribute('aria-label')).toBe('Layer 3');
    closePanel();
    expect(screen.getByTestId('shell-layer-readout').textContent).toBe('Layer 3');
  });

  it('marks the floor being built on, and moves it when a row is pressed', () => {
    mount();
    openPanel();
    expect(screen.getByTestId('shell-layer-row-2').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('shell-layer-row-1').getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(screen.getByTestId('shell-layer-row-1'));
    expect(useEditorStore.getState().activeLayer).toBe(1);
    expect(screen.getByTestId('shell-layer-row-1').getAttribute('aria-pressed')).toBe('true');
  });

  it('marks the floor being PREVIEWED while one is, since that is the one a stroke would land on', () => {
    useEditorStore.setState({ activeLayer: 1, displayLayer: 3 });
    mount();
    openPanel();
    expect(screen.getByTestId('shell-layer-row-3').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('shell-layer-row-1').getAttribute('aria-pressed')).toBe('false');
  });

  it('writes visibility and lock through to the store the map reads', () => {
    mount();
    openPanel();

    fireEvent.click(screen.getByTestId('shell-layer-eye-2'));
    expect(useEditorStore.getState().layerVisibility[2]).toBe(false);
    fireEvent.click(screen.getByTestId('shell-layer-eye-2'));
    expect(useEditorStore.getState().layerVisibility[2]).toBe(true);

    fireEvent.click(screen.getByTestId('shell-layer-lock-1'));
    expect(useEditorStore.getState().layerLocked[1]).toBe(true);
    fireEvent.click(screen.getByTestId('shell-layer-lock-1'));
    expect(useEditorStore.getState().layerLocked[1]).toBe(false);
  });

  it('follows the map while it is open', async () => {
    mount();
    openPanel();
    expect(count(3)).toBe('1');

    const state = useEditorStore.getState().gridState!;
    setTerrain(state, 1, 1, TerrainType.Mountain, 3);
    bumpCellsVersion(state);
    act(() => { useEditorStore.getState().eventBus.emit('cells-changed', { cells: [{ x: 1, y: 1 }] }); });

    // The subscription coalesces to one callback a frame, so the row lands on the next one.
    await waitFor(() => expect(count(3)).toBe('2'));
  });

  it('says which layer refused a paint, and only that one', async () => {
    useEditorStore.setState({ layerLocked: { 1: true } });
    mount();
    openPanel();
    const tint = screen.getByTestId('shell-layer-refused-1');
    expect(screen.queryByTestId('shell-layer-refused-2'), 'an unlocked layer has nothing to say').toBeNull();
    expect(tint.style.opacity).toBe('0');

    const cmd = { type: CommandType.PaintTerrain, cells: [{ x: 0, y: 0 }], terrainType: TerrainType.Mountain, elevation: 1 } as unknown as Command;
    act(() => {
      useEditorStore.getState().eventBus.emit('validation-failed', {
        cmd,
        errors: [{ ruleId: 'V-LOCK-01', message: 'error.layer_locked', cells: [{ x: 0, y: 0 }], severity: 'error' }],
      });
    });
    await waitFor(() => expect(Number(screen.getByTestId('shell-layer-refused-1').style.opacity)).toBeGreaterThan(0));
  });

  it('ignores a refusal that was not the layer lock', async () => {
    useEditorStore.setState({ layerLocked: { 1: true } });
    mount();
    openPanel();
    const cmd = { type: CommandType.PaintTerrain, cells: [{ x: 0, y: 0 }], terrainType: TerrainType.Mountain, elevation: 1 } as unknown as Command;
    act(() => {
      useEditorStore.getState().eventBus.emit('validation-failed', {
        cmd,
        errors: [{ ruleId: 'V-MTN-02', message: 'error.floating_block', cells: [{ x: 0, y: 0 }], severity: 'error' }],
      });
    });
    expect(screen.getByTestId('shell-layer-refused-1').style.opacity).toBe('0');
  });
});
