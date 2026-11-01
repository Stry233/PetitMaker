// @vitest-environment jsdom
/**
 * The upright bar raising each mode's panel on a rendered shell: the bar takes the panel's plate,
 * the terrain tools stack inside the cream one, and the object panel folds to the item it arms.
 * jsdom has no layout, so every panel reports one height; how it looks is checked in a browser.
 */
import { afterEach, beforeEach, describe, expect, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { spec } from '../../../_support/spec';
import { setStoreState } from '../../../_support/store';
import { I18nProvider, translate } from '../../../../i18n/context';
import { useEditorStore } from '../../../../state/store';
import { armedItemOf } from '../../../../state/editing/edit-mode';
import { InputModeProvider } from '../../../../ui/design/input-mode';
import { Shell } from '../../../../ui/shell/Shell';
import { __resetUprightGrid } from '../../../../ui/shell/bars/objects/UprightObjectPanel';
import { TOUR_OFFERED, TOUR_SEEN_KEY } from '../../../_support/tour';

vi.mock('../../../../view/map2d/capture/thumbnail', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../view/map2d/capture/thumbnail')>()),
  renderThumbnail: () => new Promise<null>(() => {}),
}));

/** The height every panel standing on the bar reports, in frame px. */
const PANEL_H = 300;

function sizeWindow(w: number, h: number): void {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: w });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: h });
  window.dispatchEvent(new Event('resize'));
}

/** Mounts the upright shell. */
function mount() {
  return render(
    <InputModeProvider inputMode="touch" shape="portrait">
      <I18nProvider><Shell onRestoreSession={() => {}}><div /></Shell></I18nProvider>
    </InputModeProvider>,
  );
}

function tile(key: Parameters<typeof translate>[0]): HTMLElement {
  return screen.getByRole('button', { name: translate(key) });
}

function grid(): HTMLElement | null {
  return screen.queryByTestId('shell-shelf-grid');
}

/** The slots stacked down an upright panel, top down, present ones only. */
function panelRows(panel: HTMLElement): (string | undefined)[] {
  const column = panel.querySelector('[data-toolbar-slot="tools"]')!.parentElement!;
  return [...column.children].filter((slot) => !slot.hasAttribute('inert')).map((slot) => (slot as HTMLElement).dataset.toolbarSlot);
}

/** A finger's pointer event at `clientY`; jsdom has no `PointerEvent`, so a mouse event carries its id. */
function finger(type: string, clientY: number): Event {
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientY });
  return Object.assign(e, { pointerId: 1, pointerType: 'touch' });
}

/** Drags `handle` `dy` css px down (negative is up) and lets go. */
function dragHandle(handle: HTMLElement, dy: number): void {
  fireEvent(handle, finger('pointerdown', 400));
  fireEvent(handle, finger('pointermove', 400 + dy));
  fireEvent(handle, finger('pointerup', 400 + dy));
}

const offsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')!;

beforeEach(() => {
  __resetUprightGrid();
  localStorage.setItem(TOUR_SEEN_KEY, TOUR_OFFERED);
  setStoreState({ locale: 'en', assistantOpen: false, tourRunning: false });
  useEditorStore.getState().setEditMode({ mode: null });
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get(this: HTMLElement) { return this.hasAttribute('data-bar-panel') ? PANEL_H : 0; },
  });
  sizeWindow(390, 844);
});
afterEach(() => {
  cleanup();
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', offsetHeight);
  sizeWindow(1024, 768);
});

describe('the upright bar raises the open mode panel', () => {
  spec('UI-28', 'opening objects in portrait raises a dark panel continuous with the bar', async () => {
    mount();
    expect(document.querySelector('[data-bar-panel]')).toBeNull();
    fireEvent.click(tile('mode.object'));
    expect(document.querySelector('[data-bar-panel="dark"]')).not.toBeNull();
    // Upright, the shelf draws no band of its own under the bar's.
    expect(screen.queryByTestId('bar-plate')).toBeNull();
    fireEvent.click(tile('mode.object'));
    await waitFor(() => expect(document.querySelector('[data-bar-panel]')).toBeNull());
  });

  spec('UI-28', 'the mountain toolbar shows its tool, shape and auto-trim groups inside a cream panel', () => {
    mount();
    fireEvent.click(tile('mode.mountain'));
    act(() => { useEditorStore.getState().setEditMode({ mode: 'mountain', arm: { kind: 'brush' } }); });
    const panel = document.querySelector<HTMLElement>('[data-bar-panel="cream"]')!;
    const inside = within(panel);
    expect(inside.getByRole('button', { name: translate('terrain.brush') })).toBeTruthy();
    const shapes = inside.getByRole('group', { name: translate('terrain.shapes') });
    const trim = inside.getByRole('group', { name: translate('edgecut.auto') });
    // Stacked: the shapes and auto-trim together in one row that scrolls sideways, over the tool row.
    expect(panelRows(panel)).toEqual(['settings', 'tools']);
    const settings = within(panel.querySelector<HTMLElement>('[data-toolbar-slot="settings"]')!).getByTestId('shell-tool-row');
    expect(settings.contains(shapes) && settings.contains(trim)).toBe(true);
  });

  spec('UI-28', 'the tool row stands lowest in a terrain panel whichever tool is armed', () => {
    mount();
    fireEvent.click(tile('mode.mountain'));
    const panel = () => document.querySelector<HTMLElement>('[data-bar-panel="cream"]')!;
    for (const kind of ['brush', 'erase', 'trim', 'brush'] as const) {
      act(() => { useEditorStore.getState().setEditMode({ mode: 'mountain', arm: { kind } }); });
      expect(panelRows(panel()).at(-1), kind).toBe('tools');
    }
    fireEvent.click(tile('mode.road'));
    expect(panelRows(document.querySelector<HTMLElement>('[data-bar-panel]')!).at(-1)).toBe('tools');
  });

  spec('UI-28', 'tapping a card arms it and collapses the panel, and the armed card shows in the bar', () => {
    mount();
    fireEvent.click(tile('mode.object'));
    const card = grid()!.querySelector<HTMLElement>('[data-catalog-id]')!;
    const id = card.dataset.catalogId!;
    const name = card.getAttribute('aria-label')!;
    fireEvent.click(card);
    expect(armedItemOf(useEditorStore.getState())).toBe(id);
    expect(grid()).toBeNull();
    const folded = screen.getByTestId('shell-shelf-folded');
    const armed = within(folded).getByRole('button', { name });
    expect(armed.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(armed);
    expect(grid()).not.toBeNull();
    expect(armedItemOf(useEditorStore.getState())).toBe(id);
  });

  spec('UI-29', 'the selected card shows its name and the others show none', () => {
    mount();
    fireEvent.click(tile('mode.object'));
    const card = grid()!.querySelectorAll<HTMLElement>('[data-catalog-id]')[1]!;
    fireEvent.click(card);
    fireEvent.click(screen.getByTestId('shell-shelf-folded').querySelector<HTMLElement>('[data-catalog-id]')!);
    const names = screen.getAllByTestId('shell-card-name').filter((el) => el.textContent);
    expect(names.map((el) => el.textContent)).toEqual([card.getAttribute('aria-label')]);
    expect(names[0]!.parentElement!.contains(grid()!.querySelector(`[data-catalog-id="${card.dataset.catalogId}"]`))).toBe(true);
  });

  spec('UI-28', 'a road surface or the surface switch reached in the cream panel shows its name outside the panel, which clips', async () => {
    mount();
    fireEvent.click(tile('mode.road'));
    act(() => { useEditorStore.getState().setEditMode({ mode: 'road', arm: { kind: 'brush' } }); });
    const panel = document.querySelector<HTMLElement>('[data-bar-panel="cream"]')!;
    for (const key of ['design.switch_to_prints', null] as const) {
      const control = key ? within(panel).getByRole('button', { name: translate(key) })
        : within(within(panel).getByRole('group', { name: translate('design.road_surface') })).getAllByRole('button')[0]!;
      const name = control.getAttribute('aria-label')!;
      act(() => { control.focus(); });
      const shown = await screen.findByText(name, { selector: ':not(button)' });
      expect(panel.contains(shown), name).toBe(false);
      act(() => { control.blur(); });
    }
  });

  spec('UI-28', 'the search button grows in place into the search field, and closing it brings the names back', () => {
    mount();
    fireEvent.click(tile('mode.object'));
    const pill = screen.getByTestId('shell-search-pill');
    const button = within(pill).getByRole('button', { name: translate('shelf.search') });
    expect(within(pill).queryByRole('searchbox')).toBeNull();
    fireEvent.click(button);
    // The same pill now holds the field, focused, across the row the names stood in.
    const field = within(pill).getByRole('searchbox');
    expect(document.activeElement).toBe(field);
    expect(screen.getByRole('tablist', { hidden: true }).closest('[inert]')).not.toBeNull();
    fireEvent.change(field, { target: { value: 'apple' } });
    expect(grid()!.querySelectorAll('[data-catalog-id]').length).toBeGreaterThan(0);
    fireEvent.click(button);
    expect(within(pill).queryByRole('searchbox')).toBeNull();
    expect(screen.getByRole('tablist').closest('[inert]')).toBeNull();
  });

  spec('UI-28', 'the object panel\'s handle sets the grid\'s height, kept for the session', () => {
    mount();
    fireEvent.click(tile('mode.object'));
    const handle = () => screen.getByRole('separator', { name: translate('shelf.resize') });
    const height = () => Math.round(parseFloat(grid()!.style.height));
    const rest = height();
    // Held still, the grid keeps its height.
    dragHandle(handle(), 2);
    expect(height()).toBe(rest);
    dragHandle(handle(), -2000);
    const set = height();
    expect(set).not.toBe(rest);
    // Closing and opening the panel again keeps the height the handle set.
    fireEvent.click(tile('mode.object'));
    fireEvent.click(tile('mode.object'));
    expect(height()).toBe(set);
  });

});
