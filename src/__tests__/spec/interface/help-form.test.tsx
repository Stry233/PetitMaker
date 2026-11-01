// @vitest-environment jsdom
/**
 * Help in the reader's form: key tables only for a keyboard reader, wording by finger in touch mode
 * and by the bottom bar upright, and the welcome tips' recordings standing in a page where they show
 * what it explains, the live figure standing in where no recording ships.
 */
import { MotionConfig } from 'framer-motion';
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, vi } from 'vitest';
import { spec } from '../../_support/spec';
import { I18nProvider, translateFor } from '../../../i18n/context';
import { HelpModal } from '../../../ui/help/HelpModal';
import { InputModeProvider } from '../../../ui/design/input-mode';
import { __setReelFiles } from '../../../ui/chrome/tour/reels';
import { makeState } from '../../_support/map-state';
import { setStoreState } from '../../_support/store';
import type { InputMode } from '../../../platform/device/input-mode';
import type { LayoutShape } from '../../../platform/device/layout-shape';
import type { HelpPageId } from '../../../ui/help/page-schema';
import type { TextKey } from '../../../i18n/keys';

beforeEach(() => {
  setStoreState({ gridState: makeState(20, 20), locale: 'en' });
  vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} });
  Element.prototype.scrollIntoView = () => {};
});
afterEach(() => {
  cleanup();
  __setReelFiles(null);
  vi.unstubAllGlobals();
});

/** The plain text a Help string shows: its bold marks and inline art drop out. */
const shown = (key: TextKey): string => translateFor('en', key).replace(/\*\*/g, '').replace(/\[\[[a-z0-9-]+\]\]\s?/g, '');

async function helpAt(page: HelpPageId, inputMode: InputMode, shape: LayoutShape = 'landscape'): Promise<HTMLElement> {
  setStoreState({ helpTarget: { page } });
  const { baseElement } = render(
    <MotionConfig reducedMotion="always"><I18nProvider>
      <InputModeProvider inputMode={inputMode} shape={shape}><HelpModal open onClose={() => {}} /></InputModeProvider>
    </I18nProvider></MotionConfig>,
  );
  await waitFor(() => expect(baseElement.querySelector('h2')).toBeTruthy());
  return baseElement;
}

describe('Help in the reader\'s form', () => {
  spec('UI-60', 'a page\'s key table shows for a mouse reader and is left out by finger', async () => {
    const mouse = await helpAt('copy', 'pc');
    await waitFor(() => expect(mouse.querySelector('#help-copy-keys')).toBeTruthy());
    cleanup();
    const touch = await helpAt('copy', 'touch');
    await waitFor(() => expect(touch.querySelector('#help-copy-paste')).toBeTruthy());
    expect(touch.querySelector('#help-copy-keys')).toBeNull();
  });

  spec('UI-60', 'copy and paste read by the long-press menu in touch mode', async () => {
    const touch = await helpAt('copy', 'touch');
    await waitFor(() => expect(touch.textContent).toContain(shown('help.copy.entry_touch')));
    expect(touch.textContent).toContain(shown('help.copy.drag_b1_touch'));
    expect(touch.textContent).not.toContain(shown('help.copy.drag_b1'));
  });

  spec('UI-60', 'an upright reader finds the modes and their panels in the bottom bar', async () => {
    const upright = await helpAt('frame', 'pc', 'portrait');
    await waitFor(() => expect(upright.textContent).toContain(shown('help.frame.modes_b1_upright').slice(0, 40)));
    expect(upright.textContent).toContain(shown('help.frame.bar_b1_upright').slice(0, 40));
    expect(upright.textContent).not.toContain(shown('help.frame.modes_b1').slice(0, 40));
  });

  spec('UI-61', 'a page plays the tips\' recording of what it explains, and its live figure where none ships', async () => {
    const withReels = await helpAt('objects', 'touch');
    await waitFor(() => expect(withReels.querySelector('[data-help-reel="objects"]')).toBeTruthy());
    cleanup();
    __setReelFiles({});
    const without = await helpAt('objects', 'touch');
    await waitFor(() => expect(without.querySelector('article figure')).toBeTruthy());
    expect(without.querySelector('[data-help-reel]')).toBeNull();
  });
});
