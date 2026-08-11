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
import { HISTORY_BUTTONS, KIT_BUTTONS, planRail, railCellStart, railStack } from '../../../ui/shell/frame';
import { plateDepth } from '../../../ui/shell/windows/LayerPanel';
import { Rail } from '../../../ui/shell/Rail';
import { __resetUiZoomAnim } from '../../../ui/design/ui-zoom-anim';
import { RAIL, ZOOM, frameFit } from '../../../ui/shell/units';

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
/** The pair differs in nothing but direction, so each names its own: a label they SHARED told a
 *  visitor nothing on the one pair the naming pill exists for. Matched by the two names rather than
 *  by a stem, which is what fails again if they are ever collapsed back into one word. */
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
   * THE TWO TURNS ARRIVE AND LEAVE rather than blinking with the view, and what makes that safe is
   * that the kit is planned for six buttons whichever view is showing. The pair stands in the last
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
 * anchored at (that is the whole of "grows into the map"), whether the name is in the plate at all,
 * and that a folded group offers none of it.
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

  /** The pill is the name, so the browser's own tooltip would be the same word said twice. */
  it('drops the native tooltip exactly where the pill replaces it', () => {
    mountAt(1200);
    expect(screen.getByLabelText('Zoom in').getAttribute('title')).toBeNull();
    cleanup();
    mountAt(660);
    expect(screen.getByLabelText('Zoom in').getAttribute('title')).toBe('Zoom in');
  });

  /**
   * THE POINTER IS JUDGED AGAINST A BOX THAT NEVER MOVES.
   *
   * Everything a button does to answer a pointer — opening the pill, growing to acknowledge it —
   * happens on the plate, and the plate takes no pointer events, so the square underneath is the
   * whole of the hit region in every state. A hover decided against a box that GROWS moves the edge
   * the pointer is being tested against, which fires the event that moves it back: the pump the
   * auto-trim chip was reported as.
   */
  it('answers the pointer on a shape that hit-testing cannot see', () => {
    mountAt(1200);
    const button = screen.getByLabelText('Zoom in') as HTMLElement;
    const square = { w: button.style.width, h: button.style.height };
    expect(plate('Zoom in').style.pointerEvents, 'the drawing is not the target').toBe('none');
    act(() => { fireEvent.pointerEnter(button, { pointerType: 'mouse' }); });
    expect({ w: button.style.width, h: button.style.height }, 'the box the pointer is in').toEqual(square);
  });

  /** A folded group has a second file where the pill would go, so there is nothing to grow into. */
  it('says nothing at all once its group has folded into two files', () => {
    mountAt(396);
    expect(files(kit())).toBe(2);
    expect(files(pair())).toBe(2);
    for (const label of ['Undo', 'Zoom in', 'Hide interface']) {
      expect(plate(label).textContent, `${label} keeps its name to itself`).not.toContain(label);
    }
  });

  /**
   * A NAME IS ONLY A NAME IF IT TELLS ITS BUTTON FROM THE ONE BESIDE IT.
   *
   * The two turns shared one word until someone used them: the pair that differs in nothing but
   * direction is exactly the pair the pill is for, and it was the pair it said nothing to. Read in
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
 * THE HIDE TOGGLE joined the kit rather than being bolted beside it, which is a claim about its
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
    // Nothing to place while a group runs in one file, or while its count divides evenly.
    expect(railCellStart(0, 5, 1)).toBeUndefined();
    expect(railCellStart(1, 2, 2)).toBeUndefined();
    // Five in two files: four fill two full rows and the fifth takes the right cell of the third.
    expect(railCellStart(4, 5, 2)).toBe(2);
    for (const i of [0, 1, 2, 3]) expect(railCellStart(i, 5, 2)).toBeUndefined();
    // And it is the ARRANGEMENT: one more button and the orphan is a different one.
    expect(railCellStart(4, 7, 2)).toBeUndefined();
    expect(railCellStart(6, 7, 2)).toBe(2);
  });

  it('right-aligns the kit\'s odd last button when the window folds it', () => {
    mountAt(660);
    expect(files(kit())).toBe(2);
    // 2D shows five of the seven, so zoom-out is the one alone, and it takes the right cell.
    expect(screen.getByLabelText('Zoom out').style.gridColumnStart).toBe('2');
    for (const label of ['Switch view', 'Hide interface', 'Fit to view', 'Zoom in']) {
      expect(screen.getByLabelText(label).style.gridColumnStart, label).toBe('');
    }
  });
});
