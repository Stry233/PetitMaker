// @vitest-environment jsdom
/**
 * The two right-hand groups that change shape, and the one that must not move while the UI scales.
 * jsdom lays nothing out, so these hold the structure the motion needs:
 *
 *  - the view kit adds two buttons in 3D and is planned for its full complement either way, so
 *    nothing above them moves;
 *  - both groups fold into two files on a short window, by one ladder in one plan;
 *  - the history pair's `top` transition is suppressed through a UI-scale change, which recomputes
 *    `top` and would otherwise play as a move.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { EventBus } from '../../../../core/commands/event-bus';
import type { EditorEvents } from '../../../../state/editing/events';
import { setReducedMotion, __resetMotionState } from '../../../../platform/channels/motion-state';
import { I18nProvider } from '../../../../i18n/context';
import { useEditorStore } from '../../../../state/store';
import { HISTORY_BUTTONS, KIT_BUTTONS, railCell, railStack } from '../../../../ui/shell/frame';
import { planRail } from '../../../../ui/shell/frame-plan';
import { plateDepth } from '../../../../ui/shell/controls/layer-plate';
import { Rail } from '../../../../ui/shell/Rail';
import { __resetUiZoomAnim } from '../../../../ui/design/ui-zoom-anim';
import { RAIL, ZOOM } from '../../../../ui/shell/units';
import { fittedUiScale } from '../../../../ui/design/scale';

function mountAt(windowHeight: number) {
  window.innerHeight = windowHeight;
  return render(<I18nProvider><Rail hidden={false} onHide={() => {}} /></I18nProvider>);
}

/** The zoom the live Rail runs under: the authored zoom times the window's fit (jsdom's window is
 *  below the design reference, so the fit is in force here). */
const zoomAt = (windowHeight: number) => ZOOM * fittedUiScale(window.innerWidth, windowHeight, 1);

const plan = (windowHeight: number) => planRail(windowHeight / zoomAt(windowHeight), {
  open: false, plateDepth: plateDepth('pill'),
});

/** The kit's own box: the one group with no test id of its own, found by a button it always holds. */
const kit = () => screen.getByLabelText('Switch view').parentElement as HTMLElement;
const pair = () => screen.getByTestId('shell-rail-history');
/** How many files a group is running in, read off the grid it lays its buttons out in. */
const files = (el: HTMLElement) => Number(/repeat\((\d+)/.exec(el.style.gridTemplateColumns)![1]);
/** The two turns, matched by their two distinct names so a shared label would fail. */
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
  /** The turns animate in and out in the last row, so the kit, which hangs off the shelf's floor, is
   *  planned for them in both views and nothing above them moves. */
  it('offers the two turns in 3D only, and is placed for them either way', () => {
    mountAt(900);
    expect(turns(), '2D cannot orbit, so it does not offer the button').toHaveLength(0);
    const restingTop = kit().style.top;

    act(() => { useEditorStore.getState().setViewMode('3d'); });
    expect(turns()).toHaveLength(2);
    expect(kit().style.top, 'the kit did not move to make room for them').toBe(restingTop);

    act(() => { useEditorStore.getState().setViewMode('2d'); });
    expect(kit().style.top, 'nor when they leave').toBe(restingTop);
    // The turns are still mounted for their exit, so the plan, not the DOM, sets the kit's place.
    expect(planRail(900 / zoomAt(900), { open: false, plateDepth: plateDepth('pill') }).kitTop)
      .toBeCloseTo(parseFloat(restingTop), 6);
  });

  it('plans for the complement 3D carries, not the one 2D shows', () => {
    expect(KIT_BUTTONS).toBe(7);
    const p = plan(900);
    // A kit placed for 2D's buttons would put the last 3D row on the band.
    expect(p.kitTop + railStack(Math.ceil(KIT_BUTTONS / p.kitFiles)))
      .toBeLessThanOrEqual(900 / zoomAt(900));
  });
});

describe('the groups fold', () => {
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
    // Folding rearranges; it never removes a control.
    expect(screen.getByLabelText('Undo')).toBeTruthy();
    expect(screen.getByLabelText('Redo')).toBeTruthy();
  });
});

describe('the history pair and the UI scale', () => {
  /** Every step of a Ctrl +/- tween recomputes `top`, which a transition would play as a slide. The
   *  signal is the one `scale.tsx` drops its pixel rounding on. */
  it('does not travel while the scale is moving, and travels again once it settles', () => {
    vi.useFakeTimers();
    try {
      mountAt(900);
      expect(pair().style.transition, 'at rest it can travel').toContain('top');

      act(() => { useEditorStore.getState().setUiZoom(1.4); });
      act(() => { vi.advanceTimersByTime(16); });
      // The veil shares the declaration, so only `top` is dropped.
      expect(pair().style.transition, 'while the scale moves it must not').not.toContain('top');

      // Ends the tween the way the module does, rather than waiting out its frames.
      act(() => { __resetUiZoomAnim(); });
      expect(pair().style.transition, 'and it can again once the scale has settled').toContain('top');
    } finally {
      vi.useRealTimers();
    }
  });

  /** `animations.css` collapses the transition itself under reduced motion. */
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
  /** A grid in both arrangements, so the fold is one property changing and a button can travel. */
  it('stands in a grid whether its group is folded or not', () => {
    mountAt(1440);
    expect(kit().style.display).toBe('grid');
    expect(pair().style.display).toBe('grid');
    expect(files(kit())).toBe(1);
    expect(files(pair())).toBe(1);
    // Tracks are button-wide, so the plan can name a folded group's width.
    expect(kit().style.gridTemplateColumns).toContain(`${RAIL.button}px`);
  });
});

/**
 * The name pill shown on hover. jsdom lays nothing out, so this checks the plate's anchored end and
 * that the name is in the plate in every arrangement.
 */
describe('a button gives its name', () => {
  /** The plate inside a button, the shape that opens. */
  const plate = (label: string) => screen.getByLabelText(label).firstElementChild as HTMLElement;

  it('opens into the map, which from this edge is leftward', () => {
    mountAt(1200);
    for (const label of ['Undo', 'Redo', 'Switch view', 'Hide interface', 'Fit to view', 'Zoom in', 'Zoom out']) {
      expect(plate(label).style.right, `${label} is anchored at its glyph`).toBe('0px');
      expect(plate(label).style.left).toBe('');
      expect(plate(label).textContent, `${label} carries its own name`).toContain(label);
    }
  });

  /** The pill opens in every arrangement, so a native tooltip would say the name twice. */
  it('never offers the native tooltip', () => {
    mountAt(1200);
    expect(screen.getByLabelText('Zoom in').getAttribute('title')).toBeNull();
    cleanup();
    mountAt(660);
    expect(screen.getByLabelText('Zoom in').getAttribute('title')).toBeNull();
  });

  /** The plate grows and takes no pointer events, so the hit region stays the fixed square; a hover
   *  judged against a growing box would oscillate. */
  it('answers the pointer on a shape that hit-testing cannot see', () => {
    mountAt(1200);
    const button = screen.getByLabelText('Zoom in') as HTMLElement;
    const square = { w: button.style.width, h: button.style.height };
    expect(plate('Zoom in').style.pointerEvents, 'the drawing is not the target').toBe('none');
    act(() => { fireEvent.pointerEnter(button, { pointerType: 'mouse' }); });
    expect({ w: button.style.width, h: button.style.height }, 'the box the pointer is in').toEqual(square);
  });

  /** A group's grid has empty cells, which at `z.column` would take presses aimed at what lies below
   *  (the composer's send button at a high uiZoom). */
  it('lets a press through the air between its buttons, and takes one on each button', () => {
    mountAt(1200);
    for (const g of [kit(), pair(), screen.getByLabelText('Layers').parentElement as HTMLElement]) {
      expect(g.style.pointerEvents, 'the group is deaf').toBe('none');
    }
    for (const label of ['Undo', 'Redo', 'Zoom in', 'Switch view', 'Hide interface', 'Layers']) {
      expect((screen.getByLabelText(label) as HTMLElement).style.pointerEvents, label).toBe('auto');
    }
  });

  /** A 900 css px window already folds the kit. A right-file pill covers its left neighbour only while
   *  the pointer is in its own square, so the neighbour stays pressable. */
  it('keeps giving names in the compact multi-column arrangement', () => {
    mountAt(396);
    expect(files(kit())).toBeGreaterThanOrEqual(2);
    expect(files(pair())).toBe(2);
    for (const label of ['Undo', 'Redo', 'Zoom in', 'Hide interface']) {
      expect(plate(label).textContent, `${label} still carries its name`).toContain(label);
      expect(plate(label).style.right, `${label} still opens leftward from its glyph`).toBe('0px');
    }
  });

  /** Read in 3D, where the turns that differ only by direction are present. */
  it('gives no two buttons of the column the same name', () => {
    const view = mountAt(1200);
    act(() => { useEditorStore.getState().setViewMode('3d'); });
    const labels = [...view.container.querySelectorAll('button[aria-label]')]
      .map((b) => b.getAttribute('aria-label')!);
    expect(labels.length).toBeGreaterThan(HISTORY_BUTTONS + KIT_BUTTONS);
    expect([...new Set(labels)].sort()).toEqual([...labels].sort());
  });
});

/** The hide toggle is a kit member, so it shares the kit's size, plate, fold and pill. */
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

/** The column hangs off the window's right edge, so a lone button in a row's left cell would notch it. */
describe('a folded group fills from the right', () => {
  it('puts the hole on the inside, whatever the count is', () => {
    expect(railCell(0, 5, 1)).toEqual({ column: 1, row: 1 });
    expect(railCell(4, 5, 1)).toEqual({ column: 1, row: 5 });
    expect(railCell(1, 2, 2)).toEqual({ column: 2, row: 1 });
    expect(railCell(3, 5, 2)).toEqual({ column: 2, row: 2 });
    expect(railCell(4, 5, 2)).toEqual({ column: 2, row: 3 });
    expect(railCell(4, 7, 2)).toEqual({ column: 1, row: 3 });
    expect(railCell(6, 7, 2)).toEqual({ column: 2, row: 4 });
  });

  /** A departing button is still mounted and auto-placement would count it, so every button names
   *  both coordinates. */
  const at = (label: string) => {
    const el = screen.getByLabelText(label);
    return `${el.style.gridColumnStart}/${el.style.gridRowStart}`;
  };

  it('right-aligns the kit\'s odd last button when the window folds it', () => {
    mountAt(660);
    expect(files(kit())).toBe(2);
    // 2D shows five of the seven.
    expect(at('Switch view')).toBe('1/1');
    expect(at('Hide interface')).toBe('2/1');
    expect(at('Fit to view')).toBe('1/2');
    expect(at('Zoom in')).toBe('2/2');
    expect(at('Zoom out')).toBe('2/3');
  });

  /** The turns arriving change which button is odd, a move that `layout` on a rail button animates. */
  it('moves the one button the new arrangement moved, and no other', () => {
    mountAt(660);
    expect(at('Zoom out')).toBe('2/3');

    act(() => { useEditorStore.getState().setViewMode('3d'); });
    expect(at('Zoom out')).toBe('1/3');
    expect(at('Rotate left')).toBe('2/3');
    expect(at('Rotate right')).toBe('2/4');
    for (const [label, cell] of [['Switch view', '1/1'], ['Hide interface', '2/1'], ['Fit to view', '1/2'], ['Zoom in', '2/2']] as const) {
      expect(at(label), label).toBe(cell);
    }
  });

  /** Under auto-placement a fading turn would be re-placed as the count fell. */
  it('leaves a departing turn exactly where it stood while it fades', () => {
    mountAt(660);
    act(() => { useEditorStore.getState().setViewMode('3d'); });
    act(() => { useEditorStore.getState().setViewMode('2d'); });
    expect(turns(), 'still mounted, because they leave through an exit animation').toHaveLength(2);
    expect(at('Rotate left')).toBe('2/3');
    expect(at('Rotate right')).toBe('2/4');
    // Zoom-out travels into the cell the first turn is fading out of.
    expect(at('Zoom out')).toBe('2/3');
  });
});

/** Framer writes a turn's opacity per frame, and a CSS opacity transition on the same element would
 *  chase every write, so the veil fades the drawing instead. */
describe('the veil and the arrival do not share a property', () => {
  const plate = (label: string) => screen.getByLabelText(label).firstElementChild as HTMLElement;

  it('leaves the button\'s own opacity to Framer and fades the drawing under it', () => {
    mountAt(1200);
    const button = screen.getByLabelText('Zoom in');
    expect(button.style.opacity, 'nothing here writes an opacity Framer is animating').toBe('');
    expect(button.style.transition).not.toContain('opacity');
    // `visibility`, which Framer never touches, takes a veiled button out of hit-testing.
    expect(button.style.transition).toContain('visibility');
    expect(plate('Zoom in').style.opacity).toBe('1');
    expect(plate('Zoom in').style.transition).toContain('opacity');
  });

  it('still draws the whole column away when the interface goes', () => {
    render(<I18nProvider><Rail hidden onHide={() => {}} /></I18nProvider>);
    expect(plate('Zoom in').style.opacity).toBe('0');
    expect(screen.getByLabelText('Zoom in').style.visibility).toBe('hidden');
    // The way back stays faintly lit.
    expect(plate('Show interface').style.opacity).toBe('0.45');
  });
});
