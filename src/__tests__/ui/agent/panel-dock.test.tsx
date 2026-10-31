// @vitest-environment jsdom
/**
 * The panel docked in the real shell: the frame's plane is inset by the column's width and is the box
 * its clusters place against while passing map presses through; the column stands the window's full
 * height; the control reports the live state. The pref is an intent, so a window too narrow for the
 * dock sets the panel free and forgets nothing.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { MotionConfig } from 'framer-motion';
import type { ReactNode } from 'react';

import { I18nProvider, translateFor } from '../../../i18n/context';
import { useEditorStore } from '../../../state/store';
import { PREFS } from '../../../platform/storage/prefs';
import { TOUR_OFFERED, TOUR_SEEN_KEY } from '../../_support/tour';
import { Shell } from '../../../ui/shell/Shell';
import {
  CHARACTER_SEAT, DOCK_CHROME_W, PANEL_LEFT, PANEL_PLATE_PAD, PANEL_TOP, PINNED_COLUMN_W,
  PINNED_DOCK_REF_W, PINNED_PANEL, hasPinRoom,
} from '../../../ui/shell/panel-frame';
import { FIT_FLOOR, FIT_REF } from '../../../ui/design/scale';
import { PANEL_WIDTH } from '../../../ui/agent/panel-skin';
import { z } from '../../../ui/design/styles';
import { ModalShell } from '../../../ui/primitives/ModalShell';
import { resolveCss } from '../shell/_resolve-css';
import { outSeconds, seconds } from '../../../ui/design/motion';
import { useDockDriver, useDockStage } from '../../../ui/shell/use-dock';

/** The narrowest window the dock fits in at UI zoom 1: the frame beside it at the fit floor. */
const PIN_ROOM_FLOOR = FIT_FLOOR * (FIT_REF.w + PINNED_DOCK_REF_W);
/** The character travels at most her own folded width between her seats. */
const SEAT_TRAVEL_MAX = CHARACTER_SEAT.w;

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

/** Motion wrappers for the dock-stage harness below: reduced, and full for stepping beats on a fake
 *  clock. */
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

/** The frame's plane: the element carrying the frame's zoom, the veil's parent. */
function plane(): HTMLElement {
  return screen.getByTestId('shell-frame-veil').parentElement as HTMLElement;
}

/** The panel is a lazy chunk; its first render compiles the assistant graph, paid once here. */
beforeAll(async () => {
  backing.set(TOUR_SEEN_KEY, TOUR_OFFERED);
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
    // The `fixed` clusters inside resolve against this box, so the dock moves them all with one number.
    expect(box.style.contain).toBe('layout');
    // A full-window box would take every press the map is meant to get.
    expect(box.style.pointerEvents).toBe('none');
  });

  it('is inset by the column\'s own width while the panel is docked', async () => {
    act(() => { useEditorStore.setState({ assistantPinned: true }); });
    mountShell();
    await screen.findByTestId('shell-assistant-panel');
    expect(plane().style.left).toBe(`${PINNED_COLUMN_W}px`);
    // The dock's width in chrome units, published per edge for surfaces outside this frame.
    expect(document.documentElement.style.getPropertyValue('--pin-dock-left')).toBe(`${PINNED_DOCK_REF_W}px`);
    expect(document.documentElement.style.getPropertyValue('--pin-dock-right')).toBe('0px');
  });

  /** The travel rides the one animated fraction the fit also rides; a CSS transition on a plane would
   *  be a second clock, and the interface would rescale and move on different frames. */
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

  /** A folded panel docks nothing, but the intent is kept for the next open. */
  it('un-insets while the panel is away, without forgetting the dock', async () => {
    act(() => { useEditorStore.setState({ assistantPinned: true }); });
    mountShell();
    await screen.findByTestId('shell-assistant-panel');
    act(() => { useEditorStore.getState().setAssistantOpen(false); });
    expect(plane().style.left).toBe('0px');
    expect(useEditorStore.getState().assistantPinned).toBe(true);
  });
});

/** Docking insets the map's plane past the dock as it does the frame's, so both views size and place
 *  themselves by what is left of the window. */
describe('the map moves with the interface', () => {
  const mapPlane = () => screen.getByTestId('shell-map-plane');

  it('holds the views, and holds them the way the frame holds its clusters', async () => {
    mountShell();
    await screen.findByTestId('shell-assistant-panel');
    expect(mapPlane().contains(screen.getByTestId('map-views'))).toBe(true);
    expect(mapPlane().style.contain).toBe('layout');
    expect(mapPlane().style.left).toBe('0px');
  });

  /** The frame's plane is inset in its own zoomed px and the map's in real CSS px; both edges land on
   *  the same column of pixels. */
  it('is inset past the dock, on the same travel the frame takes', async () => {
    act(() => { useEditorStore.setState({ assistantPinned: true }); });
    mountShell();
    await screen.findByTestId('shell-assistant-panel');
    const frameZoom = parseFloat(plane().style.zoom);
    expect(parseFloat(mapPlane().style.left))
      .toBeCloseTo(parseFloat(plane().style.left) * frameZoom, 6);
    expect(parseFloat(mapPlane().style.left)).toBeGreaterThan(0);
    // The vignette starts where the workspace does.
    expect(screen.getByTestId('shell-vignette').style.left).toBe(mapPlane().style.left);
  });
});

describe('the docked column', () => {
  /** The docked desk holds the window's left, top and bottom edges at the bottom of the z ladder;
   *  what travels is the interface sheet over it. */
  it('stands at the window\'s left edge, from top to bottom, beneath everything', async () => {
    act(() => { useEditorStore.setState({ assistantPinned: true }); });
    mountShell();
    const wrapper = await screen.findByTestId('shell-assistant-panel');
    expect(wrapper.style.left).toBe(`${PINNED_PANEL.edge}px`);
    expect(wrapper.style.top).toBe('0px');
    expect(wrapper.style.bottom).toBe('0px');
    expect(wrapper.style.zIndex).toBe(String(z.ground));
    expect(z.ground).toBeLessThan(z.paper);
    expect(screen.getByTestId('shell-map-plane').style.zIndex).toBe(String(z.paper));
  });

  it('is the content column plus its control gutter, and reads as ground rather than as a card', async () => {
    act(() => { useEditorStore.setState({ assistantPinned: true }); });
    mountShell();
    await screen.findByTestId('shell-assistant-panel');
    const plate = screen.getByTestId('panel-shell');
    // Wider than the free plate by the gutter, with the plate's own padding on every edge: the
    // buttons' seat is carved from the desk band alone.
    expect(plate.style.width).toBe(`${PANEL_WIDTH + DOCK_CHROME_W}px`);
    expect(plate.style.paddingRight).toBe(plate.style.paddingLeft);
    expect(parseFloat(plate.style.paddingLeft)).toBe(PANEL_PLATE_PAD);
    // Square: three edges are the window's and the fourth is under the sheet.
    expect(parseFloat(plate.style.borderRadius)).toBe(0);
    // The outline stays only on the edge that meets the sheet.
    expect(parseFloat(plate.style.borderRightWidth)).toBeGreaterThan(0);
    expect(plate.style.borderTopWidth).toBe('0px');
    expect(plate.style.borderBottomWidth).toBe('0px');
    expect(plate.style.borderLeftWidth).toBe('0px');
    // Docked, the caller's height cap is the window.
    expect(plate.style.height).toBe(PINNED_PANEL.height);
    expect(plate.style.minHeight).toBe('0');
  });

  /** The entrance wipe's clip outlives the wipe, so a rounded `inset()` would leave four notches in a
   *  docked plate. */
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

  it('rounds both while it is free', async () => {
    mountShell();
    await screen.findByTestId('shell-assistant-panel');
    const plate = screen.getByTestId('panel-shell');
    expect(parseFloat(plate.style.borderRadius)).toBeGreaterThan(0);
  });

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
 * Pinning is a sequence of beats. Arriving at a dock is one: the floating panel and the character
 * leave, then the slide reveals the ground. Leaving is two: the sheet returns over the ground, then
 * the ground goes under it and the floating panel mounts fresh. A change of side is the return and
 * the slide again, the ground crossing the window while covered.
 */
describe('the pin sequence', () => {
  afterEach(() => { vi.useRealTimers(); });

  const stage = (wrapper: typeof MotionOnly) => renderHook(() => {
    useDockDriver();
    return useDockStage();
  }, { wrapper });

  it('lands every half in one frame where motion is reduced', () => {
    const { result } = stage(MotionOnly);
    expect(result.current).toEqual({ place: 'free', sheetAside: false, aside: 0, edge: 'left' });
    act(() => { useEditorStore.setState({ assistantPinned: true, assistantOpen: true }); });
    // No beat: the desk stands and the sheet is already off it.
    expect(result.current).toEqual({ place: 'ground', sheetAside: true, aside: 1, edge: 'left' });
    act(() => { useEditorStore.setState({ assistantDockSide: 'right' }); });
    expect(result.current).toEqual({ place: 'ground', sheetAside: true, aside: 1, edge: 'right' });
    act(() => { useEditorStore.setState({ assistantPinned: false }); });
    expect(result.current).toEqual({ place: 'free', sheetAside: false, aside: 0, edge: 'right' });
  });

  it('takes one beat to arrive at a dock and two to leave one', () => {
    vi.useFakeTimers();
    const { result } = stage(FullMotion);
    act(() => { useEditorStore.setState({ assistantPinned: true, assistantOpen: true }); });
    // The one beat: the floating pair leaves over a sheet that has not moved.
    expect(result.current.place).toBe('leaving');
    expect(result.current.sheetAside).toBe(false);
    expect(result.current.aside).toBe(0);
    act(() => { vi.advanceTimersByTime(seconds('panel.close') * 1000 + 1); });
    // Then the desk stands and the sheet slides off it.
    expect(result.current.place).toBe('ground');
    expect(result.current.sheetAside).toBe(true);

    act(() => { useEditorStore.setState({ assistantPinned: false }); });
    // Leaving, beat one: the sheet returns over the standing desk.
    expect(result.current.place).toBe('ground');
    expect(result.current.sheetAside).toBe(false);
    act(() => { vi.advanceTimersByTime(seconds('panel.pin.slide') * 1000 + 1); });
    // Beat two, under the covering sheet: the floating form stands folded, so its entrance has
    // something to unfold from.
    expect(result.current.place).toBe('folded');
    expect(result.current.aside).toBe(0);
    act(() => { vi.advanceTimersByTime(seconds('panel.close') * 1000 + 1); });
    expect(result.current.place).toBe('free');
  });

  it('crosses the window under the sheet when the side changes', () => {
    vi.useFakeTimers();
    const { result } = stage(FullMotion);
    act(() => { useEditorStore.setState({ assistantPinned: true, assistantOpen: true }); });
    act(() => { vi.advanceTimersByTime(seconds('panel.close') * 1000 + 1); });
    expect(result.current).toMatchObject({ place: 'ground', sheetAside: true, edge: 'left' });

    act(() => { useEditorStore.getState().setAssistantDockSide('right'); });
    // The sheet returns while the ground is still at the old end.
    expect(result.current).toMatchObject({ place: 'ground', sheetAside: false, edge: 'left' });
    act(() => { vi.advanceTimersByTime(outSeconds('panel.pin.cross') * 1000 + 1); });
    // Then the ground is at the other end and the sheet slides off the other way.
    expect(result.current).toMatchObject({ place: 'ground', sheetAside: true, edge: 'right' });
  });

  /** A beat published from an effect would paint one frame at the docked geometry before the floating
   *  exit begins. */
  it('is in its first beat on the very render the intent changes', () => {
    vi.useFakeTimers();
    const { result } = stage(FullMotion);
    act(() => { useEditorStore.setState({ assistantPinned: true, assistantOpen: true }); });
    expect(result.current.place).toBe('leaving');
  });

  /** A side change's two halves read one declaration (`panel.pin.cross`), so the middle is a pass,
   *  not a stop; the beat's clock and the sheet's tween take the same halves. */
  it('crosses on the two halves of one declaration', () => {
    vi.useFakeTimers();
    const { result } = stage(FullMotion);
    act(() => { useEditorStore.setState({ assistantPinned: true, assistantOpen: true }); });
    act(() => { vi.advanceTimersByTime(seconds('panel.close') * 1000 + 1); });

    act(() => { useEditorStore.getState().setAssistantDockSide('right'); });
    // The first half is the leave's length.
    act(() => { vi.advanceTimersByTime(outSeconds('panel.pin.cross') * 1000 - 2); });
    expect(result.current).toMatchObject({ sheetAside: false, edge: 'left' });
    act(() => { vi.advanceTimersByTime(3); });
    expect(result.current).toMatchObject({ sheetAside: true, edge: 'right' });
    // The second is the landing's.
    act(() => { vi.advanceTimersByTime(seconds('panel.pin.cross') * 1000 - 2); });
    act(() => { vi.advanceTimersByTime(3); });
    expect(result.current).toMatchObject({ place: 'ground', sheetAside: true, edge: 'right' });
  });
});

describe('the dock control', () => {
  it('stands on the plate in both modes and reports the live state', async () => {
    mountShell();
    await screen.findByTestId('shell-assistant-panel');
    const free = screen.getByTestId('dock-pin');
    expect(free.getAttribute('aria-label')).toBe(translateFor('en', 'agent.pin_dock'));
    act(() => { fireEvent.click(free); });
    expect(useEditorStore.getState().assistantPinned).toBe(true);
    expect(screen.getByTestId('dock-pin').getAttribute('aria-label'))
      .toBe(translateFor('en', 'agent.pin_undock'));
  });

  it('writes the intent through, so the next session opens the way this one ended', async () => {
    mountShell();
    await screen.findByTestId('shell-assistant-panel');
    act(() => { fireEvent.click(screen.getByTestId('dock-pin')); });
    expect(backing.get(PREFS.assistantPinned.key)).toBe('1');
    act(() => { fireEvent.click(screen.getByTestId('dock-pin')); });
    expect(backing.get(PREFS.assistantPinned.key)).toBe('0');
  });

  /** A control that cannot apply stays and says why, rather than moving the row under the hand. */
  it('refuses in place in a window with no room, and says why', async () => {
    widen(1000);
    mountShell();
    await screen.findByTestId('shell-assistant-panel');
    const pin = screen.getByTestId('dock-pin') as HTMLButtonElement;
    expect(pin.disabled).toBe(true);
    expect(pin.getAttribute('aria-label')).toBe(translateFor('en', 'agent.pin_no_room'));
  });

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

/** The side is remembered, and a right dock is the left layout mirrored, except the controls, which
 *  stay at the right. */
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
    // The map's plane and the vignette mirror too.
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
    // The two controls stand stacked at the right at either end.
    const cluster = screen.getByTestId('desk-pin');
    expect(cluster.style.flexDirection).toBe('column');
    expect(cluster.style.right).not.toBe('');
    expect(cluster.style.left).toBe('');
  });

  it('offers the switch only while it is docked, and offers the end it is not at', async () => {
    mountShell();
    await screen.findByTestId('shell-assistant-panel');
    // Free, there is no side to switch.
    expect(screen.queryByTestId('dock-switch')).toBeNull();
    act(() => { fireEvent.click(screen.getByTestId('dock-pin')); });
    const switcher = screen.getByTestId('dock-switch');
    expect(switcher.getAttribute('aria-label')).toBe(translateFor('en', 'agent.dock_switch_right'));
    act(() => { fireEvent.click(switcher); });
    expect(useEditorStore.getState().assistantDockSide).toBe('right');
    expect(screen.getByTestId('dock-switch').getAttribute('aria-label'))
      .toBe(translateFor('en', 'agent.dock_switch_left'));
  });

  it('remembers the side, so the next session opens at the end this one ended at', async () => {
    mountShell();
    await screen.findByTestId('shell-assistant-panel');
    act(() => { fireEvent.click(screen.getByTestId('dock-pin')); });
    act(() => { fireEvent.click(screen.getByTestId('dock-switch')); });
    expect(backing.get(PREFS.assistantDockSide.key)).toBe('right');
  });

  it('drifts the ground the same distance the other way', async () => {
    for (const side of ['left', 'right'] as const) {
      docked(side);
      await screen.findByTestId('shell-assistant-panel');
      const settled = screen.getByTestId('shell-assistant-panel').style.transform;
      // Settled, the ground is flush with the sheet.
      expect(settled, side).toBe('');
      cleanup();
    }
  });
});

/** A modal's backdrop covers the dock, so the panel's composer is locked too, while its card centres
 *  on the interface beside the dock. */
describe('the chrome stands over the interface, not over the dock', () => {
  /** The backdrop's side padding, resolved against the dock widths the shell publishes on the root,
   *  since jsdom keeps a `var()` as written. */
  function backdropPadding(backdrop: HTMLElement): { left: number; right: number } {
    const root = document.documentElement.style;
    const vars: Record<string, string> = {};
    for (const name of ['--pin-dock-left-px', '--pin-dock-right-px']) {
      const value = root.getPropertyValue(name);
      if (value !== '') vars[name] = value;
    }
    return {
      left: resolveCss(backdrop.style.paddingLeft || '0px', 900, 1, vars),
      right: resolveCss(backdrop.style.paddingRight || '0px', 900, 1, vars),
    };
  }

  it('centres the card on the interface beside the dock, at either side', async () => {
    for (const side of ['left', 'right'] as const) {
      act(() => { useEditorStore.setState({ assistantPinned: true, assistantDockSide: side }); });
      render(
        <MotionConfig reducedMotion="always">
          <I18nProvider>
            <Shell onRestoreSession={() => {}}><div data-testid="map-views" /></Shell>
            <ModalShell open onClose={() => {}} ariaLabel="Probe"><p>probe</p></ModalShell>
          </I18nProvider>
        </MotionConfig>,
      );
      await screen.findByTestId('shell-assistant-panel');
      const pad = backdropPadding(screen.getByRole('dialog', { name: 'Probe' }).parentElement!);
      // The backdrop pads by the map plane's insets.
      const map = screen.getByTestId('shell-map-plane');
      expect(pad.left, side).toBeCloseTo(parseFloat(map.style.left), 6);
      expect(pad.right, side).toBeCloseTo(parseFloat(map.style.right), 6);
      expect(side === 'left' ? pad.left : pad.right, side).toBeGreaterThan(0);
      cleanup();
    }
  });
});

describe('the bound the dock is offered inside', () => {
  it('is the fit floor\'s own arithmetic', () => {
    expect(hasPinRoom(PIN_ROOM_FLOOR)).toBe(true);
    expect(hasPinRoom(PIN_ROOM_FLOOR - 0.5)).toBe(false);
  });
});

/** The floating panel folds onto the character's button within her own box (`SEAT_TRAVEL_MAX`); a
 *  docked desk is a dock's width away, so the sequence hands one form to the other instead of
 *  moving between them. */
describe('a fold is told from a change of form by the distance', () => {
  const travelTo = (seat: { left: number; top: number }) => Math.hypot(
    seat.left - CHARACTER_SEAT.left,
    seat.top - CHARACTER_SEAT.top,
  );

  it('keeps the free panel\'s own fold inside her box', () => {
    // The free desk's seat: the column's left edge and top, plus the plate's padding.
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

/** Closing a docked panel runs the two-beat leave: the sheet returns over the ground first, and only
 *  then does the form go, rather than the window-tall ground playing the floating exit in view. */
describe('a collapse over a dock', () => {
  const realAnimate = (Element.prototype as unknown as { animate?: unknown }).animate;
  beforeEach(() => {
    (Element.prototype as any).animate = () => ({ cancel: () => {}, finish: () => {}, playState: 'idle' });
  });
  afterEach(() => {
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

    // Past the floating exit's length, inside the sheet's return: the docked form still stands.
    await act(async () => {
      await new Promise((resolve) => { setTimeout(resolve, seconds('panel.close') * 1000 + 60); });
    });
    const plate = screen.getByTestId('panel-shell');
    expect(plate.style.width).toBe(`${PANEL_WIDTH + DOCK_CHROME_W}px`);

    // After the folded beat, the panel goes.
    await waitFor(() => expect(screen.queryByTestId('panel-shell')).toBeNull(), { timeout: 4000 });
  }, 20_000);
});
