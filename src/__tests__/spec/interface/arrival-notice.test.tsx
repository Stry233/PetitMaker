// @vitest-environment jsdom
/**
 * The arrival notice gives way once the visitor sets to work, as the welcome-back offer does, and an
 * arrival said while they are at work waits for them to finish.
 */
import { describe, expect, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MotionConfig } from 'framer-motion';
import { I18nProvider, translate } from '../../../i18n/context';
import { useEditorStore } from '../../../state/store';
import { getMapTemplate } from '../../../config/maps';
import { createGrid } from '../../../core/model/grid-model';
import { Shell } from '../../../ui/shell/Shell';
import { ArrivalToast } from '../../../ui/chrome/floating/ArrivalToast';
import { __resetArrivals, announceArrival } from '../../../ui/session/arrival-bus';
import { TOUR_OFFERED, TOUR_SEEN_KEY } from '../../_support/tour';
import { spec } from '../../_support/spec';
import { ToastContainer } from '../../../ui/chrome/floating/Toast';
import { showToast } from '../../../platform/channels/toast-bus';
import { z } from '../../../ui/design/styles';

const HEXIA = getMapTemplate('hexia');

function mount() {
  render(
    <MotionConfig reducedMotion="always">
      <I18nProvider>
        <Shell onRestoreSession={() => {}}><div data-testid="map-views" /></Shell>
        <ArrivalToast splashActive={false} />
      </I18nProvider>
    </MotionConfig>,
  );
}

const notice = () => screen.queryByTestId('arrival-toast');
const modeTile = () => screen.getByRole('button', { name: translate('mode.mountain') });

beforeEach(() => {
  __resetArrivals();
  localStorage.setItem(TOUR_SEEN_KEY, TOUR_OFFERED);
  const st = useEditorStore.getState();
  useEditorStore.setState({
    gridState: { template: HEXIA, cells: createGrid(HEXIA), objects: new Map(), objectsVersion: 0, cellsVersion: 0, lockedLayers: new Set() },
    locale: 'en',
    tourRunning: false,
    modals: { ...st.modals, newProject: false, whatsNew: false },
  });
  st.setEditMode({ mode: null });
});

afterEach(cleanup);

describe('the arrival notice', () => {
  spec('UI-54', 'goes once the visitor opens a mode', async () => {
    mount();
    act(() => announceArrival({ kind: 'boot' }));
    await screen.findByTestId('arrival-toast');
    act(() => { fireEvent.click(modeTile()); });
    await waitFor(() => expect(notice()).toBeNull());
  });

  spec('UI-54', 'said while a mode is open, waits until it closes', async () => {
    mount();
    act(() => { fireEvent.click(modeTile()); });
    act(() => announceArrival({ kind: 'boot' }));
    await new Promise((r) => setTimeout(r, 20));
    expect(notice()).toBeNull();
    act(() => { fireEvent.click(modeTile()); });
    await screen.findByTestId('arrival-toast');
  });
});

describe('the notices over the map', () => {
  const layer = (el: Element | null) => Number((el?.closest('[style*="z-index"]') as HTMLElement | null)?.style.zIndex);

  spec('UI-54', 'stand under an open window, the arrival notice and a toast about the map alike', async () => {
    mount();
    render(<I18nProvider><ToastContainer /></I18nProvider>);
    act(() => announceArrival({ kind: 'boot' }));
    const greeting = await screen.findByTestId('arrival-toast');
    expect(layer(greeting.parentElement)).toBeLessThan(z.overlay);
    act(() => showToast('About the map'));
    expect(layer(await screen.findByTestId('toast-band'))).toBeLessThan(z.overlay);
  });

  spec('UI-54', 'let a toast posted while a window stands show over that window', async () => {
    render(<I18nProvider><ToastContainer /></I18nProvider>);
    act(() => useEditorStore.getState().setModal('share', true));
    act(() => showToast('About the window'));
    expect(layer(await screen.findByTestId('toast-band'))).toBeGreaterThan(z.overlay);
    act(() => useEditorStore.getState().setModal('share', false));
  });
});
