/**
 * THE PANEL DOCKED: what the frame becomes, what the column becomes, and what the control says.
 *
 * The dock is one preference and two layouts. What is load-bearing about it cannot be seen from
 * either side alone, so this mounts the REAL shell and asserts the decisions jsdom can hold: the
 * frame's plane is inset by the column's own width and is the box its clusters are placed against
 * (`contain: layout`) while passing the map's presses through; the column stands on the window from
 * top to bottom; and the control reports the live state rather than the remembered intent.
 *
 * The pref is an INTENT and the layout is derived from it, which is why the narrow window is here
 * too: a window with no room for the interface beside the dock sets the panel free and forgets
 * nothing.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { MotionConfig } from 'framer-motion';
import type { ReactNode } from 'react';

import { I18nProvider, translateFor } from '../../../i18n/context';
import { useEditorStore } from '../../../state/store';
import { PREFS } from '../../../core/runtime/prefs';
import { TOUR_SEEN_KEY } from '../../../ui/chrome/tour/use-tour';
import { Shell } from '../../../ui/shell/Shell';
import {
  CHARACTER_SEAT, DOCK_CHROME_W, PANEL_LEFT, PANEL_PLATE_PAD, PANEL_TOP, PINNED_COLUMN_W,
  PINNED_DOCK_REF_W, PINNED_PANEL, SEAT_TRAVEL_MAX, hasPinRoom, pinRoomFloor,
} from '../../../ui/shell/panel-frame';
import { PANEL_WIDTH } from '../../../ui/agent/tokens';
import { cozyOverlay, z } from '../../../ui/design/styles';
import { outSeconds, seconds } from '../../../ui/agent/motion';
import { useDockDriver, useDockStage } from '../../../ui/shell/use-dock';

const backing = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (k: string) => backing.get(k) ?? null,
    setItem: (k: string, v: string) => void backing.set(k, String(v)),
    removeItem: (k: string) => void backing.delete(k),
    clear: () => backing.clear(),
  },
});

/** A window with room for the dock, since jsdom's own is narrower than the bound. */
function widen(w: number): void {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: w });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 900 });
  act(() => { window.dispatchEvent(new Event('resize')); });
}

/** The sequence's own harness: the driver plus the stage, with nothing else mounted, so the two beats
 *  can be stepped through on a fake clock. */
const MotionOnly = ({ children }: { children: ReactNode }) => (
  <MotionConfig reducedMotion="always">{children}</MotionConfig>
);
const FullMotion = ({ children }: { children: ReactNode }) => (
  <MotionConfig reducedMotion="never">{children}</MotionConfig>
);

function mountShell() {
  return render(
    <MotionConfig reducedMotion="always">
      <I18nProvider>
        <Shell onRestoreSession={() => {}}><div data-testid="map-views" /></Shell>
      </I18nProvider>
    </MotionConfig>,
  );
}

/** The frame's plane: the element carrying the frame's zoom, which is the panel's own grandparent
 *  wherever the veil stands. */
function plane(): HTMLElement {
  return screen.getByTestId('shell-frame-veil').parentElement as HTMLElement;
}

/** The panel is the app's one lazy chunk, so the first render of it compiles the assistant graph.
 *  Paid once here, before anything below is timed. */
beforeAll(async () => {
  backing.set(TOUR_SEEN_KEY, '1');
  useEditorStore.setState({ locale: 'en', assistantOpen: true, assistantPinned: false });
  mountShell();
  await screen.findByTestId('shell-assistant-panel', undefined, { timeout: 30_000 });
  cleanup();
}, 40_000);

beforeEach(() => {
  useEditorStore.setState({
    locale: 'en', assistantOpen: true, assistantPinned: false, assistantDockSide: 'left',
  });
  widen(1600);
});
afterEach(() => {
  cleanup();
  backing.delete(PREFS.assistantPinned.key);
  backing.delete(PREFS.assistantDockSide.key);
});

describe('the frame stands beside the dock', () => {
  it('is one plane, placed against nothing but the window, while the panel stands free', async () => {
    mountShell();
    await screen.findByTestId('shell-assistant-panel');
    const box = plane();
    expect(box.style.left).toBe('0px');
    // The clusters inside are `fixed` and this is the box they resolve against, which is what lets
    // the dock move all of them by moving one number.
    expect(box.style.contain).toBe('layout');
    // A full-window box would take every press the map is meant to get.
    expect(box.style.pointerEvents).toBe('none');
  });

  it('is inset by the column\'s own width while the panel is docked', async () => {
    act(() => { useEditorStore.setState({ assistantPinned: true }); });
    mountShell();
    await screen.findByTestId('shell-assistant-panel');
    expect(plane().style.left).toBe(`${PINNED_COLUMN_W}px`);
    // The dock's width in the CHROME's own units, published per EDGE for the surfaces outside this
    // frame: the dock stands at one of two, so at most one of the pair is ever non-zero.
    expect(document.documentElement.style.getPropertyValue('--pin-dock-left')).toBe(`${PINNED_DOCK_REF_W}px`);
    expect(document.documentElement.style.getPropertyValue('--pin-dock-right')).toBe('0px');
  });

  /** ONE CLOCK, NOT ONE PER SURFACE. The travel is a multiple of the single animated fraction, which
   *  the FIT rides too, so no plane carries a transition of its own — a css clock here would be a
   *  second one, and the interface would rescale on a different frame from the one it moves on. */
  it('travels on the shared fraction rather than a clock of its own', async () => {
    mountShell();
    await screen.findByTestId('shell-assistant-panel');
    expect(plane().style.transition).toBe('');
    expect(screen.getByTestId('shell-map-plane').style.transition).toBe('');
    expect(screen.getByTestId('shell-vignette').style.transition).toBe('');
  });

  it('gives the window back when the panel is set free again', async () => {
    act(() => { useEditorStore.setState({ assistantPinned: true }); });
    mountShell();
    await screen.findByTestId('shell-assistant-panel');
    act(() => { useEditorStore.setState({ assistantPinned: false }); });
    expect(plane().style.left).toBe('0px');
    expect(document.documentElement.style.getPropertyValue('--pin-dock-left')).toBe('0px');
  });

  /** A FOLDED PANEL DOCKS NOTHING. The dock is the panel standing there, so putting it away returns
   *  the whole window to the interface and remembers the intent for the next press. */
  it('un-insets while the panel is away, without forgetting the dock', async () => {
    act(() => { useEditorStore.setState({ assistantPinned: true }); });
    mountShell();
    await screen.findByTestId('shell-assistant-panel');
    act(() => { useEditorStore.getState().setAssistantOpen(false); });
    expect(plane().style.left).toBe('0px');
    expect(useEditorStore.getState().assistantPinned).toBe(true);
  });
});

/**
 * THE MAP IS PART OF THE PAPER. Docking does not cover the map's left edge with a panel: the map's
 * own plane is inset past the dock exactly as the frame's is, so the canvas occupies what is left of
 * the window and its own box is what both views size and place themselves by.
 */
describe('the map moves with the interface', () => {
  const mapPlane = () => screen.getByTestId('shell-map-plane');

  it('holds the views, and holds them the way the frame holds its clusters', async () => {
    mountShell();
    await screen.findByTestId('shell-assistant-panel');
    expect(mapPlane().contains(screen.getByTestId('map-views'))).toBe(true);
    expect(mapPlane().style.contain).toBe('layout');
    expect(mapPlane().style.left).toBe('0px');
  });

  /** ONE DISTANCE IN TWO UNITS. The frame's plane is inset in the FRAME's px (it carries the frame's
   *  own page zoom); the map's plane carries no zoom, so it is inset in real css px. The two edges
   *  land on the same column of pixels or the map and the interface disagree about the window. */
  it('is inset past the dock, on the same travel the frame takes', async () => {
    act(() => { useEditorStore.setState({ assistantPinned: true }); });
    mountShell();
    await screen.findByTestId('shell-assistant-panel');
    const frameZoom = parseFloat(plane().style.zoom);
    expect(parseFloat(mapPlane().style.left))
      .toBeCloseTo(parseFloat(plane().style.left) * frameZoom, 6);
    expect(parseFloat(mapPlane().style.left)).toBeGreaterThan(0);
    // And the screen's own shading starts where the workspace does, on the same distance.
    expect(screen.getByTestId('shell-vignette').style.left).toBe(mapPlane().style.left);
  });
});

describe('the docked column', () => {
  /** THE GROUND DOES NOT MOVE. The desk holds the window's own left, top and bottom edges and stands
   *  at the bottom of the ladder; what travels is the sheet of interface over it. */
  it('stands at the window\'s left edge, from top to bottom, beneath everything', async () => {
    act(() => { useEditorStore.setState({ assistantPinned: true }); });
    mountShell();
    const wrapper = await screen.findByTestId('shell-assistant-panel');
    expect(wrapper.style.left).toBe(`${PINNED_PANEL.edge}px`);
    expect(wrapper.style.top).toBe('0px');
    expect(wrapper.style.bottom).toBe('0px');
    expect(wrapper.style.zIndex).toBe(String(z.ground));
    // Beneath the map, which is the bottom of the sheet lying on it.
    expect(z.ground).toBeLessThan(z.paper);
    expect(screen.getByTestId('shell-map-plane').style.zIndex).toBe(String(z.paper));
  });

  it('is the content column plus its control gutter, and reads as ground rather than as a card', async () => {
    act(() => { useEditorStore.setState({ assistantPinned: true }); });
    mountShell();
    await screen.findByTestId('shell-assistant-panel');
    const plate = screen.getByTestId('panel-shell');
    // Wider than the free plate by exactly the gutter, and the CONTENT takes the whole of it: the
    // padding stays the plate's own on all four edges, and the buttons' seat is carved out of the
    // desk band alone, so nothing below the dock band gives the gutter's width back.
    expect(plate.style.width).toBe(`${PANEL_WIDTH + DOCK_CHROME_W}px`);
    expect(plate.style.paddingRight).toBe(plate.style.paddingLeft);
    expect(parseFloat(plate.style.paddingLeft)).toBe(PANEL_PLATE_PAD);
    // NO CORNER ROUNDS: three edges are the window's own and the fourth is under the sheet, so there
    // is nothing behind any of them to round against.
    expect(parseFloat(plate.style.borderRadius)).toBe(0);
    // And the outline survives only on the one edge where this surface meets another.
    expect(parseFloat(plate.style.borderRightWidth)).toBeGreaterThan(0);
    expect(plate.style.borderTopWidth).toBe('0px');
    expect(plate.style.borderBottomWidth).toBe('0px');
    expect(plate.style.borderLeftWidth).toBe('0px');
    // The height is the caller's cap, which docked is the window itself.
    expect(plate.style.height).toBe(PINNED_PANEL.height);
    expect(plate.style.minHeight).toBe('0');
  });

  /**
   * THE GROUND IS SQUARE IN BOTH DECLARATIONS THAT COULD ROUND IT.
   *
   * The radius is one; the CLIP the entrance wipe rides is the other, and it outlives the wipe — an
   * `inset(… round 28px)` clips nothing but the corners, forever, so a docked plate reached the
   * window's edges and still showed the page through four rounded notches.
   */
  it('carries no corner in its clip either, at either side', async () => {
    for (const side of ['left', 'right'] as const) {
      act(() => { useEditorStore.setState({ assistantPinned: true, assistantDockSide: side }); });
      mountShell();
      await screen.findByTestId('shell-assistant-panel');
      const clip = screen.getByTestId('panel-shell').style.clipPath;
      expect(clip, side).not.toBe('');
      expect(clip, side).not.toContain('round');
      cleanup();
    }
  });

  /** THE FLOATING PLATE IS A CARD AND KEEPS ITS CORNER, in the radius and in the clip alike. */
  it('rounds both while it is free', async () => {
    mountShell();
    await screen.findByTestId('shell-assistant-panel');
    const plate = screen.getByTestId('panel-shell');
    expect(parseFloat(plate.style.borderRadius)).toBeGreaterThan(0);
  });

  /** THE FLOATING PANEL IS NOT THE GROUND. Free, it stands OVER the map as chrome does. */
  it('stands over the map while it is free', async () => {
    mountShell();
    const wrapper = await screen.findByTestId('shell-assistant-panel');
    expect(Number(wrapper.style.zIndex)).toBeGreaterThan(z.paper);
  });

  it('keeps the frame\'s own grid while it stands free', async () => {
    mountShell();
    const wrapper = await screen.findByTestId('shell-assistant-panel');
    expect(wrapper.style.left).toBe(`${PANEL_LEFT}px`);
    expect(screen.getByTestId('panel-shell').style.height).toBe('');
  });
});

/**
 * PINNING IS A SEQUENCE, NOT A SWITCH, and these are its beats.
 *
 * ARRIVING at a dock is ONE: the floating panel and the character leave together — no morph — and the
 * ground is then simply revealed by the slide. LEAVING one is TWO: the sheet comes back over the
 * ground, and then the GROUND goes, under a sheet that is covering all of it, so the floating panel is
 * mounted fresh afterwards and unfolds from her corner as a press opens it. A change of SIDE is the
 * first of those alone, the ground crossing the window while it is covered.
 *
 * Under reduced motion there are no beats to be in, and this file mounts under
 * `reducedMotion="always"`, so the ORDER is asserted from the stage itself.
 */
describe('the pin sequence', () => {
  afterEach(() => { vi.useRealTimers(); });

  const stage = (wrapper: typeof MotionOnly) => renderHook(() => {
    useDockDriver();
    return useDockStage();
  }, { wrapper });

  it('lands every half in one frame where motion is reduced', () => {
    const { result } = stage(MotionOnly);
    expect(result.current).toEqual({ place: 'free', sheetAside: false, aside: 0, side: 'left' });
    act(() => { useEditorStore.setState({ assistantPinned: true, assistantOpen: true }); });
    // Reduced motion: no beat, so the desk is standing and the sheet is already off it.
    expect(result.current).toEqual({ place: 'ground', sheetAside: true, aside: 1, side: 'left' });
    act(() => { useEditorStore.setState({ assistantDockSide: 'right' }); });
    expect(result.current).toEqual({ place: 'ground', sheetAside: true, aside: 1, side: 'right' });
    act(() => { useEditorStore.setState({ assistantPinned: false }); });
    expect(result.current).toEqual({ place: 'free', sheetAside: false, aside: 0, side: 'right' });
  });

  it('takes one beat to arrive at a dock and two to leave one', () => {
    vi.useFakeTimers();
    const { result } = stage(FullMotion);
    act(() => { useEditorStore.setState({ assistantPinned: true, assistantOpen: true }); });
    // ARRIVING, and the one beat: the floating pair is LEAVING, watched, over a sheet that has not
    // moved at all.
    expect(result.current.place).toBe('leaving');
    expect(result.current.sheetAside).toBe(false);
    expect(result.current.aside).toBe(0);
    act(() => { vi.advanceTimersByTime(seconds('panel.close') * 1000 + 1); });
    // THEN: the desk stands and the sheet is told to slide off it.
    expect(result.current.place).toBe('ground');
    expect(result.current.sheetAside).toBe(true);

    act(() => { useEditorStore.setState({ assistantPinned: false }); });
    // LEAVING, beat one: the sheet comes back over a desk that is still standing.
    expect(result.current.place).toBe('ground');
    expect(result.current.sheetAside).toBe(false);
    act(() => { vi.advanceTimersByTime(seconds('panel.pin.slide') * 1000 + 1); });
    // Beat two: NEITHER FORM IS STANDING, and this one is not watched — the sheet covers all of it, so
    // the floating form stands FOLDED and takes that state instantly, which is what gives the entrance
    // that follows something to unfold from.
    expect(result.current.place).toBe('folded');
    expect(result.current.aside).toBe(0);
    act(() => { vi.advanceTimersByTime(seconds('panel.close') * 1000 + 1); });
    expect(result.current.place).toBe('free');
  });

  /** A CHANGE OF SIDE IS THE RETURN AND THEN THE SLIDE AGAIN, with the ground crossing the window
   *  between the two while the sheet is covering every part of it. Nothing travels between layers. */
  it('crosses the window under the sheet when the side changes', () => {
    vi.useFakeTimers();
    const { result } = stage(FullMotion);
    act(() => { useEditorStore.setState({ assistantPinned: true, assistantOpen: true }); });
    act(() => { vi.advanceTimersByTime(seconds('panel.close') * 1000 + 1); });
    expect(result.current).toMatchObject({ place: 'ground', sheetAside: true, side: 'left' });

    act(() => { useEditorStore.getState().setAssistantDockSide('right'); });
    // The sheet returns over the end it is LEAVING, so the ground it is covering is still the old one.
    expect(result.current).toMatchObject({ place: 'ground', sheetAside: false, side: 'left' });
    act(() => { vi.advanceTimersByTime(outSeconds('panel.pin.cross') * 1000 + 1); });
    // And then the ground is at the other end with the sheet told to slide off it the other way.
    expect(result.current).toMatchObject({ place: 'ground', sheetAside: true, side: 'right' });
  });

  /** THE BEAT IS RIGHT AT RENDER, not one commit later. The settled answer is derived from the store,
   *  so a beat published from an effect leaves one painted frame of the panel at its docked geometry
   *  before its floating exit has begun — which is the jump the sequence exists to prevent. */
  it('is in its first beat on the very render the intent changes', () => {
    vi.useFakeTimers();
    const { result } = stage(FullMotion);
    act(() => { useEditorStore.setState({ assistantPinned: true, assistantOpen: true }); });
    expect(result.current.place).toBe('leaving');
  });

  /**
   * A CHANGE OF SIDE IS ONE CROSSING, AND ITS TWO HALVES READ ONE DECLARATION (`panel.pin.cross`): the
   * return accelerates away from the end it is leaving and the departure lands on the new one, so the
   * middle is a pass rather than a stop. The beat's clock and the sheet's own tween take the same half
   * of that declaration, or the ground changes ends a frame off the sheet covering it.
   */
  it('crosses on the two halves of one declaration', () => {
    vi.useFakeTimers();
    const { result } = stage(FullMotion);
    act(() => { useEditorStore.setState({ assistantPinned: true, assistantOpen: true }); });
    act(() => { vi.advanceTimersByTime(seconds('panel.close') * 1000 + 1); });

    act(() => { useEditorStore.getState().setAssistantDockSide('right'); });
    // The first half is the LEAVE's length, not the whole entry's.
    act(() => { vi.advanceTimersByTime(outSeconds('panel.pin.cross') * 1000 - 2); });
    expect(result.current).toMatchObject({ sheetAside: false, side: 'left' });
    act(() => { vi.advanceTimersByTime(3); });
    expect(result.current).toMatchObject({ sheetAside: true, side: 'right' });
    // And the second is the landing's.
    act(() => { vi.advanceTimersByTime(seconds('panel.pin.cross') * 1000 - 2); });
    act(() => { vi.advanceTimersByTime(3); });
    expect(result.current).toMatchObject({ place: 'ground', sheetAside: true, side: 'right' });
  });
});

describe('the dock control', () => {
  it('stands on the plate in both modes and reports the live state', async () => {
    mountShell();
    await screen.findByTestId('shell-assistant-panel');
    const free = screen.getByTestId('dock-pin');
    expect(free.getAttribute('aria-label')).toBe(translateFor('en', 'agent3.pin_dock'));
    act(() => { fireEvent.click(free); });
    expect(useEditorStore.getState().assistantPinned).toBe(true);
    expect(screen.getByTestId('dock-pin').getAttribute('aria-label'))
      .toBe(translateFor('en', 'agent3.pin_undock'));
  });

  it('writes the intent through, so the next session opens the way this one ended', async () => {
    mountShell();
    await screen.findByTestId('shell-assistant-panel');
    act(() => { fireEvent.click(screen.getByTestId('dock-pin')); });
    expect(backing.get(PREFS.assistantPinned.key)).toBe('1');
    act(() => { fireEvent.click(screen.getByTestId('dock-pin')); });
    expect(backing.get(PREFS.assistantPinned.key)).toBe('0');
  });

  /** A CONTROL THAT CANNOT APPLY STANDS AND SAYS SO. Going away would take its own explanation with
   *  it and move the row under the hand that was reaching for it. */
  it('refuses in place in a window with no room, and says why', async () => {
    widen(1000);
    mountShell();
    await screen.findByTestId('shell-assistant-panel');
    const pin = screen.getByTestId('dock-pin') as HTMLButtonElement;
    expect(pin.disabled).toBe(true);
    expect(pin.getAttribute('aria-label')).toBe(translateFor('en', 'agent3.pin_no_room'));
  });

  /** THE INTENT SURVIVES THE WINDOW. A narrow window stands the panel free and docks it again when
   *  the room comes back, which is what makes the preference a memory rather than a switch. */
  it('sets the panel free in a narrow window and docks it again when the room returns', async () => {
    act(() => { useEditorStore.setState({ assistantPinned: true }); });
    mountShell();
    await screen.findByTestId('shell-assistant-panel');
    expect(plane().style.left).toBe(`${PINNED_COLUMN_W}px`);
    widen(1000);
    expect(plane().style.left).toBe('0px');
    expect(useEditorStore.getState().assistantPinned).toBe(true);
    widen(1600);
    expect(plane().style.left).toBe(`${PINNED_COLUMN_W}px`);
  });
});

/**
 * THE SIDE IS PART OF THE REMEMBERED INTENT, and the layout is the same layout mirrored: the ground's
 * near edge, the sheet's inset, the seam the outline survives on and the gutter the two controls stand
 * in are all one side's arithmetic read the other way round. Nothing here is a second layout.
 */
describe('the dock at the other end of the window', () => {
  const docked = (side: 'left' | 'right') => {
    act(() => { useEditorStore.setState({ assistantPinned: true, assistantDockSide: side }); });
    return mountShell();
  };

  it('holds that side\'s own edge and insets the sheet from it', async () => {
    docked('right');
    const wrapper = await screen.findByTestId('shell-assistant-panel');
    expect(wrapper.style.right).toBe(`${PINNED_PANEL.edge}px`);
    expect(wrapper.style.left).toBe('');
    expect(plane().style.right).toBe(`${PINNED_COLUMN_W}px`);
    expect(plane().style.left).toBe('0px');
    // And the map's plane and the screen's own shading mirror with it.
    expect(parseFloat(screen.getByTestId('shell-map-plane').style.right)).toBeGreaterThan(0);
    expect(screen.getByTestId('shell-map-plane').style.left).toBe('0px');
    expect(screen.getByTestId('shell-vignette').style.right)
      .toBe(screen.getByTestId('shell-map-plane').style.right);
  });

  it('publishes the width on the edge it stands at, and zero on the other', async () => {
    docked('right');
    await screen.findByTestId('shell-assistant-panel');
    const root = document.documentElement.style;
    expect(root.getPropertyValue('--pin-dock-right')).toBe(`${PINNED_DOCK_REF_W}px`);
    expect(root.getPropertyValue('--pin-dock-left')).toBe('0px');
  });

  it('puts the seam at the edge that faces the work, and the controls at the right regardless', async () => {
    docked('right');
    await screen.findByTestId('shell-assistant-panel');
    const plate = screen.getByTestId('panel-shell');
    expect(parseFloat(plate.style.borderLeftWidth)).toBeGreaterThan(0);
    expect(plate.style.borderRightWidth).toBe('0px');
    // The padding does not mirror: the content column takes the same whole width at either end.
    expect(plate.style.paddingLeft).toBe(plate.style.paddingRight);
    // The two controls stand stacked at the RIGHT in both dock modes — same spot, no mirroring.
    const cluster = screen.getByTestId('desk-pin');
    expect(cluster.style.flexDirection).toBe('column');
    expect(cluster.style.right).not.toBe('');
    expect(cluster.style.left).toBe('');
  });

  it('offers the switch only while it is docked, and offers the end it is not at', async () => {
    mountShell();
    await screen.findByTestId('shell-assistant-panel');
    // FREE there is no side to switch: the panel stands on the frame's grid.
    expect(screen.queryByTestId('dock-switch')).toBeNull();
    act(() => { fireEvent.click(screen.getByTestId('dock-pin')); });
    const switcher = screen.getByTestId('dock-switch');
    expect(switcher.getAttribute('aria-label')).toBe(translateFor('en', 'agent3.dock_switch_right'));
    act(() => { fireEvent.click(switcher); });
    expect(useEditorStore.getState().assistantDockSide).toBe('right');
    expect(screen.getByTestId('dock-switch').getAttribute('aria-label'))
      .toBe(translateFor('en', 'agent3.dock_switch_left'));
  });

  it('remembers the side, so the next session opens at the end this one ended at', async () => {
    mountShell();
    await screen.findByTestId('shell-assistant-panel');
    act(() => { fireEvent.click(screen.getByTestId('dock-pin')); });
    act(() => { fireEvent.click(screen.getByTestId('dock-switch')); });
    expect(backing.get(PREFS.assistantDockSide.key)).toBe('right');
  });

  /** THE GROUND DRIFTS UNDER THE SHEET, in the direction the sheet is going, and it settles flush with
   *  it. Mirrored: a dock at the right drifts the other way, by the same fraction of the same width. */
  it('drifts the ground the same distance the other way', async () => {
    for (const side of ['left', 'right'] as const) {
      docked(side);
      await screen.findByTestId('shell-assistant-panel');
      const settled = screen.getByTestId('shell-assistant-panel').style.transform;
      // Settled, the two planes are flush: no drift left over.
      expect(settled, side).toBe('');
      cleanup();
    }
  });
});

/**
 * A MODAL TAKES THE WHOLE APP OVER AND STANDS OVER THE WORK, which is two facts rather than one: the
 * backdrop reaches the dock (the overlay lock has to, or the app's settings and the panel's composer
 * would both be reachable) while the CARD is centred on the interface beside it.
 */
describe('the chrome stands over the interface, not over the dock', () => {
  it('dims the whole window and centres the card past the dock', () => {
    expect(cozyOverlay.inset).toBe(0);
    // In REAL css px: the backdrop is the one surface here that does not carry the chrome's `zoom`.
    expect(cozyOverlay.paddingLeft).toBe('var(--pin-dock-left-px, 0px)');
    expect(cozyOverlay.paddingRight).toBe('var(--pin-dock-right-px, 0px)');
  });
});

describe('the bound the dock is offered inside', () => {
  it('is the fit floor\'s own arithmetic', () => {
    expect(hasPinRoom(pinRoomFloor())).toBe(true);
    expect(hasPinRoom(pinRoomFloor() - 0.5)).toBe(false);
  });

  it('holds at every window the frame is judged in', () => {
    for (const w of [1024, 1052, 1280, 1366, 1440, 1600, 1920, 2560]) {
      expect(hasPinRoom(w), `${w}px`).toBe(w >= pinRoomFloor());
    }
  });
});

/**
 * A CHANGE OF FORM IS NOT A TRAVEL, AND THE DISTANCE IS WHY.
 *
 * The floating panel collapses onto her button and that travel is bounded by her own box
 * (`SEAT_TRAVEL_MAX`) — one form gathering onto one control. A docked desk is at the window's own side
 * edge, which is the dock's whole width away, so nothing about it can be the same gesture: the two forms
 * live on different layers and the sequence hands one to the other rather than moving anything between
 * them.
 */
describe('a fold is told from a change of form by the distance', () => {
  const travelTo = (seat: { left: number; top: number }) => Math.hypot(
    seat.left - CHARACTER_SEAT.left,
    seat.top - CHARACTER_SEAT.top,
  );

  it('keeps the free panel\'s own fold inside her box', () => {
    // The free desk's seat: the column's own left edge and top, plus the plate's padding.
    expect(travelTo({ left: PANEL_LEFT + PANEL_PLATE_PAD, top: PANEL_TOP + PANEL_PLATE_PAD }))
      .toBeLessThanOrEqual(SEAT_TRAVEL_MAX);
  });

  it('puts a docked desk far outside it, on either side', () => {
    // Docked left the seat is at the window's own corner; docked right it is a dock's width across.
    expect(travelTo({ left: PANEL_PLATE_PAD, top: PANEL_PLATE_PAD }))
      .toBeGreaterThan(SEAT_TRAVEL_MAX);
    expect(travelTo({ left: PINNED_DOCK_REF_W + PANEL_PLATE_PAD, top: PANEL_PLATE_PAD }))
      .toBeGreaterThan(SEAT_TRAVEL_MAX);
  });
});

/**
 * A COLLAPSE OVER A DOCK IS COVERED, NOT PLAYED. Closing a docked panel starts the same two-beat
 * leave a dock change has: the sheet comes back over the ground first, and only under a sheet
 * covering the whole window does the form go. Unmounted on the press instead, the window-tall ground
 * played the FLOATING exit in plain view — folding to its own top-left corner while the returning
 * sheet was still half way across the strip it left empty.
 */
describe('a collapse over a dock', () => {
  const realAnimate = (Element.prototype as unknown as { animate?: unknown }).animate;
  beforeEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (Element.prototype as any).animate = () => ({ cancel: () => {}, finish: () => {}, playState: 'idle' });
  });
  afterEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (Element.prototype as any).animate = realAnimate;
  });

  it('keeps the ground standing, live, while the sheet comes back over it', async () => {
    act(() => { useEditorStore.setState({ assistantPinned: true, assistantOpen: true }); });
    render(
      <FullMotion>
        <I18nProvider>
          <Shell onRestoreSession={() => {}}><div data-testid="map-views" /></Shell>
        </I18nProvider>
      </FullMotion>,
    );
    await screen.findByTestId('shell-assistant-panel');
    act(() => { useEditorStore.setState({ assistantOpen: false }); });

    // Past the floating exit's own length, solidly inside the sheet's return: the ground must still
    // be standing in its live docked form, not an exiting clone of the free card.
    await new Promise((resolve) => { setTimeout(resolve, seconds('panel.close') * 1000 + 60); });
    const plate = screen.getByTestId('panel-shell');
    expect(plate.style.width).toBe(`${PANEL_WIDTH + DOCK_CHROME_W}px`);

    // Once the sheet has covered it and the folded beat has passed, the panel goes.
    await waitFor(() => expect(screen.queryByTestId('panel-shell')).toBeNull(), { timeout: 4000 });
  }, 20_000);
});
