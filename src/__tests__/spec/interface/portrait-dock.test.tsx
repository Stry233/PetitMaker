// @vitest-environment jsdom
/**
 * The assistant on an upright screen: opening it docks it at the window's foot, the map plane and the
 * frame stand above it, and the handle on the seam resizes or closes it. "The map stays visible" is
 * measured: the map plane keeps at least two fifths of the window's height, from the window's top,
 * with the frame's bottom bar inside it, and the dock yields so an open mode's panel has its least room. Positions are read from the styles the planes write, since
 * jsdom has no layout; how it looks is checked in a browser.
 */
import { afterEach, beforeAll, beforeEach, describe, expect } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MotionConfig } from 'framer-motion';
import type { ReactNode } from 'react';
import { spec } from '../../_support/spec';
import { MODE } from '../../../ui/shell/units';
import { BOTTOM_DOCK, DOCK_DEPTH_VAR } from '../../../ui/shell/panel-frame';
import { setStoreState } from '../../_support/store';
import { I18nProvider, translate } from '../../../i18n/context';
import { useEditorStore } from '../../../state/store';
import type { LayoutShape } from '../../../platform/device/layout-shape';
import { GESTURE_TIMING } from '../../../platform/input/gesture-timing';
import { InputModeProvider } from '../../../ui/design/input-mode';
import { DockRefProvider } from '../../../ui/design/scale';
import { useDockRefValue } from '../../../ui/shell/use-dock';
import { Shell } from '../../../ui/shell/Shell';
import { TOUR_OFFERED, TOUR_SEEN_KEY } from '../../_support/tour';

/** The share of the window's height the map keeps above a docked assistant, whatever the handle does:
 *  what the dock's most leaves. */
const MAP_KEEPS = 1 - BOTTOM_DOCK.most;

function sizeWindow(w: number, h: number): void {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: w });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: h });
  act(() => { window.dispatchEvent(new Event('resize')); });
}

function Device({ shape, children }: { shape: LayoutShape; children: ReactNode }) {
  return (
    <MotionConfig reducedMotion="always">
      <InputModeProvider inputMode="touch" shape={shape}><I18nProvider>{children}</I18nProvider></InputModeProvider>
    </MotionConfig>
  );
}

function mount(shape: LayoutShape) {
  const shell = (s: LayoutShape) => <Device shape={s}><DockFit><Shell onRestoreSession={() => {}}><div /></Shell></DockFit></Device>;
  const view = render(shell(shape));
  return { ...view, turn: (s: LayoutShape) => view.rerender(shell(s)) };
}

const mapPlane = () => screen.getByTestId('shell-map-plane');
const framePlane = () => screen.getByTestId('shell-frame-veil').parentElement as HTMLElement;
/** How much of the window's height the map plane covers from the top, in css px. */
const mapHeight = (vh: number) => vh - parseFloat(mapPlane().style.bottom || '0') - parseFloat(mapPlane().style.top || '0');

/** A finger's pointer event at `clientY`; jsdom has no `PointerEvent`, so a mouse event carries its id. */
function finger(type: string, clientY: number): Event {
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientY });
  return Object.assign(e, { pointerId: 1, pointerType: 'touch' });
}

/** Drags the seam's handle `dy` css px down (negative is up) and lets go. */
function dragHandle(dy: number): void {
  const handle = screen.getByRole('separator', { name: translate('agent.dock_resize') });
  fireEvent(handle, finger('pointerdown', 400));
  fireEvent(handle, finger('pointermove', 400 + dy));
  fireEvent(handle, finger('pointerup', 400 + dy));
}

/** The app's one dock fit over the shell, as `App` publishes it. */
function DockFit({ children }: { children: ReactNode }) {
  return <DockRefProvider value={useDockRefValue()}>{children}</DockRefProvider>;
}

/** The panel is a lazy chunk; its first render compiles the assistant graph, paid once here. */
beforeAll(async () => {
  localStorage.setItem(TOUR_SEEN_KEY, TOUR_OFFERED);
  setStoreState({ locale: 'en', assistantOpen: true, assistantPinned: false, tourRunning: false });
  sizeWindow(390, 844);
  mount('portrait');
  await screen.findByTestId('shell-assistant-panel', undefined, { timeout: 30_000 });
  cleanup();
}, 40_000);

beforeEach(() => {
  localStorage.setItem(TOUR_SEEN_KEY, TOUR_OFFERED);
  setStoreState({ locale: 'en', assistantOpen: false, assistantPinned: false, tourRunning: false });
  useEditorStore.getState().setEditMode({ mode: null });
  sizeWindow(390, 844);
});
afterEach(() => { cleanup(); sizeWindow(1024, 768); });

describe('the assistant on an upright screen', () => {
  spec('UI-32', 'opening the assistant at 390x844 docks it below the map and the map stays visible above', async () => {
    mount('portrait');
    expect(mapHeight(844)).toBe(844);
    act(() => { useEditorStore.getState().setAssistantOpen(true); });
    const panel = await screen.findByTestId('shell-assistant-panel');
    // The panel spans the window at its foot; the map plane stands above it from the window's top.
    expect([panel.style.left, panel.style.right, panel.style.bottom]).toEqual(['0px', '0px', '0px']);
    expect(mapPlane().style.top).toBe('0px');
    expect([mapPlane().style.left, mapPlane().style.right]).toEqual(['0px', '0px']);
    const kept = mapHeight(844);
    expect(kept).toBeLessThan(844);
    expect(kept).toBeGreaterThanOrEqual(MAP_KEEPS * 844);
    // The whole frame slides up with the map: its foot meets the map's, and its bottom bar stands inside.
    const frame = framePlane();
    const zoom = parseFloat(frame.style.zoom);
    expect(parseFloat(frame.style.bottom) * zoom).toBeCloseTo(844 - kept, 3);
    const row = document.querySelector<HTMLElement>('[data-placement]')!;
    expect(row.dataset.placement).toBe('bottom');
    // Held from the frame's foot, the row stands in the lower half of the kept map, above the panel.
    expect(parseFloat(row.style.bottom)).toBeGreaterThanOrEqual(0);
    expect((parseFloat(row.style.bottom) + MODE.height) * zoom).toBeLessThan(kept / 2);
    // The mode tiles stay where the map is, not under the panel.
    expect(screen.getByRole('button', { name: translate('mode.object') })).toBeTruthy();
  });

  spec('UI-32', 'the seam\'s handle resizes the dock, and the map keeps three tenths and its frame however far it is dragged up', async () => {
    act(() => { useEditorStore.getState().setAssistantOpen(true); });
    mount('portrait');
    await screen.findByTestId('shell-assistant-panel');
    const before = mapHeight(844);
    // Short of the least the handle keeps the dock to, so the seam lands where the finger let go.
    dragHandle(60);
    expect(mapHeight(844)).toBeCloseTo(before + 60, 3);
    dragHandle(-2000);
    const highest = mapHeight(844);
    expect(highest).toBeLessThan(before + 100);
    expect(highest).toBeGreaterThanOrEqual(MAP_KEEPS * 844);
    // The seam stops where it stopped: neither the share nor the frame's room lets it climb further.
    dragHandle(-2000);
    expect(mapHeight(844)).toBe(highest);
    expect(useEditorStore.getState().assistantOpen).toBe(true);
  });

  spec('UI-32', 'let go short of the close line, the handle keeps the dock at two fifths of the window at least', async () => {
    act(() => { useEditorStore.getState().setAssistantOpen(true); });
    mount('portrait');
    await screen.findByTestId('shell-assistant-panel');
    // From three fifths down to three tenths: under two fifths, above the line that closes it.
    dragHandle(0.3 * 844);
    expect(useEditorStore.getState().assistantOpen).toBe(true);
    expect(mapHeight(844)).toBeCloseTo((1 - 2 / 5) * 844, 3);
  });

  spec('UI-32', 'dragging the handle down to the foot closes the assistant and gives the map the window', async () => {
    act(() => { useEditorStore.getState().setAssistantOpen(true); });
    mount('portrait');
    await screen.findByTestId('shell-assistant-panel');
    dragHandle(2000);
    expect(useEditorStore.getState().assistantOpen).toBe(false);
    expect(mapHeight(844)).toBe(844);
  });

  spec('UI-32', 'an open mode makes the dock yield, and closing it returns the dock to the depth the handle set', async () => {
    // jsdom has no layout: every panel standing on the bar reports one tall height. Whether its first
    // row then shows whole is checked against the real layout (`portrait-dock.e2e.internal.test.ts`).
    const offsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')!;
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
      configurable: true,
      get(this: HTMLElement) { return this.hasAttribute('data-bar-panel') ? 600 : 0; },
    });
    // A scale at which the frame over an open panel needs more than the three fifths the dock leaves.
    const uiZoom = useEditorStore.getState().uiZoom;
    setStoreState({ uiZoom: 1.5 });
    try {
      act(() => { useEditorStore.getState().setAssistantOpen(true); });
      mount('portrait');
      await screen.findByTestId('shell-assistant-panel');
      dragHandle(60);
      const set = mapHeight(844);
      fireEvent.click(screen.getByRole('button', { name: translate('mode.object') }));
      await screen.findByTestId('shell-shelf-grid');
      const yielded = mapHeight(844);
      expect(yielded).toBeGreaterThan(set);
      expect(yielded).toBeGreaterThanOrEqual(MAP_KEEPS * 844);
      // A press on the handle that does not move, or a finger's tap that jitters within its drag
      // threshold, leaves the depth the handle set alone.
      dragHandle(0);
      dragHandle(GESTURE_TIMING.touch.dragThreshold);
      fireEvent.click(screen.getByRole('button', { name: translate('mode.object') }));
      expect(useEditorStore.getState().editMode.mode).toBe(null);
      expect(mapHeight(844)).toBeCloseTo(set, 3);
      // A short drag on a seam the frame has made shallow never closes the assistant, nor replaces the
      // depth the user set, which returns when the panel closes.
      fireEvent.click(screen.getByRole('button', { name: translate('mode.object') }));
      await screen.findByTestId('shell-shelf-grid');
      dragHandle(40);
      expect(useEditorStore.getState().assistantOpen).toBe(true);
      fireEvent.click(screen.getByRole('button', { name: translate('mode.object') }));
      expect(mapHeight(844)).toBeCloseTo(set, 3);
    } finally {
      Object.defineProperty(HTMLElement.prototype, 'offsetHeight', offsetHeight);
      setStoreState({ uiZoom });
    }
  });

  spec('UI-32', 'the dock follows a finger on the seam past its drag threshold, and not a jitter within it', async () => {
    act(() => { useEditorStore.getState().setAssistantOpen(true); });
    mount('portrait');
    await screen.findByTestId('shell-assistant-panel');
    const handle = screen.getByRole('separator', { name: translate('agent.dock_resize') });
    const depth = () => parseFloat(document.documentElement.style.getPropertyValue(DOCK_DEPTH_VAR));
    const settled = depth();
    // The dock is written once a frame, in the frame after the finger moved.
    const move = async (y: number) => {
      fireEvent(handle, finger('pointermove', y));
      await act(() => new Promise<void>((done) => requestAnimationFrame(() => done())));
    };
    fireEvent(handle, finger('pointerdown', 400));
    await move(400 + GESTURE_TIMING.touch.dragThreshold);
    expect(depth()).toBe(settled);
    // Past the threshold the dock's depth follows the finger while it is held, before any release.
    await move(400 + 3 * GESTURE_TIMING.touch.dragThreshold);
    expect(depth()).toBeLessThan(settled);
    await move(401);
    expect(depth()).toBeLessThan(settled);
    expect(depth()).toBeGreaterThan(settled - 2 / 844);
    fireEvent(handle, finger('pointerup', 401));
  });

  spec('UI-32', 'the handle reports a value inside its own range while the dock has yielded', async () => {
    const offsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')!;
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
      configurable: true,
      get(this: HTMLElement) { return this.hasAttribute('data-bar-panel') ? 600 : 0; },
    });
    try {
      act(() => { useEditorStore.getState().setAssistantOpen(true); });
      mount('portrait');
      await screen.findByTestId('shell-assistant-panel');
      fireEvent.click(screen.getByRole('button', { name: translate('mode.object') }));
      await screen.findByTestId('shell-shelf-grid');
      const handle = screen.getByRole('separator', { name: translate('agent.dock_resize') });
      const [min, now, max] = ['aria-valuemin', 'aria-valuenow', 'aria-valuemax'].map((a) => Number(handle.getAttribute(a)));
      expect(now).toBeGreaterThanOrEqual(min!);
      expect(now).toBeLessThanOrEqual(max!);
      // The seam stands at the frame's bound, so the most it can be dragged to is where it is.
      expect(max).toBe(now);
    } finally {
      Object.defineProperty(HTMLElement.prototype, 'offsetHeight', offsetHeight);
    }
  });

  spec('UI-32', 'turned to landscape, the open assistant leaves the foot and the map takes the window\'s height', async () => {
    act(() => { useEditorStore.getState().setAssistantOpen(true); });
    const view = mount('portrait');
    await screen.findByTestId('shell-assistant-panel');
    expect(mapHeight(844)).toBeLessThan(844);
    sizeWindow(844, 390);
    view.turn('landscape');
    expect(mapHeight(390)).toBe(390);
    expect(screen.queryByRole('separator', { name: translate('agent.dock_resize') })).toBeNull();
  });
});
