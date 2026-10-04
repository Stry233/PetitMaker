/**
 * A planet read from a video that covered only part of the coast opens in the planet editor with a
 * note saying how much of the coast the video covered.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { I18nProvider, translate } from '../../../i18n/context';
import { setToastPresenter } from '../../../core/runtime/toast-bus';
import { useEditorStore } from '../../../state/store';
import { ChangePlanetModal } from '../../../ui/chrome/modals/ChangePlanetModal';
import { newMap } from '../../../kit/operations/map';
import type { ScanOutcome } from '../../../io/planet-scan/run';
import { planetFixture } from '../../fixtures/planet';

const OUTCOME: ScanOutcome = { template: planetFixture(), rimSand: [], review: [], landmark: null, coverage: 0.8, partial: true };

vi.mock('../../../io/planet-scan/import-video', async (actual) => ({
  ...(await actual<typeof import('../../../io/planet-scan/import-video')>()),
  scanVideo: async () => OUTCOME,
}));

afterEach(() => {
  cleanup();
  act(() => { useEditorStore.getState().setPlanetSession(null); useEditorStore.getState().setModal('planetImport', false); });
});

describe('a partly covered scan', () => {
  it('opens the planet editor and says how much of the coast the video covered', async () => {
    newMap('hexia');
    const toasts: string[] = [];
    const stop = setToastPresenter((text) => toasts.push(text));
    // The planet editor opens as the app's would, by starting a session.
    const onEditPlanet = vi.fn(() => {
      useEditorStore.getState().setPlanetSession({ entryId: null, name: '', nameReviewed: true } as never);
    });
    try {
      render(<I18nProvider><ChangePlanetModal onSwitch={() => {}} onClose={() => {}} onEditPlanet={onEditPlanet} /></I18nProvider>);
      fireEvent.click(screen.getByTestId('planet-import'));
      fireEvent.click(await screen.findByTestId('planet-import-video'));
      const input = await screen.findByTestId('scan-file');
      fireEvent.change(input, { target: { files: [new File([new Uint8Array(4)], 'scan.mp4', { type: 'video/mp4' })] } });
      await waitFor(() => expect(onEditPlanet).toHaveBeenCalled(), { timeout: 3000 });
      expect(toasts).toContain(translate('planet.scan_partial', { percent: 80 }));
    } finally {
      stop();
    }
  });
});
