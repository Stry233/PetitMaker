// @vitest-environment jsdom
/** The share picture's Art style group: the web edition's window offers it, the Lite window does not (UI-25). */
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { MotionConfig } from 'framer-motion';
import { I18nProvider } from '../../../../i18n/context';
import { createDefaultRegistry } from '../../../../rules';
import { MODAL_IDS } from '../../../../state/slices/shell';
import { useEditorStore } from '../../../../state/store';
import { LiteWindows } from '../../../../ui/lite/LiteWindows';
import { Windows } from '../../../../ui/shell/windows/Windows';
import { makeTemplate } from '../../../_support/map-state';

const s = () => useEditorStore.getState();

async function openPicture(windows: React.ReactNode): Promise<void> {
  act(() => { s().initMap(makeTemplate(30, 30), createDefaultRegistry()); useEditorStore.setState({ locale: 'en' }); });
  render(<MotionConfig reducedMotion="always"><I18nProvider>{windows}</I18nProvider></MotionConfig>);
  await act(async () => { s().openShare('friend'); await Promise.resolve(); });
  expect(await screen.findByTestId('export-panel')).toBeTruthy();
}

afterEach(() => {
  cleanup();
  act(() => { for (const id of MODAL_IDS) s().setModal(id, false); });
});

describe('the Art style group', () => {
  it('stands in the web edition\'s picture controls', async () => {
    await openPicture(<Windows />);
    expect(screen.getByTestId('stylize-entry')).toBeTruthy();
  });

  it('is absent from the Lite window', async () => {
    await openPicture(<LiteWindows />);
    expect(screen.queryByTestId('stylize-entry')).toBeNull();
  });
});
