// @vitest-environment jsdom
/**
 * The layer panel at its largest size on a phone held upright, where its usual square is wider than
 * the room beside the right-hand column. jsdom has no layout, so whether its tiles and plate fit the
 * window is checked in a browser.
 */
import { afterEach, beforeEach, describe, expect } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { spec } from '../../_support/spec';
import { setStoreState } from '../../_support/store';
import { makeState } from '../../_support/map-state';
import { I18nProvider, translate } from '../../../i18n/context';
import { useEditorStore } from '../../../state/store';
import type { InputMode } from '../../../platform/device/input-mode';
import { InputModeProvider } from '../../../ui/design/input-mode';
import { Shell } from '../../../ui/shell/Shell';
import { TOUR_OFFERED, TOUR_SEEN_KEY } from '../../_support/tour';
import { ELEVATION_MAX } from '../../../core/game/profile';

function sizeWindow(w: number, h: number): void {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: w });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: h });
  window.dispatchEvent(new Event('resize'));
}

function mount(inputMode: InputMode) {
  return render(
    <InputModeProvider inputMode={inputMode} shape="portrait">
      <I18nProvider><Shell onRestoreSession={() => {}}><div /></Shell></I18nProvider>
    </InputModeProvider>,
  );
}

/** Opens the panel from the layer count and walks it up to its largest size. */
function openLargest(): HTMLElement {
  fireEvent.click(screen.getByRole('button', { name: translate('layer.title') }));
  const bigger = () => screen.getByRole('button', { name: translate('a11y.layer_bigger') });
  fireEvent.click(bigger());
  expect((bigger() as HTMLButtonElement).disabled, 'the ladder stands at its top').toBe(true);
  return screen.getByRole('group', { name: translate('layer.title') });
}

beforeEach(() => {
  localStorage.setItem(TOUR_SEEN_KEY, TOUR_OFFERED);
  setStoreState({ locale: 'en', assistantOpen: false, tourRunning: false, gridState: makeState() });
  useEditorStore.getState().setEditMode({ mode: null });
});
afterEach(() => { cleanup(); sizeWindow(1024, 768); });

describe('the layer panel on an upright phone', () => {
  for (const inputMode of ['touch', 'pc'] as const) {
    spec('UI-41', `at 390x844 in ${inputMode} mode its largest size lists every layer and scrolls them under its head`, () => {
      sizeWindow(390, 844);
      mount(inputMode);
      const plate = openLargest();
      const floors = within(plate).getByTestId('shell-layer-floors');
      const rows = within(plate).getAllByTestId(/^shell-layer-row-\d+$/);
      expect(rows, 'every layer is listed').toHaveLength(ELEVATION_MAX + 1);
      for (const row of rows) expect(floors.contains(row), 'inside the one region that scrolls').toBe(true);
      expect(floors.contains(within(plate).getByTestId('shell-layer-head')), 'the head stays outside it').toBe(false);
      expect(floors.style.overflowY).toBe('auto');
    });
  }
});
