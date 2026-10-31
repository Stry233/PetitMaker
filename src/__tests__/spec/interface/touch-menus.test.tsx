// @vitest-environment jsdom
/**
 * A dropdown opened inside a window draws at the window's own size: in touch mode the window is lifted
 * to a fingertip, and its menus with it. Read through the CSS `zoom` each surface wears.
 */
import { afterEach, beforeEach, describe, expect, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MotionConfig } from 'framer-motion';
import type { ReactNode } from 'react';
import { spec } from '../../_support/spec';
import { JSDOM_WINDOW, atScale, sizeWindow } from '../../_support/viewport';
import { TOUCH_UI_ZOOM_DEFAULT } from '../../../platform/storage/prefs';
import { I18nProvider } from '../../../i18n/context';
import { useEditorStore } from '../../../state/store';
import { versionStore } from '../../../state/stylize-versions';
import { InputModeProvider } from '../../../ui/design/input-mode';
import { StylizeWindow } from '../../../ui/chrome/modals/export/stylize/StylizeWindow';

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  versionStore.reset();
  useEditorStore.setState({ locale: 'en' });
});
afterEach(() => { cleanup(); vi.useRealTimers(); sizeWindow(JSDOM_WINDOW.w, JSDOM_WINDOW.h); atScale(1); });

function Touch({ children }: { children: ReactNode }) {
  return (
    <MotionConfig reducedMotion="always">
      <I18nProvider><InputModeProvider inputMode="touch" shape="landscape">{children}</InputModeProvider></I18nProvider>
    </MotionConfig>
  );
}

const settle = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

/** The zoom the open menu card is drawn at: its body layer's. */
function menuZoom(card: HTMLElement): number {
  return Number(card.parentElement!.style.zoom);
}

describe('menus in a window in touch mode', () => {
  spec('UI-27', 'the stylize provider and model menus draw at the lifted window size, not the bare chrome size', async () => {
    sizeWindow(844, 390);
    atScale(TOUCH_UI_ZOOM_DEFAULT);
    render(<StylizeWindow onClose={() => {}} listModels={async () => ['gemini-2.5-flash-image', 'gemini-2.5-pro-image']} />, { wrapper: Touch });
    await settle();
    const dialog = screen.getByRole('dialog', { name: 'Map illustration' });
    const lifted = Number(dialog.style.zoom);
    expect(lifted).toBeGreaterThanOrEqual(44 / 34);

    fireEvent.click(within(dialog).getByRole('button', { name: /Forest watercolor/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add a key' }));
    await settle();

    fireEvent.click(within(dialog).getByLabelText('Provider'));
    expect(menuZoom(screen.getByRole('menu', { name: 'Provider' }))).toBeCloseTo(lifted);
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });

    fireEvent.change(within(dialog).getByLabelText('API key'), { target: { value: 'AIzaSy-test-key' } });
    await act(async () => { vi.advanceTimersByTime(600); await Promise.resolve(); await Promise.resolve(); });
    fireEvent.click(within(dialog).getByLabelText('Model'));
    const card = screen.getByRole('group', { name: 'Model' });
    expect(menuZoom(card)).toBeCloseTo(lifted);
    // A long list can be narrowed by typing, and a model the list lacks can be typed outright.
    fireEvent.change(within(card).getByRole('searchbox'), { target: { value: 'pro' } });
    expect(within(card).getAllByRole('menuitemradio').map((row) => row.textContent)).toEqual(['gemini-2.5-pro-image', 'Use pro']);
  });
});
