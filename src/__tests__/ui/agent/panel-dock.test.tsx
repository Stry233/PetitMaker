// @vitest-environment jsdom
/**
 * The panel docked in the real shell: the pin sequence's beats, the dock control and its live state,
 * the side switch, and the remembered intent.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { MotionConfig } from 'framer-motion';
import type { ReactNode } from 'react';

import { I18nProvider, translateFor } from '../../../i18n/context';
import { useEditorStore } from '../../../state/store';
import { PREFS } from '../../../platform/storage/prefs';
import { TOUR_OFFERED, TOUR_SEEN_KEY } from '../../_support/tour';
import { Shell } from '../../../ui/shell/Shell';
import { PINNED_DOCK_REF_W, hasPinRoom } from '../../../ui/shell/panel-frame';
import { FIT_FLOOR, FIT_REF } from '../../../ui/design/scale-model';
import { outSeconds, seconds } from '../../../ui/design/motion';
import { useDockDriver, useDockStage } from '../../../ui/shell/use-dock';

/** The narrowest window the dock fits in at UI zoom 1: the frame beside it at the fit floor. */
const PIN_ROOM_FLOOR = FIT_FLOOR * (FIT_REF.w + PINNED_DOCK_REF_W);

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

});

/** The side is remembered, and a right dock is the left layout mirrored, except the controls, which
 *  stay at the right. */
describe('the dock at the other end of the window', () => {
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

});

describe('the bound the dock is offered inside', () => {
  it('is the fit floor\'s own arithmetic', () => {
    expect(hasPinRoom(PIN_ROOM_FLOOR)).toBe(true);
    expect(hasPinRoom(PIN_ROOM_FLOOR - 0.5)).toBe(false);
  });
});
