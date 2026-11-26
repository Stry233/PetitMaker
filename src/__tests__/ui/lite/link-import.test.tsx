// @vitest-environment jsdom
/**
 * A map link the page arrived with is offered through the import confirmation only once the
 * saved-session question the shell stands while mounting is settled.
 */
import { useLayoutEffect } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MotionConfig } from 'framer-motion';

const link = vi.hoisted(() => ({ arriving: vi.fn<() => string | null>() }));
vi.mock('../../../editor/export/host-deliveries', async (load) => ({
  ...await load<typeof import('../../../editor/export/host-deliveries')>(),
  HOST_MAP_LINK: { labelKey: 'lite.share_link', offered: async () => false, share: async () => {}, arriving: link.arriving },
}));

import { getMapTemplate } from '../../../config/maps';
import { createGridState } from '../../../core/model/template';
import { newMap } from '../../../editor/operations';
import { editorPort } from '../../../editor/session/context';
import { planetNaming } from '../../../editor/session/planet-names';
import { __setRestoreOffer, declineRestoreOffer } from '../../../editor/session/restore';
import { I18nProvider } from '../../../i18n/context';
import { exportableState } from '../../../io/export/exportable';
import { CURRENT_VERSION } from '../../../io/save/format';
import { mapLinkCode, mapLinkFor } from '../../../io/share';
import type { RestoredAutosave } from '../../../io/storage/autosave';
import { useEditorStore } from '../../../state/store';
import { LinkImport } from '../../../ui/lite/LinkImport';
import { setStoreState } from '../../_support/store';

const SAVED = { state: {} } as RestoredAutosave;

/** Stands the offer as the live shell does, in a layout effect of the mount the confirmation shares. */
function Page() {
  useLayoutEffect(() => { __setRestoreOffer(SAVED); }, []);
  return <MotionConfig reducedMotion="always"><I18nProvider><LinkImport /></I18nProvider></MotionConfig>;
}

beforeEach(async () => {
  newMap(editorPort, 'hexia');
  setStoreState({ locale: 'en' });
  const state = exportableState(createGridState(getMapTemplate('hexia')), planetNaming('en'));
  const path = await mapLinkFor('/toy', state, null, { appVersion: 'test', saveVersion: CURRENT_VERSION, createdAt: '2026-01-01T00:00:00.000Z' });
  link.arriving.mockReset();
  link.arriving.mockReturnValue(mapLinkCode(new URL(path!, 'https://example.test').search));
});
afterEach(() => { cleanup(); __setRestoreOffer(null); });

it('asks about the linked map after the saved-session question, and installs it on Import', async () => {
  render(<Page />);
  expect(link.arriving).not.toHaveBeenCalled();
  expect(screen.queryByText('Import this map?')).toBeNull();
  act(() => { declineRestoreOffer(); });
  expect(await screen.findByText('Import this map?')).toBeTruthy();
  const before = useEditorStore.getState().gridState;
  fireEvent.click(screen.getByRole('button', { name: 'Import' }));
  expect(useEditorStore.getState().gridState).not.toBe(before);
  expect(link.arriving).toHaveBeenCalledTimes(1);
});
