// @vitest-environment jsdom
/** Map illustration's window as the web edition's shell mounts it. */
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { MotionConfig } from 'framer-motion';
import { I18nProvider } from '../../../../i18n/context';
import { createDefaultRegistry } from '../../../../rules';
import { MODAL_IDS } from '../../../../state/slices/shell';
import { useEditorStore } from '../../../../state/store';
import { Windows } from '../../../../ui/shell/windows/Windows';
import { makeTemplate } from '../../../_support/map-state';

const s = () => useEditorStore.getState();
const card = () => screen.queryByRole('dialog', { name: 'Map illustration', hidden: true });

afterEach(() => {
  cleanup();
  act(() => { for (const id of MODAL_IDS) s().setModal(id, false); });
});

describe('the Map illustration window', () => {
  it('plays its exit when closed, then leaves, and opens fresh again', async () => {
    act(() => { s().initMap(makeTemplate(30, 30), createDefaultRegistry()); useEditorStore.setState({ locale: 'en' }); });
    render(<MotionConfig reducedMotion="never"><I18nProvider><Windows /></I18nProvider></MotionConfig>);
    act(() => { s().setModal('stylize', true); });
    expect(await screen.findByRole('dialog', { name: 'Map illustration' })).toBeTruthy();

    act(() => { s().setModal('stylize', false); });
    // The card is on its way out, not gone on the frame the flag turned off.
    expect(card()).not.toBeNull();
    await waitFor(() => expect(card()).toBeNull());

    act(() => { s().setModal('stylize', true); });
    expect(await screen.findByRole('dialog', { name: 'Map illustration' })).toBeTruthy();
  });
});
