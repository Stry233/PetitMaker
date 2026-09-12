/**
 * The two right-hand groups that CHANGE SHAPE, and the one that must not move while the UI scales.
 *
 * jsdom lays nothing out, so none of this is about where a button lands: what these hold is the
 * structure the motion needs and the conditions under which it must not run.
 *
 *  - The view kit offers two extra buttons in 3D and takes them back in 2D, and the kit is PLANNED
 *    for its full complement either way, so nothing above them moves as they come and go.
 *  - Both groups fold into two files on a short window, by one ladder in one plan.
 *  - The history pair's travel is a CSS transition on `top`, and `top` is a computed length, so a
 *    change of UI scale recomputes it. A transition left on through that plays a layout change as
 *    though it were a move, which is the drift this suppresses.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { EventBus } from '../../../core/commands/event-bus';
import type { EditorEvents } from '../../../core/model/types';
import { setReducedMotion, __resetMotionState } from '../../../canvas/map2d/motion-state';
import { I18nProvider } from '../../../i18n/context';
import { useEditorStore } from '../../../state/store';
import { HISTORY_BUTTONS, KIT_BUTTONS, planRail, railCell, railStack } from '../../../ui/shell/frame';
import { plateDepth } from '../../../ui/shell/windows/LayerPanel';
import { Rail } from '../../../ui/shell/Rail';
import { __resetUiZoomAnim } from '../../../ui/design/ui-zoom-anim';
import { RAIL, ZOOM } from '../../../ui/shell/units';
import { frameFit } from '../../../ui/design/scale';

function mountAt(windowHeight: number) {
  window.innerHeight = windowHeight;
  return render(<I18nProvider><Rail hidden={false} onHide={() => {}} /></I18nProvider>);
}

/** The zoom the live Rail runs under: the authored zoom times the window's fit (jsdom's window is
 *  below the design reference, so the fit is in force here). */
const zoomAt = (windowHeight: number) => ZOOM * frameFit(window.innerWidth, windowHeight);

const plan = (windowHeight: number) => planRail(windowHeight / zoomAt(windowHeight), {
  open: false, plateDepth: plateDepth('pill'),
});

/** The kit's own box: the one group with no test id of its own, found by a button it always holds. */
const kit = () => screen.getByLabelText('Switch view').parentElement as HTMLElement;
const pair = () => screen.getByTestId('shell-rail-history');
/** How many files a group is running in, read off the grid it lays its buttons out in. */
const files = (el: HTMLElement) => Number(/repeat\((\d+)/.exec(el.style.gridTemplateColumns)![1]);
/** The pair differs in nothing but direction, so each names its own: a label they SHARED would tell
 *  a visitor nothing on the one pair the naming pill exists for. Matched by the two names rather than
 *  by a stem, which is what fails if they are ever collapsed into one word. */
const turns = () => [
  ...screen.queryAllByLabelText('Rotate left'),
  ...screen.queryAllByLabelText('Rotate right'),
];

beforeEach(() => {
  window.innerHeight = 900;
  __resetMotionState();
  __resetUiZoomAnim();
  useEditorStore.setState({
    locale: 'en', eventBus: new EventBus<EditorEvents>(), gridState: null, viewMode: '2d', uiZoom: 1,
  });
});
afterEach(() => {
  cleanup();
  useEditorStore.setState({ uiZoom: 1, viewMode: '2d' });
  __resetUiZoomAnim();
  __resetMotionState();
});

describe('the view kit', () => {
  /**
   * THE TWO TURNS ARRIVE AND LEAVE rather than blinking with the view: the kit is planned for the
   * full complement whichever view is showing. The pair stands in the last
   * row, so a button still leaving holds the cell it had and nothing above it moves — which matters
   * because the kit hangs off the shelf's floor and a wobble there reads as the whole column moving.
   */
  it('offers the two turns in 3D only, and is placed for them either way', () => {
    mountAt(900);
    expect(turns(), '2D cannot orbit, so it does not offer the button').toHaveLength(0);
    const restingTop = kit().style.top;

    act(() => { useEditorStore.getState().setViewMode('3d'); });
    expect(turns()).toHaveLength(2);
    expect(kit().style.top, 'the kit did not move to make room for them').toBe(restingTop);

    act(() => { useEditorStore.getState().setViewMode('2d'); });
    expect(kit().style.top, 'nor when they leave').toBe(restingTop);
    // They leave through an exit animation, so they are still mounted for its length: that is the
    // whole point, and it is also why the kit's own height must not be measured off them.
    expect(planRail(900 / zoomAt(900), { open: false, plateDepth: plateDepth('pill') }).kitTop)
      .toBeCloseTo(parseFloat(restingTop), 6);
  });

  it('plans for the complement 3D carries, not the one 2D shows', () => {
    expect(KIT_BUTTONS).toBe(7);
    const p = plan(900);
    // The hang is measured for the taller of the two views, so the 3D kit is what has to clear the
    // shelf; a kit placed for the 2D four would put the last 3D row on the band.
    expect(p.kitTop + railStack(Math.ceil(KIT_BUTTONS / p.kitFiles)))
      .toBeLessThanOrEqual(900 / zoomAt(900));
  });
});

describe('the groups fold', () => {
  /** One ladder places both, so what is rendered is what the plan said and not a second rule. */
  it('runs each group in the number of files its plan asked for', () => {
    for (const h of [1440, 900, 720, 660]) {
      const p = plan(h);
      mountAt(h);
      expect(files(kit()), `${h}px, the kit`).toBe(p.kitFiles);
      expect(files(pair()), `${h}px, the pair`).toBe(p.historyFiles);
      cleanup();
    }
  });

  it('folds the pair into a row of two and no further', () => {
    expect(HISTORY_BUTTONS).toBe(2);
    mountAt(396);
    expect(files(pair()), 'a short window stands them side by side').toBe(2);
    // Both buttons are still there: folding is a rearrangement, never a control removed.
    expect(screen.getByLabelText('Undo')).toBeTruthy();
    expect(screen.getByLabelText('Redo')).toBeTruthy();
  });
});

describe('the history pair and the UI scale', () => {
  /**
   * `top` is a computed length. Every step of a Ctrl +/- tween hands it a new number, and a
   * transition on it plays that recomputation as a move: the pair slid into place after the rest of
   * the frame had already arrived, on a gesture that is not about the pair at all.
   *
   * The signal is the one `scale.tsx` drops its pixel rounding on, so this is one mechanism rather
   * than a second guess at the same question.
   */
  it('does not travel while the scale is moving, and travels again once it settles', () => {
    vi.useFakeTimers();
    try {
      mountAt(900);
      expect(pair().style.transition, 'at rest it can travel').toContain('top');

      act(() => { useEditorStore.getState().setUiZoom(1.4); });
      act(() => { vi.advanceTimersByTime(16); });
      // The pair's `top` and nothing else: an element has ONE transition declaration and the veil
      // shares it, so what the suppression drops is the travel, not the whole string.
      expect(pair().style.transition, 'while the scale moves it must not').not.toContain('top');

      // The end of the tween, reached the way the module itself ends one rather than by waiting out
      // its frames: what is being pinned is that the pair gets its travel BACK, not how many rAFs
      // the smoothing takes.
      act(() => { __resetUiZoomAnim(); });
      expect(pair().style.transition, 'and it can again once the scale has settled').toContain('top');
    } finally {
      vi.useRealTimers();
    }
  });

  /** Reduced motion never runs the zoom tween, so there is no window to suppress and the pair keeps
   *  its declaration; `animations.css` is what collapses the transition itself in that state. */
  it('keeps its declaration under reduced motion, where the scale never tweens', () => {
    vi.useFakeTimers();
    try {
      setReducedMotion(true);
      mountAt(900);
      act(() => { useEditorStore.getState().setUiZoom(1.4); });
      act(() => { vi.advanceTimersByTime(16); });
      expect(pair().style.transition).toContain('top');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('a rail button that can be rearranged', () => {
  /** A group is a grid in both arrangements, so the fold is one property changing rather than one
   *  layout swapped for another: a flex column and a grid have nothing in common for a button to
   *  travel across. */
  it('stands in a grid whether its group is folded or not', () => {
    mountAt(1440);
    expect(kit().style.display).toBe('grid');
    expect(pair().style.display).toBe('grid');
    expect(files(kit())).toBe(1);
    expect(files(pair())).toBe(1);
    // And the grid is a whole number of button-wide tracks either way, which is what makes a folded
    // group as wide as it is deep and the plate's step aside a number the plan can name.
    expect(kit().style.gridTemplateColumns).toContain(`${RAIL.button}px`);
  });
});

/**
 * THE NAME PILL, which is the group's answer to a pointer resting on one of its buttons.
 *
 * jsdom lays nothing out, so the WIDTH is not testable here: what is, is which end the plate is
 * anchored at (that is the whole of "grows into the map"), and that the name is in the plate in
 * EVERY arrangement — a folded group's buttons keep their names, since the pill is the one place a
 * button says what it does and folding is the shape most windows put these groups in.
 */
describe('a button gives its name', () => {
  /** The plate inside a button: the shape that opens, and the only span the button holds directly. */
  const plate = (label: string) => screen.getByLabelText(label).firstElementChild as HTMLElement;

  it('opens into the map, which from this edge is leftward', () => {
    mountAt(1200);
    for (const label of ['Undo', 'Redo', 'Switch view', 'Hide interface', 'Fit to view', 'Zoom in', 'Zoom out']) {
      expect(plate(label).style.right, `${label} is anchored at its glyph`).toBe('0px');
      expect(plate(label).style.left).toBe('');
      expect(plate(label).textContent, `${label} carries its own name`).toContain(label);
    }
  });

  /** The pill is the name, so the browser's own tooltip would be the same word said twice — in any
   *  arrangement, since the pill opens in all of them. */
  it('never offers the native tooltip', () => {
    mountAt(1200);
    expect(screen.getByLabelText('Zoom in').getAttribute('title')).toBeNull();
    cleanup();
    mountAt(660);
    expect(screen.getByLabelText('Zoom in').getAttribute('title')).toBeNull();
  });

  /**
   * THE POINTER IS JUDGED AGAINST A BOX THAT NEVER MOVES.
   *
   * Everything a button does to answer a pointer — opening the pill, growing to acknowledge it —
   * happens on the plate, and the plate takes no pointer events, so the square underneath is the
   * whole of the hit region in every state. A hover decided against a box that GROWS moves the edge
   * the pointer is being tested against, which fires the event that moves it back: a pump.
   */
  it('answers the pointer on a shape that hit-testing cannot see', () => {
    mountAt(1200);
    const button = screen.getByLabelText('Zoom in') as HTMLElement;
    const square = { w: button.style.width, h: button.style.height };
    expect(plate('Zoom in').style.pointerEvents, 'the drawing is not the target').toBe('none');
    act(() => { fireEvent.pointerEnter(button, { pointerType: 'mouse' }); });
    expect({ w: button.style.width, h: button.style.height }, 'the box the pointer is in').toEqual(square);
  });

  /**
   * A GROUP'S BOX IS WIDER AND TALLER THAN ITS BUTTONS, and it does not own the difference.
   *
   * Each group is a grid sized for its files, so a folded kit with an odd count carries an empty cell
   * and every group is roughly two buttons wide either way. At `z.column` that emptiness took every
   * press that landed in it: presses between two buttons never reached the map, and at uiZoom 1.8 on
   * a 1280x800 window the kit's box reached x 930 while the assistant panel's send button stood at
   * 889..970, so `elementFromPoint` at the send's own centre answered the group and the composer
   * could not be sent. The air is deaf and each control claims itself back.
   */
  it('lets a press through the air between its buttons, and takes one on each button', () => {
    mountAt(1200);
    for (const g of [kit(), pair(), screen.getByLabelText('Layers').parentElement as HTMLElement]) {
      expect(g.style.pointerEvents, 'the group is deaf').toBe('none');
    }
    for (const label of ['Undo', 'Redo', 'Zoom in', 'Switch view', 'Hide interface', 'Layers']) {
      expect((screen.getByLabelText(label) as HTMLElement).style.pointerEvents, label).toBe('auto');
    }
  });

  /**
   * A FOLDED GROUP STILL GIVES ITS NAMES. Folding is not a corner case: a 900 css px window already
   * runs the kit in two files, so a pill withheld from a folded group is a pill most visitors never
   * see and a button that grows on hover without ever saying what it is for. A right-file pill
   * passes over its left neighbour while it is open, and the neighbour stays pressable: the pill
   * only exists while the pointer is inside its own button's square, so by the time the pointer
   * reaches where the word was, the hover that showed it has ended and the neighbour is answering
   * for itself.
   */
  it('keeps giving names in the compact multi-column arrangement', () => {
    mountAt(396);
    expect(files(kit())).toBeGreaterThanOrEqual(2);
    expect(files(pair())).toBe(2);
    for (const label of ['Undo', 'Redo', 'Zoom in', 'Hide interface']) {
      expect(plate(label).textContent, `${label} still carries its name`).toContain(label);
      expect(plate(label).style.right, `${label} still opens leftward from its glyph`).toBe('0px');
    }
  });

  /**
   * A NAME IS ONLY A NAME IF IT TELLS ITS BUTTON FROM THE ONE BESIDE IT.
   *
   * A pair that differs in nothing but direction is exactly the pair the pill is for, and one
   * word shared between the two says nothing to it. Read in
   * 3D, which is the complement that has them, and over the whole column rather than that one
   * group, since the fault costs the same anywhere in it.
   */
  it('gives no two buttons of the column the same name', () => {
    const view = mountAt(1200);
    act(() => { useEditorStore.getState().setViewMode('3d'); });
    const labels = [...view.container.querySelectorAll('button[aria-label]')]
      .map((b) => b.getAttribute('aria-label')!);
    expect(labels.length).toBeGreaterThan(HISTORY_BUTTONS + KIT_BUTTONS);
    expect([...new Set(labels)].sort()).toEqual([...labels].sort());
  });
});

/**
 * THE HIDE TOGGLE IS A KIT MEMBER rather than a bolt-on beside it, which is a claim about its
 * size, its plate, its fold and its pill. Those are the kit's, so what is left to hold here is that
 * it is IN the kit and that it is the one thing that does not go away with everything else.
 */
describe('the hide toggle', () => {
  it('stands in the view kit, in the place the design source gives it', () => {
    mountAt(1200);
    const labels = [...kit().children].map((el) => el.getAttribute('aria-label'));
    expect(labels).toEqual(['Switch view', 'Hide interface', 'Fit to view', 'Zoom in', 'Zoom out']);
  });

  it('is the only button of the column left standing once the interface is away', () => {
    render(<I18nProvider><Rail hidden onHide={() => {}} /></I18nProvider>);
    const shown = (label: string) => (screen.getByLabelText(label) as HTMLElement).style.visibility;
    expect(shown('Show interface')).toBe('visible');
    for (const label of ['Switch view', 'Fit to view', 'Zoom in', 'Zoom out', 'Undo', 'Redo']) {
      expect(shown(label), `${label} is drawn away`).toBe('hidden');
    }
    expect(screen.getByTestId('shell-rail-history').style.visibility).toBe('hidden');
  });
});

/**
 * A FOLDED GROUP FILLS FROM THE RIGHT.
 *
 * The whole column hangs off the window's right edge and the eye reads that edge straight down, so a
 * button left alone in the LEFT cell of its row notches it. The rule is the arrangement's, not any
 * one button's: which button ends up alone falls out of the count.
 */
describe('a folded group fills from the right', () => {
  it('puts the hole on the inside, whatever the count is', () => {
    // One file is a straight column: one button per row, all in the only cell there is.
    expect(railCell(0, 5, 1)).toEqual({ column: 1, row: 1 });
    expect(railCell(4, 5, 1)).toEqual({ column: 1, row: 5 });
    // A count that divides evenly fills both cells of every row.
    expect(railCell(1, 2, 2)).toEqual({ column: 2, row: 1 });
    // Five in two files: four fill two full rows and the fifth takes the right cell of the third.
    expect(railCell(3, 5, 2)).toEqual({ column: 2, row: 2 });
    expect(railCell(4, 5, 2)).toEqual({ column: 2, row: 3 });
    // And it is the ARRANGEMENT: one more button and the orphan is a different one.
    expect(railCell(4, 7, 2)).toEqual({ column: 1, row: 3 });
    expect(railCell(6, 7, 2)).toEqual({ column: 2, row: 4 });
  });

  /** The cell of the button, not of the ones around it: a button on its way out is still mounted,
   *  and auto-placement counted it. Every button therefore names both of its coordinates. */
  const at = (label: string) => {
    const el = screen.getByLabelText(label);
    return `${el.style.gridColumnStart}/${el.style.gridRowStart}`;
  };

  it('right-aligns the kit\'s odd last button when the window folds it', () => {
    mountAt(660);
    expect(files(kit())).toBe(2);
    // 2D shows five of the seven: two full rows, and zoom-out alone in the RIGHT cell of the third.
    expect(at('Switch view')).toBe('1/1');
    expect(at('Hide interface')).toBe('2/1');
    expect(at('Fit to view')).toBe('1/2');
    expect(at('Zoom in')).toBe('2/2');
    expect(at('Zoom out')).toBe('2/3');
  });

  /**
   * THE TURNS ARRIVING CHANGES WHICH BUTTON IS THE ODD ONE, so one button moves and the rest do
   * not. That move is what `layout` on a rail button is for; keyed on the file count alone it
   * would never run, and the zoom-out button would change columns in a single frame.
   */
  it('moves the one button the new arrangement moved, and no other', () => {
    mountAt(660);
    expect(at('Zoom out')).toBe('2/3');

    act(() => { useEditorStore.getState().setViewMode('3d'); });
    // Seven now: three full rows, and the second turn alone on the fourth. Zoom-out is no longer
    // the odd one, so it crosses to the left cell of its row.
    expect(at('Zoom out')).toBe('1/3');
    expect(at('Rotate left')).toBe('2/3');
    expect(at('Rotate right')).toBe('2/4');
    for (const [label, cell] of [['Switch view', '1/1'], ['Hide interface', '2/1'], ['Fit to view', '1/2'], ['Zoom in', '2/2']] as const) {
      expect(at(label), label).toBe(cell);
    }
  });

  /**
   * AND A BUTTON ON ITS WAY OUT KEEPS THE CELL IT WAS DRAWN IN. The pair is mounted for the length
   * of its exit, so grid auto-placement counted it and re-placed it as the count fell: a turn
   * mid-fade dropped a row and jumped a column on its way off the kit.
   */
  it('leaves a departing turn exactly where it stood while it fades', () => {
    mountAt(660);
    act(() => { useEditorStore.getState().setViewMode('3d'); });
    act(() => { useEditorStore.getState().setViewMode('2d'); });
    expect(turns(), 'still mounted, because they leave through an exit animation').toHaveLength(2);
    expect(at('Rotate left')).toBe('2/3');
    expect(at('Rotate right')).toBe('2/4');
    // Zoom-out travels into the cell the first turn is fading out of, which is what one button
    // leaving as another arrives in its place should look like.
    expect(at('Zoom out')).toBe('2/3');
  });
});

/**
 * ONE PROPERTY, ONE CLOCK.
 *
 * A turn fades itself through Framer, which writes an opacity per frame. A CSS transition on opacity
 * on the same element gives a second clock chasing every one of those writes: the turns blink as they
 * arrive and pop off screen still half drawn as they leave. The fade lives on the drawing instead,
 * which is every pixel a rail button has.
 */
describe('the veil and the arrival do not share a property', () => {
  const plate = (label: string) => screen.getByLabelText(label).firstElementChild as HTMLElement;

  it('leaves the button\'s own opacity to Framer and fades the drawing under it', () => {
    mountAt(1200);
    const button = screen.getByLabelText('Zoom in');
    expect(button.style.opacity, 'nothing here writes an opacity Framer is animating').toBe('');
    expect(button.style.transition).not.toContain('opacity');
    // `visibility` is discrete, Framer never touches it, and it is the half of the veil that takes
    // a button out of hit-testing.
    expect(button.style.transition).toContain('visibility');
    expect(plate('Zoom in').style.opacity).toBe('1');
    expect(plate('Zoom in').style.transition).toContain('opacity');
  });

  it('still draws the whole column away when the interface goes', () => {
    render(<I18nProvider><Rail hidden onHide={() => {}} /></I18nProvider>);
    expect(plate('Zoom in').style.opacity).toBe('0');
    expect(screen.getByLabelText('Zoom in').style.visibility).toBe('hidden');
    // The way back stays lit, and holds back until it is reached for.
    expect(plate('Show interface').style.opacity).toBe('0.45');
  });
});
