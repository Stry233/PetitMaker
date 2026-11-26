// @vitest-environment jsdom
/** An upright window too narrow for six tiles at their size scrolls the mode row instead of shrinking it. */
import { afterEach, beforeEach, expect } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { spec } from '../../_support/spec';
import { resetStore, setStoreState } from '../../_support/store';
import { I18nProvider } from '../../../i18n/context';
import { InputModeProvider } from '../../../ui/design/input-mode';
import { FrameLayoutProvider } from '../../../ui/shell/frame-layout';
import { ModeRow, type ChromeSwap } from '../../../ui/shell/controls/ModeRow';
import { MODES } from '../../../ui/shell/frame';

function resizeTo(width: number, height: number): void {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: height });
  window.dispatchEvent(new Event('resize'));
}

const upright = ({ children }: { children: ReactNode }) => (
  <InputModeProvider inputMode="touch" shape="portrait"><I18nProvider><FrameLayoutProvider>{children}</FrameLayoutProvider></I18nProvider></InputModeProvider>
);

beforeEach(() => { resetStore(); setStoreState({ locale: 'en', inputMode: 'touch', layoutShape: 'portrait', uiZoom: 1.45 }); });
afterEach(() => { cleanup(); resizeTo(1024, 768); });

spec('BLUE-01', 'the upright mode row scrolls when six tiles do not fit and keeps the open mode in view', () => {
  resizeTo(390, 844);
  render(<ModeRow modes={MODES} mode="blueprint" swap={{} as ChromeSwap} onPick={() => {}} />, { wrapper: upright });
  const row = screen.getByRole('group', { name: 'Modes' });
  expect(row.style.overflowX, 'the row scrolls sideways').toBe('auto');
  expect([...row.querySelectorAll('button')].map((b) => b.getAttribute('aria-label')), 'every tile in order').toEqual(
    ['Objects', 'Roads', 'Mountains', 'Water', 'Blueprint', 'Generate']);
  expect(row.querySelector('[data-mode-tile="blueprint"]'), 'the open mode is a tile of the row, which it brings into view').toBeTruthy();
});
