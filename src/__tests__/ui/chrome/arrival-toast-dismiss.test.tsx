/**
 * The two things a hand does to the arrival notice: take it, or go and change the planet.
 *
 * A FILE OF ITS OWN because both are read off the notice being GONE, and going is an exit
 * animation: Framer's frame loop stops running for the rest of any file that has installed fake
 * timers even once, so the clock these tests need cannot coexist with the one the eyebrow's three
 * seconds are advanced by (`arrival-toast.test.tsx`).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, act, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { MotionConfig } from 'framer-motion';
import { ArrivalToast } from '../../../ui/chrome/floating/ArrivalToast';
import { __resetArrivals, announceArrival } from '../../../core/runtime/arrival-bus';
import { TOUR_SEEN_KEY } from '../../../ui/chrome/tour/use-tour';
import { I18nProvider } from '../../../i18n/context';
import { useEditorStore } from '../../../state/store';
import { getMapTemplate } from '../../../config/maps';
import { createGrid } from '../../../core/model/grid-model';

const HEXIA = getMapTemplate('hexia');

async function shownNotice() {
  render(
    <MotionConfig reducedMotion="never">
      <I18nProvider><ArrivalToast splashActive={false} /></I18nProvider>
    </MotionConfig>,
  );
  act(() => announceArrival({ kind: 'boot' }));
  await screen.findByTestId('arrival-toast');
}

const gone = () => waitFor(() => expect(screen.queryByTestId('arrival-toast')).toBeNull());

beforeEach(() => {
  __resetArrivals();
  localStorage.setItem(TOUR_SEEN_KEY, '1');
  const st = useEditorStore.getState();
  useEditorStore.setState({
    gridState: { template: HEXIA, cells: createGrid(HEXIA), objects: new Map(), lockedLayers: new Set() },
    locale: 'en',
    tourRunning: false,
    portraitBlocked: false,
    modals: { ...st.modals, tourDone: false, newProject: false },
  });
});

afterEach(cleanup);

describe('answering the arrival notice', () => {
  it('goes when its OK is pressed', async () => {
    await shownNotice();
    act(() => { fireEvent.click(screen.getByTestId('arrival-ok')); });
    await gone();
  });

  it('hands over the planet chooser, and goes with it', async () => {
    await shownNotice();
    act(() => { fireEvent.click(screen.getByTestId('arrival-switch')); });
    expect(useEditorStore.getState().modals.newProject).toBe(true);
    await gone();
  });
});
