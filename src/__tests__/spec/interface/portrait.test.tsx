// @vitest-environment jsdom
/**
 * The upright arrangement on a rendered shell: the mode tiles in a bar at the window's foot, the corner
 * actions, the panels the tiles open, and a turn to landscape that keeps what was open and selected.
 * jsdom has no layout, so where each surface stands is checked in a browser.
 */
import { afterEach, beforeEach, describe, expect, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { spec } from '../../_support/spec';
import { setStoreState } from '../../_support/store';
import { I18nProvider, translate } from '../../../i18n/context';
import { useEditorStore } from '../../../state/store';
import type { LayoutShape } from '../../../platform/device/layout-shape';
import { InputModeProvider } from '../../../ui/design/input-mode';
import { Shell } from '../../../ui/shell/Shell';
import { MODES } from '../../../ui/shell/frame';
import { TOUR_OFFERED, TOUR_SEEN_KEY } from '../../_support/tour';
import { __resetUprightGrid } from '../../../ui/shell/bars/objects/UprightObjectPanel';
import { CONTROL_CLEARANCE } from '../../../ui/primitives/use-scroll-row';

vi.mock('../../../view/map2d/capture/thumbnail', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../view/map2d/capture/thumbnail')>()),
  renderThumbnail: () => new Promise<null>(() => {}),
}));

function sizeWindow(w: number, h: number): void {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: w });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: h });
  window.dispatchEvent(new Event('resize'));
}

function Device({ shape, children }: { shape: LayoutShape; children: ReactNode }) {
  return <InputModeProvider inputMode="touch" shape={shape}><I18nProvider>{children}</I18nProvider></InputModeProvider>;
}

function mount(shape: LayoutShape) {
  const shell = (s: LayoutShape) => <Device shape={s}><Shell onRestoreSession={() => {}}><div /></Shell></Device>;
  const view = render(shell(shape));
  return { ...view, turn: (s: LayoutShape) => view.rerender(shell(s)) };
}

/** The first value of a CSS box shorthand, which may be a nested `calc(...)`. */
function firstSide(shorthand: string): string {
  let depth = 0;
  for (let i = 0; i < shorthand.length; i++) {
    if (shorthand[i] === '(') depth++;
    else if (shorthand[i] === ')') depth--;
    else if (shorthand[i] === ' ' && depth === 0) return shorthand.slice(0, i);
  }
  return shorthand;
}

beforeEach(() => {
  localStorage.setItem(TOUR_SEEN_KEY, TOUR_OFFERED);
  setStoreState({ locale: 'en', assistantOpen: false, tourRunning: false });
  useEditorStore.getState().setEditMode({ mode: null });
  sizeWindow(390, 844);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); sizeWindow(1024, 768); });

describe('the upright arrangement', () => {
  spec('UI-28', 'at 390x844 the mode tiles sit in a bottom bar and the corner actions show', () => {
    mount('portrait');
    const row = document.querySelector<HTMLElement>('[data-placement]')!;
    expect(row.dataset.placement).toBe('bottom');
    expect(screen.getByTestId('shell-mode-band')).toBeTruthy();
    expect(screen.getByTestId('shell-corner-actions')).toBeTruthy();
  });

  spec('UI-28', 'each mode tile opens its mode and a second press closes it', () => {
    mount('portrait');
    for (const art of MODES) {
      fireEvent.click(screen.getByRole('button', { name: translate(art.labelKey) }));
      expect(useEditorStore.getState().editMode.mode).toBe(art.id);
      fireEvent.click(screen.getByRole('button', { name: translate(art.labelKey) }));
      expect(useEditorStore.getState().editMode.mode).toBe(null);
    }
  });

  spec('UI-28', 'a terrain panel stands its size slider with the tool row, not at the end of the settings row', () => {
    mount('portrait');
    fireEvent.click(screen.getByRole('button', { name: translate('mode.mountain') }));
    if (!screen.getByRole('button', { name: translate('terrain.brush') }).getAttribute('aria-pressed')?.includes('true')) {
      fireEvent.click(screen.getByRole('button', { name: translate('terrain.brush') }));
    }
    const size = document.querySelector<HTMLElement>('[data-toolbar-slot="size"]')!;
    expect(size.closest('[data-toolbar-slot="tools"]')).not.toBeNull();
    expect(size.closest('[data-toolbar-slot="settings"]')).toBeNull();
  });

  spec('UI-28', 'the tool row scrolling sideways keeps room above its pills for their focus ring and shortcut badges', () => {
    mount('portrait');
    fireEvent.click(screen.getByRole('button', { name: translate('mode.mountain') }));
    let scroller: HTMLElement | null = screen.getByRole('button', { name: translate('terrain.brush') });
    while (scroller && scroller.style.overflowX !== 'auto') scroller = scroller.parentElement;
    expect(scroller).not.toBeNull();
    // jsdom has no layout: the room is the row's top padding, which its margin takes back.
    const top = firstSide(scroller!.style.padding);
    expect(top).toContain(CONTROL_CLEARANCE);
    expect(scroller!.style.margin.startsWith(`calc(0px - ${top})`)).toBe(true);
  });

  spec('UI-28', 'the object panel turns its cards into one sideways row when the handle leaves room for less than two rows, and back', () => {
    mount('portrait');
    fireEvent.click(screen.getByRole('button', { name: translate('mode.object') }));
    const grid = () => screen.getByTestId('shell-shelf-grid');
    expect(grid().dataset.arrangement).toBe('grid');
    const handle = screen.getByTestId('shell-shelf-handle');
    for (let i = 0; i < 8; i++) fireEvent.keyDown(handle, { key: 'ArrowDown' });
    expect(grid().dataset.arrangement).toBe('row');
    expect(grid().style.overflowX).toBe('auto');
    for (let i = 0; i < 8; i++) fireEvent.keyDown(handle, { key: 'ArrowUp' });
    expect(grid().dataset.arrangement).toBe('grid');
    __resetUprightGrid();
  });

  spec('UI-28', 'a phone turned to landscape with the object panel open keeps the mode and the selection', () => {
    const view = mount('portrait');
    fireEvent.click(screen.getByRole('button', { name: translate('mode.object') }));
    const selection = [{ kind: 'object' as const, id: 'kept' }];
    act(() => { useEditorStore.setState({ selection }); });
    sizeWindow(844, 390);
    view.turn('landscape');
    expect(document.querySelector<HTMLElement>('[data-placement]')!.dataset.placement).toBe('top');
    expect(useEditorStore.getState().editMode.mode).toBe('object');
    expect(useEditorStore.getState().selection).toEqual(selection);
    expect(screen.getByRole('button', { name: translate('mode.object') }).getAttribute('aria-pressed')).toBe('true');
  });
});
