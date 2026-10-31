// @vitest-environment jsdom
/**
 * The refusal toasts, the failure notice and the tour card on a phone: in touch mode they draw at least at their
 * designed size, and in PC mode at the chrome's zoom. jsdom has no layout, so the zoom is read from
 * the surface's style.
 */
import { afterEach, describe, expect } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { spec } from '../../_support/spec';
import { I18nProvider } from '../../../i18n/context';
import { InputModeProvider } from '../../../ui/design/input-mode';
import { ToastContainer } from '../../../ui/chrome/floating/Toast';
import { showToast } from '../../../platform/channels/toast-bus';
import { SurfaceNotice } from '../../../ui/chrome/guards/FailureNotice';
import { Tour } from '../../../ui/chrome/tour/Tour';
import { TOUR_SEEN_KEY } from '../../_support/tour';
import { startTour } from '../../../ui/chrome/tour/use-tour';
import { useEditorStore } from '../../../state/store';
import { setStoreState } from '../../_support/store';
import type { InputMode } from '../../../platform/device/input-mode';
import { TOUCH_UI_ZOOM_DEFAULT, UI_ZOOM_DEFAULT } from '../../../platform/storage/prefs';
import { __resetUiZoomAnim } from '../../../ui/design/ui-zoom-anim';

function sizeWindow(w: number, h: number): void {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: w });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: h });
  window.dispatchEvent(new Event('resize'));
}

afterEach(() => { cleanup(); sizeWindow(1024, 768); atScale(1); });

/** Settles the UI scale at `uiZoom`. */
function atScale(uiZoom: number): void {
  act(() => { useEditorStore.setState({ uiZoom }); __resetUiZoomAnim(); });
}

/** A 390 by 844 window at `inputMode`'s default scale. */
function phoneAt(inputMode: InputMode): void {
  sizeWindow(390, 844);
  atScale(inputMode === 'touch' ? TOUCH_UI_ZOOM_DEFAULT : UI_ZOOM_DEFAULT);
}

/** The zoom the toast band draws at on a 390 by 844 window in `inputMode` at its default scale. */
function toastZoom(inputMode: InputMode): number {
  phoneAt(inputMode);
  render(<InputModeProvider inputMode={inputMode}><I18nProvider><ToastContainer /></I18nProvider></InputModeProvider>);
  act(() => { showToast('Too close to the edge', 'error'); });
  const band = screen.getByTestId('toast-band');
  const zoom = Number(band.style.zoom);
  cleanup();
  return zoom;
}

describe('a refusal toast on a phone', () => {
  spec('UI-27', 'draws at its designed size at touch mode\'s default scale and at the chrome zoom in PC mode', () => {
    expect(toastZoom('touch')).toBeGreaterThanOrEqual(1);
    expect(toastZoom('pc')).toBeLessThan(1);
  });
});

/** The zoom the failure notice draws at on a 390 by 844 window in `inputMode` at its default scale. */
function failureZoom(inputMode: InputMode): number {
  phoneAt(inputMode);
  render(<InputModeProvider inputMode={inputMode}><I18nProvider><SurfaceNotice onRetry={() => {}} /></I18nProvider></InputModeProvider>);
  const zoom = Number(screen.getByTestId('surface-failed-notice').style.zoom);
  cleanup();
  return zoom;
}

describe('a failure notice on a phone', () => {
  spec('UI-27', 'draws at its designed size at touch mode\'s default scale and at the chrome zoom in PC mode', () => {
    expect(failureZoom('touch')).toBeGreaterThanOrEqual(1);
    expect(failureZoom('pc')).toBeLessThan(1);
  });
});

/** The welcome tips' opening card on a 390 by 844 window in `inputMode`: its zoom, and how many of its
 *  buttons carry a fingertip's hit area. */
async function tourCard(inputMode: InputMode): Promise<{ zoom: number; reaches: number; buttons: number }> {
  phoneAt(inputMode);
  setStoreState({ locale: 'en' });
  const seen = localStorage.getItem(TOUR_SEEN_KEY);
  localStorage.removeItem(TOUR_SEEN_KEY);
  startTour();
  render(<InputModeProvider inputMode={inputMode}><I18nProvider><Tour /></I18nProvider></InputModeProvider>);
  const card = await waitFor(() => screen.getByTestId('tour-deck'));
  const buttons = [...card.querySelectorAll('button')];
  const found = { zoom: Number(card.style.zoom), reaches: buttons.filter((b) => b.querySelector('[data-touch-reach]')).length, buttons: buttons.length };
  cleanup();
  act(() => { useEditorStore.getState().setTourRunning(false); });
  if (seen === null) localStorage.removeItem(TOUR_SEEN_KEY);
  else localStorage.setItem(TOUR_SEEN_KEY, seen);
  return found;
}

describe('the welcome tips on a phone', () => {
  spec('UI-27', 'draws at its designed size at touch mode\'s default scale and at the chrome zoom in PC mode', async () => {
    expect((await tourCard('touch')).zoom).toBeGreaterThanOrEqual(1);
    expect((await tourCard('pc')).zoom).toBeLessThan(1);
  });

  spec('UI-27', 'gives every button a fingertip\'s hit area in touch mode and none in PC mode', async () => {
    const touch = await tourCard('touch');
    expect(touch.buttons).toBeGreaterThanOrEqual(2);
    expect(touch.reaches).toBe(touch.buttons);
    expect((await tourCard('pc')).reaches).toBe(0);
  });
});
