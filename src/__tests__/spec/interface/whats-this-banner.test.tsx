// @vitest-environment jsdom
/**
 * What's this? mode's banner in a narrow window: a long language's words stay inside the window. jsdom
 * has no layout, so the cap and the wrapping are read from the styles the banner writes; the drawn
 * result is checked in browser captures.
 */
import { afterEach, beforeEach, describe, expect, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { spec } from '../../_support/spec';
import { setStoreState } from '../../_support/store';
import { I18nProvider, translate } from '../../../i18n/context';
import { InputModeProvider } from '../../../ui/design/input-mode';
import { WhatsThisLayer } from '../../../ui/help/WhatsThisLayer';
import { HELP_PAGES } from '../../../ui/help/catalog';
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
    spec('UI-21', `at ${w}x${h} in ${inputMode} mode a long language's banner is capped to the window and wraps its words`, () => {
      sizeWindow(w, h);
      render(
        <InputModeProvider inputMode={inputMode as InputMode} shape={shape as LayoutShape}>
          <I18nProvider><WhatsThisLayer /></I18nProvider>
        </InputModeProvider>,
      );
      const box = banner();
      expect(box.textContent).toContain(translate('help.whats_this_banner'));
      // Held at its words' width, capped to the window less its side margins rather than running off both sides.
      expect(box.style.width).toBe('max-content');
      const room = /^calc\((\d+(?:\.\d+)?)px - /.exec(box.style.maxWidth);
      expect(Number(room?.[1])).toBeLessThanOrEqual(w);
      expect(box.style.whiteSpace).not.toBe('nowrap');
      expect(box.style.flexWrap).toBe('wrap');
    });
  }
});

/** A plate this wide and tall, since jsdom lays nothing out. */
const PLATE = { w: 300, h: 26 };

describe("What's this? mode's name plate", () => {
  afterEach(() => vi.restoreAllMocks());

  for (const [where, rect] of [
    ['at the window\'s top right corner', { left: 330, top: 4, width: 26, height: 40 }],
    ['in the middle of the window', { left: 160, top: 400, width: 40, height: 40 }],
  ] as const) {
    spec('UI-21', `names a control ${where} inside the window, above it where it fits and under it otherwise`, async () => {
      sizeWindow(360, 740);
      vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(PLATE.w);
      vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(PLATE.h);
      render(
        <I18nProvider>
          <WhatsThisLayer />
          <div data-help="share"><button>Target</button></div>
        </I18nProvider>,
      );
      const target = screen.getByRole('button', { name: 'Target' });
      vi.spyOn(target, 'getBoundingClientRect').mockReturnValue(
        { ...rect, x: rect.left, y: rect.top, right: rect.left + rect.width, bottom: rect.top + rect.height, toJSON: () => rect } as DOMRect,
      );
      act(() => target.focus());
      // Framer writes a motion value's style on its next frame.
      await act(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
      const plate = screen.getByText(translate(HELP_PAGES.share.titleKey));
      const left = parseFloat(plate.style.left);
      const top = parseFloat(plate.style.top);
      expect(plate.style.left).toMatch(/px$/);
      expect(left).toBeGreaterThanOrEqual(0);
      expect(left + PLATE.w).toBeLessThanOrEqual(360);
      if (rect.top > PLATE.h * 2) expect(top + PLATE.h).toBeLessThanOrEqual(rect.top);
      else expect(top).toBeGreaterThanOrEqual(rect.top + rect.height);
    });
  }
});
