// @vitest-environment jsdom
/**
 * The layer panel at its largest size on a phone held upright, where its usual square is wider than
 * the room beside the right-hand column. Widths and depths are read from the styles the plan writes,
 * since jsdom has no layout; how it looks is checked in a browser.
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
import { FLOORS, PANEL, tileLeastWidth, tileOf } from '../../../ui/shell/controls/layer-plate';

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

/** The frame's height in its own px: the window's over the frame's zoom. */
function frameHeight(): number {
  const zoomed = document.querySelector<HTMLElement>('[style*="--shell-zoom"]')!;
  return window.innerHeight / parseFloat(zoomed.style.getPropertyValue('--shell-zoom'));
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
  for (const [w, h] of [[390, 844], [412, 915]] as const) {
    for (const inputMode of ['touch', 'pc'] as const) {
      spec('UI-41', `at ${w}x${h} in ${inputMode} mode its largest size holds every layer whole and scrolls them under its head`, () => {
        sizeWindow(w, h);
        mount(inputMode);
        const plate = openLargest();
        const floors = within(plate).getByTestId('shell-layer-floors');
        const rows = within(plate).getAllByTestId(/^shell-layer-row-\d+$/);
        expect(rows, 'every layer is listed').toHaveLength(FLOORS);
        for (const row of rows) expect(floors.contains(row), 'inside the one region that scrolls').toBe(true);
        expect(floors.contains(within(plate).getByTestId('shell-layer-head')), 'the head stays outside it').toBe(false);
        expect(floors.style.overflowY).toBe('auto');

        // Across: the columns the panel lays, each at a tile's least width, fit the plate it may draw.
        const touch = inputMode === 'touch';
        const cols = Number(/repeat\((\d+)/.exec(floors.style.gridTemplateColumns)![1]);
        const across = 2 * (PANEL.pad + PANEL.edge) + cols * tileLeastWidth('grid', touch) + (cols - 1) * tileOf('grid', touch).gap;
        expect(across, `${cols} columns`).toBeLessThanOrEqual(parseFloat(plate.style.maxWidth));
        // Down: the plate never reaches past the frame's foot.
        expect(parseFloat(plate.style.top) + parseFloat(plate.style.maxHeight)).toBeLessThanOrEqual(frameHeight());
      });
    }
  }
});
