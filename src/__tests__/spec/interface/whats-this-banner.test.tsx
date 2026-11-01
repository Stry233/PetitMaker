// @vitest-environment jsdom
/**
 * What's this? mode's banner in a narrow window: a long language's words show and may wrap. jsdom has
 * no layout, so whether they stay inside the window, and where the name plate stands, is checked in
 * browser captures.
 */
import { afterEach, beforeEach, describe, expect } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { spec } from '../../_support/spec';
import { setStoreState } from '../../_support/store';
import { I18nProvider, translate } from '../../../i18n/context';
import { InputModeProvider } from '../../../ui/design/input-mode';
import { WhatsThisLayer } from '../../../ui/help/WhatsThisLayer';
import type { InputMode } from '../../../platform/device/input-mode';
import type { LayoutShape } from '../../../platform/device/layout-shape';

function sizeWindow(w: number, h: number): void {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: w });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: h });
  window.dispatchEvent(new Event('resize'));
}

/** The banner: the box that holds the mode's words and its exit answer. */
function banner(): HTMLElement {
  const exit = screen.getByRole('button', { name: translate('help.whats_this_exit') });
  return exit.parentElement!;
}

beforeEach(() => setStoreState({ locale: 'ru', whatsThis: true }));
afterEach(() => { cleanup(); setStoreState({ whatsThis: false, locale: 'en' }); sizeWindow(1024, 768); });

describe("What's this? mode's banner", () => {
  for (const [w, h, inputMode, shape] of [[360, 740, 'touch', 'portrait'], [640, 480, 'pc', 'landscape']] as const) {
    spec('UI-21', `at ${w}x${h} in ${inputMode} mode a long language's banner shows its words and lets them wrap`, () => {
      sizeWindow(w, h);
      render(
        <InputModeProvider inputMode={inputMode as InputMode} shape={shape as LayoutShape}>
          <I18nProvider><WhatsThisLayer /></I18nProvider>
        </InputModeProvider>,
      );
      const box = banner();
      expect(box.textContent).toContain(translate('help.whats_this_banner'));
      expect(box.style.whiteSpace).not.toBe('nowrap');
      expect(box.style.flexWrap).toBe('wrap');
    });
  }
});
