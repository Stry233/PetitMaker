// @vitest-environment jsdom
/**
 * Lite loads its Import window on first use and keeps it mounted afterwards, so a close plays the
 * card's exit and a reopen reuses the loaded chunk.
 */
import { afterEach, beforeEach, expect } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { useEditorStore } from '../../../state/store';
import { I18nProvider } from '../../../i18n/context';
import { LiteWindows } from '../../../ui/lite/LiteWindows';
import { setStoreState } from '../../_support/store';
import { spec } from '../../_support/spec';

const card = () => screen.queryByTestId('import-drop-zone');

beforeEach(() => { setStoreState({ locale: 'en' }); });
afterEach(() => { cleanup(); useEditorStore.getState().setModal('import', false); });

spec('UI-07', 'Lite\'s Import card loads on demand, plays its close, and opens again', async () => {
  render(<I18nProvider><LiteWindows /></I18nProvider>);
  expect(card()).toBeNull();
  await act(async () => { useEditorStore.getState().setModal('import', true); });
  expect(await screen.findByTestId('import-drop-zone')).toBeTruthy();
  act(() => { useEditorStore.getState().setModal('import', false); });
  expect(card(), 'the card stays while its exit plays').not.toBeNull();
  await waitFor(() => expect(card()).toBeNull());
  act(() => { useEditorStore.getState().setModal('import', true); });
  expect(await screen.findByTestId('import-drop-zone')).toBeTruthy();
});
