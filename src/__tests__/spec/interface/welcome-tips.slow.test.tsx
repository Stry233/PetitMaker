// @vitest-environment jsdom
/**
 * The welcome tips' Generate Show me on the live shell. Opening Generate loads its whole shelf, which
 * keeps this step out of the fast tier; the rest of the tips are in `welcome-tips.test.tsx`.
 */
import { afterEach, beforeEach, expect, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { I18nProvider, translateFor } from '../../../i18n/context';
import { useEditorStore } from '../../../state/store';
import { Shell } from '../../../ui/shell/Shell';
import { tourCards } from '../../../ui/chrome/tour/deck';
import { startTour } from '../../../ui/chrome/tour/use-tour';
import { tourTargetSelector } from '../../../ui/chrome/tour/steps';
import { TerrainType } from '../../../core/model/types';
import { paintTerrainCommand } from '../../../core/model/command-build';
import { getMapTemplate } from '../../../config/maps';
import { createDefaultRegistry } from '../../../rules';
import { holdEditInFlight } from '../../../state/edits-in-flight';
import { setStoreState } from '../../_support/store';
import { TOUR_OFFERED, TOUR_SEEN_KEY } from '../../_support/tour';
import { spec } from '../../_support/spec';

const en = (key: Parameters<typeof translateFor>[1]) => translateFor('en', key);

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(TOUR_SEEN_KEY, TOUR_OFFERED);
  setStoreState({ locale: 'en', tourRunning: false });
  // jsdom lays nothing out; a ringed control needs a size for its step to stand.
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 100, y: 100, width: 200, height: 120, left: 100, top: 100, right: 300, bottom: 220, toJSON: () => ({}),
  } as DOMRect);
  useEditorStore.getState().initMap(getMapTemplate('hexia'), createDefaultRegistry());
});
afterEach(() => {
  cleanup();
  act(() => { useEditorStore.getState().finishTour(); });
  vi.restoreAllMocks();
});

spec('UI-47', 'Generate\'s build step waits for the build to finish landing, and leaving cancels a build still landing', async () => {
  render(<I18nProvider><Shell onRestoreSession={() => {}}><div /></Shell></I18nProvider>);
  const live = () => useEditorStore.getState();
  const callout = () => screen.getByTestId('tour-callout');
  const standsAt = (key: Parameters<typeof translateFor>[1]) => waitFor(() => expect(callout().textContent).toContain(en(key)));
  act(() => startTour());
  // jsdom gives no WebGL2, so the deck holds no 3D card.
  const cards = tourCards(false);
  await waitFor(() => expect(within(screen.getByTestId('tour-deck')).getAllByRole('heading')).toHaveLength(1));
  fireEvent.click(screen.getByRole('button', { name: translateFor('en', 'tour.dot', { n: cards.findIndex((c) => c.kind === 'generate') + 1, total: cards.length }) }));
  await waitFor(() => expect(screen.getByTestId('tour-show-me')).toBeTruthy());
  act(() => fireEvent.click(screen.getByTestId('tour-show-me')));
  act(() => fireEvent.click(document.querySelector<HTMLElement>(tourTargetSelector('mode:generate'))!));
  await standsAt('tour.show.generate_kinds');
  act(() => fireEvent.click(within(callout()).getByRole('button', { name: en('tour.next') })));
  await standsAt('tour.show.generate_recipe');
  let cancelled = 0;
  let release = () => {};
  act(() => {
    release = holdEditInFlight(() => { cancelled++; }, 'build');
    // One stroke raising the first open ground cell a layer: an edit the step would otherwise count.
    const executor = live().commandExecutor!;
    const { cells } = live().gridState!;
    for (let at = 0; at < cells.length * cells[0]!.length; at++) {
      const depth = executor.historyDepth();
      executor.transaction({}, (tx) => {
        executor.execute(paintTerrainCommand([{ x: at % cells[0]!.length, y: Math.floor(at / cells[0]!.length) }], TerrainType.Mountain, 1));
        tx.commit();
      });
      if (executor.historyDepth() > depth) break;
    }
  });
  await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
  expect(callout().textContent).toContain(en('tour.show.generate_recipe'));
  const back = within(callout()).getByRole('button', { name: en('tour.back_to_tips') });
  act(() => fireEvent.click(back));
  expect(cancelled).toBe(1);
  act(() => release());
});
