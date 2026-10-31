// @vitest-environment jsdom
/**
 * The upright bar raising each mode's panel on a rendered shell: one surface from the window's foot
 * to the panel's top in the panel's plate, the terrain tools stacked inside the cream one, and the
 * object panel folding to the item it arms. jsdom has no layout, so every panel reports one height
 * and positions are read from the styles the plan writes; how it looks is checked in a browser.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Profiler } from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { spec } from '../../../_support/spec';
import { setStoreState } from '../../../_support/store';
import { I18nProvider, translate } from '../../../../i18n/context';
import { useEditorStore } from '../../../../state/store';
import { armedItemOf } from '../../../../state/editing/edit-mode';
import { InputModeProvider } from '../../../../ui/design/input-mode';
import { DARK_PLATE, INSET, PLATE } from '../../../../ui/design/tokens';
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

/** Mounts the upright shell; `onCommit` hears each React commit inside it. */
function mount(onCommit: () => void = () => {}) {
  return render(
    <Profiler id="shell" onRender={onCommit}>
      <InputModeProvider inputMode="touch" shape="portrait">
        <I18nProvider><Shell onRestoreSession={() => {}}><div /></Shell></I18nProvider>
      </InputModeProvider>
    </Profiler>,
  );
}

/** A colour as the DOM writes it back, so a token compares with a style read off an element. */
function painted(color: string): string {
  const probe = document.createElement('span');
  probe.style.background = color;
  return probe.style.background;
}

function band(): HTMLElement {
  return screen.getByTestId('shell-mode-band');
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
  spec('UI-28', 'opening objects in portrait raises a dark panel continuous with the bar', () => {
    mount();
    const rest = parseFloat(band().style.height);
    expect(band().style.background).toBe('transparent');
    fireEvent.click(tile('mode.object'));
    const panel = document.querySelector<HTMLElement>('[data-bar-panel="dark"]')!;
    // The panel stands on the bar, and the bar's band reaches exactly to the panel's top.
    expect(parseFloat(panel.style.bottom)).toBe(rest);
    expect(parseFloat(band().style.height)).toBe(rest + PANEL_H);
    expect(band().style.background).toBe(painted(DARK_PLATE));
    // Upright, the shelf draws no band of its own under the bar's.
    expect(screen.queryByTestId('bar-plate')).toBeNull();
    fireEvent.click(tile('mode.object'));
    expect(parseFloat(band().style.height)).toBe(rest);
    expect(band().style.background).toBe('transparent');
  });

  spec('UI-28', 'with no panel open the bar draws no surface and lets a press through to the map', () => {
    mount();
    expect(band().style.background).toBe('transparent');
    expect(band().style.pointerEvents).toBe('none');
    fireEvent.click(tile('mode.mountain'));
    expect(band().style.background).not.toBe('transparent');
    expect(band().style.pointerEvents).toBe('auto');
  });

  spec('UI-28', 'the mountain toolbar shows its tool, shape and auto-trim groups inside a cream panel', () => {
    mount();
    fireEvent.click(tile('mode.mountain'));
    act(() => { useEditorStore.getState().setEditMode({ mode: 'mountain', arm: { kind: 'brush' } }); });
    const panel = document.querySelector<HTMLElement>('[data-bar-panel="cream"]')!;
    // A step down the cream ramp, so the tool plates standing on it read against it.
    expect(band().style.background).toBe(painted(INSET));
    expect(band().style.background).not.toBe(painted(PLATE));
    const inside = within(panel);
    expect(inside.getByRole('button', { name: translate('terrain.brush') })).toBeTruthy();
    const shapes = inside.getByRole('group', { name: translate('terrain.shapes') });
    const trim = inside.getByRole('group', { name: translate('edgecut.auto') });
    // Stacked: the shapes and auto-trim together in one row that scrolls sideways, over the tool row.
    expect(panelRows(panel)).toEqual(['settings', 'tools']);
    const settings = within(panel.querySelector<HTMLElement>('[data-toolbar-slot="settings"]')!).getByTestId('shell-tool-row');
    expect(settings.contains(shapes) && settings.contains(trim)).toBe(true);
    expect(settings.style.overflowX).toBe('auto');
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
    expect(pill.style.width).toBe('100%');
    expect(screen.getByRole('tablist', { hidden: true }).closest('[inert]')).not.toBeNull();
    fireEvent.change(field, { target: { value: 'apple' } });
    expect(grid()!.querySelectorAll('[data-catalog-id]').length).toBeGreaterThan(0);
    fireEvent.click(button);
    expect(within(pill).queryByRole('searchbox')).toBeNull();
    expect(screen.getByRole('tablist').closest('[inert]')).toBeNull();
  });

  spec('UI-28', 'the object panel\'s handle sets the grid\'s height between one row and the room, kept for the session', () => {
    mount();
    fireEvent.click(tile('mode.object'));
    const handle = () => screen.getByRole('separator', { name: translate('shelf.resize') });
    const height = () => Math.round(parseFloat(grid()!.style.height));
    const least = Number(handle().getAttribute('aria-valuemin'));
    const most = Number(handle().getAttribute('aria-valuemax'));
    const rest = height();
    expect(rest).toBeGreaterThan(least);
    expect(rest).toBeLessThanOrEqual(most);
    // Held still, the grid keeps its height; dragged down past the least, it stops at one row.
    dragHandle(handle(), 2);
    expect(height()).toBe(rest);
    dragHandle(handle(), 2000);
    expect(height()).toBe(least);
    dragHandle(handle(), -2000);
    expect(height()).toBe(most);
    // Closing and opening the panel again keeps the height the handle set.
    fireEvent.click(tile('mode.object'));
    fireEvent.click(tile('mode.object'));
    expect(height()).toBe(most);
  });

  spec('UI-28', 'the object panel\'s grid follows its handle while held, past React, and lets go where the finger does', () => {
    let commits = 0;
    mount(() => { commits += 1; });
    fireEvent.click(tile('mode.object'));
    const handle = () => screen.getByRole('separator', { name: translate('shelf.resize') });
    const height = () => parseFloat(grid()!.style.height);
    const rest = height();
    fireEvent(handle(), finger('pointerdown', 400));
    // The first move past the threshold takes the hold; React hears that once.
    fireEvent(handle(), finger('pointermove', 420));
    const before = commits;
    fireEvent(handle(), finger('pointermove', 430));
    const held = height();
    expect(held).toBeLessThan(rest);
    fireEvent(handle(), finger('pointermove', 460));
    expect(height()).toBeLessThan(held);
    // The grid followed both moves with no commit of the frame.
    expect(commits).toBe(before);
    const last = height();
    fireEvent(handle(), finger('pointerup', 460));
    expect(height()).toBeCloseTo(last, 6);
  });

  it('a wider upright window gives the object grid more columns', () => {
    sizeWindow(820, 1180);
    mount();
    fireEvent.click(tile('mode.object'));
    expect(grid()!.style.gridTemplateColumns).toMatch(/^repeat\(\d+,/);
    const wide = Number(/repeat\((\d+),/.exec(grid()!.style.gridTemplateColumns)![1]);
    cleanup();
    sizeWindow(390, 844);
    mount();
    fireEvent.click(tile('mode.object'));
    const narrow = Number(/repeat\((\d+),/.exec(grid()!.style.gridTemplateColumns)![1]);
    expect(wide).toBeGreaterThan(narrow);
  });
});
