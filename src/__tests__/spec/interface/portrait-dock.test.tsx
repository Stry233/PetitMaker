// @vitest-environment jsdom
/**
 * The assistant on an upright screen: opening it docks it at the window's foot, and the handle on the
 * seam resizes or closes it. jsdom has no layout, so where the dock and the map stand is checked in a
 * browser.
 */
import { afterEach, beforeAll, beforeEach, describe, expect } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MotionConfig } from 'framer-motion';
import type { ReactNode } from 'react';
import { spec } from '../../_support/spec';
import { DOCK_DEPTH_VAR } from '../../../ui/shell/panel-frame';
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

/** A finger's pointer event at `clientY`; jsdom has no `PointerEvent`, so a mouse event carries its id. */
function finger(type: string, clientY: number): Event {
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientY });
  return Object.assign(e, { pointerId: 1, pointerType: 'touch' });
}

const dockHandle = () => screen.getByRole('separator', { name: translate('agent.dock_resize') });

/** Drags the seam's handle `dy` css px down (negative is up) and lets go. */
function dragHandle(dy: number): void {
  const handle = dockHandle();
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
  spec('UI-32', 'opening the assistant at 390x844 docks it with a seam handle, the mode tiles staying in the bottom bar', async () => {
    mount('portrait');
    act(() => { useEditorStore.getState().setAssistantOpen(true); });
    await screen.findByTestId('shell-assistant-panel');
    expect(dockHandle()).toBeTruthy();
    expect(document.querySelector<HTMLElement>('[data-placement]')!.dataset.placement).toBe('bottom');
    expect(screen.getByRole('button', { name: translate('mode.object') })).toBeTruthy();
  });

  spec('UI-32', 'dragging the seam\'s handle up, however far, never closes the assistant', async () => {
    act(() => { useEditorStore.getState().setAssistantOpen(true); });
    mount('portrait');
    await screen.findByTestId('shell-assistant-panel');
    dragHandle(60);
    dragHandle(-2000);
    dragHandle(-2000);
    expect(useEditorStore.getState().assistantOpen).toBe(true);
  });

  spec('UI-32', 'let go short of the close line, the handle keeps the assistant open', async () => {
    act(() => { useEditorStore.getState().setAssistantOpen(true); });
    mount('portrait');
    await screen.findByTestId('shell-assistant-panel');
    // From three fifths down to three tenths: above the line that closes it.
    dragHandle(0.3 * 844);
    expect(useEditorStore.getState().assistantOpen).toBe(true);
  });

  spec('UI-32', 'dragging the handle down to the foot closes the assistant', async () => {
    act(() => { useEditorStore.getState().setAssistantOpen(true); });
    mount('portrait');
    await screen.findByTestId('shell-assistant-panel');
    dragHandle(2000);
    expect(useEditorStore.getState().assistantOpen).toBe(false);
  });

  spec('UI-32', 'the dock follows a finger on the seam past its drag threshold, and not a jitter within it', async () => {
    act(() => { useEditorStore.getState().setAssistantOpen(true); });
    mount('portrait');
    await screen.findByTestId('shell-assistant-panel');
    const handle = dockHandle();
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
    fireEvent(handle, finger('pointerup', 400 + 3 * GESTURE_TIMING.touch.dragThreshold));
  });

  spec('UI-32', 'turned to landscape, the open assistant leaves the foot and its seam handle goes', async () => {
    act(() => { useEditorStore.getState().setAssistantOpen(true); });
    const view = mount('portrait');
    await screen.findByTestId('shell-assistant-panel');
    expect(dockHandle()).toBeTruthy();
    sizeWindow(844, 390);
    view.turn('landscape');
    expect(screen.queryByRole('separator', { name: translate('agent.dock_resize') })).toBeNull();
  });
});
