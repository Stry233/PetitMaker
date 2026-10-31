// @vitest-environment jsdom
/**
 * The upright arrangement on a rendered shell: the mode tiles in a bar at the window's foot, the corner
 * actions top right, tiles that stay put as modes open and close, and a turn to landscape that keeps
 * what was open and selected. Positions are read from the styles the plan writes, since jsdom has no
 * layout; how it looks is checked in a browser.
 */
import { afterEach, beforeEach, describe, expect, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { spec } from '../../_support/spec';
import { EDGE, EDGE_RIGHT, MODE, UPRIGHT_TOUCH_EDGE } from '../../../ui/shell/units';
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

/** The mode row's box and every tile's own box, as the plan wrote them. */
function tilePlaces(): string[] {
  const row = document.querySelector<HTMLElement>('[data-placement]')!;
  const tiles = MODES.map((art) => screen.getByRole('button', { name: translate(art.labelKey) }));
  return [`${row.style.left}|${row.style.top}|${row.style.gap}`, ...tiles.map((t) => `${t.style.width}x${t.style.height}`)];
}

/** The frame's width in its own px: the window's over the frame's zoom. */
function frameWidth(): number {
  const zoomed = document.querySelector<HTMLElement>('[style*="--shell-zoom"]')!;
  return window.innerWidth / parseFloat(zoomed.style.getPropertyValue('--shell-zoom'));
}

/** The side margins the open panel keeps its content within: the first box in it that pads its sides. */
function panelInsets(): [number, number] {
  const panel = document.querySelector<HTMLElement>('[data-bar-panel]')!;
  const padded = [panel, ...panel.querySelectorAll<HTMLElement>('*')].find((el) => parseFloat(el.style.paddingLeft) > 0)!;
  return [parseFloat(padded.style.paddingLeft), parseFloat(padded.style.paddingRight)];
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

/** The nearest fixed box holding `el`, where the frame places a cluster. */
function fixedBox(el: HTMLElement): HTMLElement {
  let box: HTMLElement | null = el;
  while (box && box.style.position !== 'fixed') box = box.parentElement;
  return box!;
}

beforeEach(() => {
  localStorage.setItem(TOUR_SEEN_KEY, TOUR_OFFERED);
  setStoreState({ locale: 'en', assistantOpen: false, tourRunning: false });
  useEditorStore.getState().setEditMode({ mode: null });
  sizeWindow(390, 844);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); sizeWindow(1024, 768); });

describe('the upright arrangement', () => {
  spec('UI-28', 'at 390x844 the mode tiles sit in a bottom bar and the corner actions top right', () => {
    mount('portrait');
    const row = document.querySelector<HTMLElement>('[data-placement]')!;
    expect(row.dataset.placement).toBe('bottom');
    // Held from the frame's foot, in its lower half.
    expect(parseFloat(row.style.bottom)).toBeLessThan(844 / 2);
    expect(screen.getByTestId('shell-mode-band')).toBeTruthy();
    const corner = screen.getByTestId('shell-corner-actions');
    expect(parseFloat(corner.style.top)).toBeLessThan(844 / 8);
    // The wide arrangement's right gutter, narrowed toward EDGE where the top row needs it.
    expect(parseFloat(corner.style.right)).toBeLessThanOrEqual(EDGE_RIGHT);
    expect(parseFloat(corner.style.right)).toBeGreaterThanOrEqual(EDGE);
  });

  spec('UI-28', 'the tiles keep their x and y when a mode opens and closes', () => {
    mount('portrait');
    const closed = tilePlaces();
    for (const art of MODES) {
      fireEvent.click(screen.getByRole('button', { name: translate(art.labelKey) }));
      expect(useEditorStore.getState().editMode.mode).toBe(art.id);
      expect(tilePlaces(), art.id).toEqual(closed);
      fireEvent.click(screen.getByRole('button', { name: translate(art.labelKey) }));
      expect(useEditorStore.getState().editMode.mode).toBe(null);
      expect(tilePlaces(), art.id).toEqual(closed);
    }
  });

  spec('UI-28', 'where the mode tiles cannot keep the wide margins, every surface keeps the narrower one they keep', () => {
    sizeWindow(360, 740);
    mount('portrait');
    const row = document.querySelector<HTMLElement>('[data-placement]')!;
    const left = parseFloat(row.style.left);
    const right = frameWidth() - left - MODES.length * MODE.size - (MODES.length - 1) * parseFloat(row.style.gap);
    expect(left).toBeLessThan(EDGE_RIGHT);
    expect(right).toBeCloseTo(left, 3);
    expect(parseFloat(screen.getByTestId('shell-corner-actions').style.right)).toBeCloseTo(right, 3);
    expect(parseFloat(fixedBox(screen.getByRole('button', { name: translate('a11y.undo') })).style.right)).toBeCloseTo(right, 3);
    for (const mode of ['mode.road', 'mode.object', 'mode.generate'] as const) {
      fireEvent.click(screen.getByRole('button', { name: translate(mode) }));
      const [padLeft, padRight] = panelInsets();
      expect(padLeft, mode).toBeCloseTo(left, 3);
      expect(padRight, mode).toBeCloseTo(right, 3);
    }
  });

  spec('UI-28', 'in touch mode a tablet held upright keeps one smaller margin on both sides, every surface with it', () => {
    sizeWindow(820, 1180);
    mount('portrait');
    const side = UPRIGHT_TOUCH_EDGE.side;
    const corner = screen.getByTestId('shell-corner-actions');
    expect(parseFloat(corner.style.right)).toBeCloseTo(side, 3);
    expect(parseFloat(corner.style.top)).toBeCloseTo(UPRIGHT_TOUCH_EDGE.top, 3);
    expect(parseFloat(fixedBox(screen.getByRole('button', { name: translate('a11y.undo') })).style.right)).toBeCloseTo(side, 3);
    for (const mode of ['mode.road', 'mode.object', 'mode.generate'] as const) {
      fireEvent.click(screen.getByRole('button', { name: translate(mode) }));
      const [padLeft, padRight] = panelInsets();
      expect(padLeft, mode).toBeCloseTo(side, 3);
      expect(padRight, mode).toBeCloseTo(side, 3);
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
