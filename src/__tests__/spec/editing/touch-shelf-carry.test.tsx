// @vitest-environment jsdom
/**
 * A card carried from the object panel on an upright window with one finger: the panel folds down
 * to the bar while the card is carried, the bar stands as the place a release puts it back, and a
 * release over the map places it. The rendered shell stands over the map's own pointer machine; a
 * cell is ten screen pixels and the bar covers every screen row from `BAR_TOP` down.
 */
import { describe, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useRef } from 'react';
import { spec } from '../../_support/spec';
import { world, type SpecWorld } from '../_world';
import { objectsOf } from './_editing';
import { I18nProvider, translate } from '../../../i18n/context';
import { InputModeProvider } from '../../../ui/design/input-mode';
import { Shell } from '../../../ui/shell/Shell';
import { HoldRing } from '../../../ui/chrome/floating/HoldRing';
import { TOUR_OFFERED, TOUR_SEEN_KEY } from '../../_support/tour';
import { usePointerInteraction } from '../../../view/interaction/use-pointer-interaction';
import { registerToolManager, setActiveView } from '../../../view/active-view';
import { __resetCursorController } from '../../../view/interaction/cursor-controller';
import { isCarried } from '../../../view/interaction/pointer/carry';
import { GESTURE_TIMING } from '../../../platform/input/gesture-timing';
import { ToolManager, type ActiveView, type ToolOverlay } from '../../../tools/pointer/runtime';
import { editorToolWiring } from '../../../editor/session/tool-wiring';
import { useEditorStore } from '../../../state/store';
import { armedItemOf, armedPicksOf } from '../../../state/editing/edit-mode';
import { ToolType } from '../../../state/editing/vocabulary';
import { armedEditMode, resetStore, setStoreState } from '../../_support/store';
import { headlessViewVerbs } from '../../_support/tool-manager';
import type { MacroCoord } from '../../../core/model/types';

vi.mock('../../../view/map2d/capture/thumbnail', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../view/map2d/capture/thumbnail')>()),
  renderThumbnail: () => new Promise<null>(() => {}),
}));

const TREE = 'tree-apple';
const BAR_TOP = 1000;
const noop = (): void => {};
const overlay = new Proxy({} as ToolOverlay, { get: () => noop });
const view = {
  projection: {
    screenToPoint: (sx: number, sy: number) => ({ x: sx / 10, y: sy / 10 }),
    cellToScreen: (x: number, y: number) => ({ x: x * 10, y: y * 10, scale: 10 }),
  },
  overlay, camera: { pan: noop, zoomStep: noop, zoomBy: noop }, ...headlessViewVerbs(),
} as unknown as ActiveView;

function Canvas() {
  const ref = useRef<HTMLDivElement>(null);
  usePointerInteraction(ref);
  return <div ref={ref} data-testid="canvas" />;
}

let unsync: (() => void) | null = null;

/** One pointer event of `pointerType` at screen point (`x`, `y`), from pointer 4 unless `by` names
 *  another pointer. */
function pointer(by: string | { pointerType: string; id: number }, target: EventTarget, type: string, x: number, y: number): void {
  const { pointerType, id } = typeof by === 'string' ? { pointerType: by, id: 4 } : by;
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, buttons: type === 'pointerup' ? 0 : 1, clientX: x, clientY: y });
  Object.defineProperties(e, { pointerType: { value: pointerType }, pointerId: { value: id } });
  act(() => { target.dispatchEvent(e); });
}

/** One touch pointer event at screen point (`x`, `y`). */
function finger(target: EventTarget, type: string, x: number, y: number): void {
  pointer('touch', target, type, x, y);
}

/** Open ground in the editor with the object panel (the shelf row on a wide window) open on the trees. */
function openPanel(shape: 'portrait' | 'landscape' = 'portrait'): { w: SpecWorld; at: MacroCoord } {
  const w = world();
  const at = w.openGround(16, 16);
  setStoreState({ gridState: w.state, commandExecutor: w.sandbox.executor, selection: [], ...armedEditMode({ tool: ToolType.Hand }) });
  const manager = new ToolManager(view, w.sandbox.executor, w.state, editorToolWiring());
  registerToolManager(manager);
  unsync = useEditorStore.subscribe(() => manager.syncArming());
  render(
    <InputModeProvider inputMode="touch" shape={shape}>
      <I18nProvider><Shell onRestoreSession={() => {}}><Canvas /></Shell><HoldRing /></I18nProvider>
    </InputModeProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: translate('mode.object') }));
  fireEvent.click(screen.getByRole('tab', { name: translate('shelf.tab_tree') }));
  return { w, at };
}

const card = (id = TREE) => document.querySelector<HTMLElement>(`[data-testid="shell-shelf-grid"] [data-catalog-id="${id}"]`)!;
/** Whether `el` is out of sight: jsdom computes no inherited visibility, so the ancestors' own styles are read. */
function hidden(el: HTMLElement): boolean {
  for (let at: HTMLElement | null = el; at; at = at.parentElement) if (at.style.visibility === 'hidden') return true;
  return false;
}
const cancelLine = () => screen.queryByText(translate('shelf.carry_cancel'));

/** Lifts the tree card under a held finger. */
function lift(): void {
  const { x, y } = { x: 50, y: BAR_TOP + 200 };
  finger(card(), 'pointerdown', x, y);
  act(() => { vi.advanceTimersByTime(GESTURE_TIMING.touch.holdMs); });
}

beforeEach(() => {
  localStorage.setItem(TOUR_SEEN_KEY, TOUR_OFFERED);
  resetStore();
  setStoreState({ locale: 'en', assistantOpen: false, tourRunning: false });
  __resetCursorController();
  setActiveView(view);
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 844 });
  window.dispatchEvent(new Event('resize'));
  // Above the bar is the map; the bar and the panel standing on it are one surface below.
  document.elementFromPoint = (_x: number, y: number) => (y < BAR_TOP
    ? screen.getByTestId('canvas')
    : document.querySelector('[data-bar-panel]') ?? document.body);
});

afterEach(() => {
  vi.useRealTimers();
  unsync?.();
  unsync = null;
  cleanup();
  delete (document as { elementFromPoint?: unknown }).elementFromPoint;
  setActiveView(null);
  registerToolManager(null);
  __resetCursorController();
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 768 });
});

describe('carrying a card from the upright object panel', () => {
  spec('EDIT-41', 'a carried card collapses the panel and a release over the bar cancels', () => {
    const { w, at } = openPanel();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    expect(cancelLine()).toBeNull();
    const carried = card();
    lift();
    expect(isCarried(4)).toBe(true);
    // The card is still the one holding the finger, hidden with the rest of the panel's contents.
    expect(card()).toBe(carried);
    expect(carried.isConnected).toBe(true);
    expect(hidden(carried)).toBe(true);
    expect(cancelLine()).not.toBeNull();

    finger(carried, 'pointermove', (at.x + 4) * 10 + 5, (at.y + 4) * 10 + 5);
    finger(carried, 'pointermove', 50, BAR_TOP + 40);
    finger(carried, 'pointerup', 50, BAR_TOP + 40);
    expect(isCarried(4)).toBe(false);
    expect(objectsOf(w, TREE)).toHaveLength(0);
    expect(armedItemOf(useEditorStore.getState())).toBeNull();
    expect(cancelLine()).toBeNull();
    expect(hidden(card())).toBe(false);
  });

  spec('UI-28', 'a carry keeps the grid it began in when the window leaves room for one row only, and turns it once over', () => {
    openPanel();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    const grid = () => screen.getByTestId('shell-shelf-grid');
    expect(grid().dataset.arrangement).toBe('grid');
    const carried = card();
    lift();
    expect(isCarried(4)).toBe(true);
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 560 });
    act(() => { window.dispatchEvent(new Event('resize')); });
    // The carry goes on with the same card in the same grid.
    expect(isCarried(4)).toBe(true);
    expect(carried.isConnected).toBe(true);
    expect(grid().dataset.arrangement).toBe('grid');
    finger(carried, 'pointerup', 50, BAR_TOP + 40);
    expect(isCarried(4)).toBe(false);
    expect(grid().dataset.arrangement).toBe('row');
  });

  spec('EDIT-41', 'a card carried from the panel and released over the map is placed', () => {
    const { w, at } = openPanel();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    const carried = card();
    lift();
    const x = (at.x + 4) * 10 + 5, y = (at.y + 4) * 10 + 5;
    finger(carried, 'pointermove', x, y);
    finger(carried, 'pointerup', x, y);
    expect(objectsOf(w, TREE)).toHaveLength(1);
    expect(cancelLine()).toBeNull();
  });
});

describe('picking cards with a held finger', () => {
  spec('EDIT-70', 'a held card let go without reaching the map joins the armed cards, and a second hold takes it out', () => {
    openPanel();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    const hold = (id: string) => {
      finger(card(id), 'pointerdown', 50, BAR_TOP + 200);
      act(() => { vi.advanceTimersByTime(GESTURE_TIMING.touch.holdMs); });
      finger(card(id), 'pointerup', 50, BAR_TOP + 40);
    };
    hold(TREE);
    expect(armedPicksOf(useEditorStore.getState())).toEqual([TREE]);
    hold('tree-bamboo');
    expect(armedPicksOf(useEditorStore.getState())).toEqual([TREE, 'tree-bamboo']);
    hold(TREE);
    expect(armedPicksOf(useEditorStore.getState())).toEqual(['tree-bamboo']);
  });

  spec('EDIT-64', 'the upright names row holds the brush button left of the search button, pressable with nothing armed, and the folded card keeps one', () => {
    openPanel();
    const brush = () => screen.getByTestId('shell-shelf-brush');
    const search = screen.getByRole('button', { name: translate('shelf.search') });
    expect(brush().compareDocumentPosition(search) & Node.DOCUMENT_POSITION_FOLLOWING, 'the search is on the right').toBeTruthy();
    expect(brush().getAttribute('aria-disabled')).not.toBe('true');
    fireEvent.click(card());
    expect(screen.getByTestId('shell-shelf-folded')).toBeTruthy();
    expect(brush().getAttribute('aria-disabled')).not.toBe('true');
    fireEvent.click(brush());
    // The shelf fades out before the brush bar comes in.
    expect(useEditorStore.getState().objectBrushBar).toBe(true);
  });

});

describe('the hold ring on a shelf card', () => {
  const ring = () => screen.queryAllByTestId('press-hold')[0] ?? null;
  const press = { x: 50, y: BAR_TOP + 200 };

  for (const shape of ['portrait', 'landscape'] as const) {
    spec('EDIT-49', `a finger held on a ${shape} card fills a ring above it until the card lifts`, () => {
      if (shape === 'landscape') {
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1180 });
        Object.defineProperty(window, 'innerHeight', { configurable: true, value: 820 });
      }
      openPanel(shape);
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
      // The upright panel lays its cards in a grid, the wide shelf in one row.
      const held = shape === 'portrait' ? card() : document.querySelector<HTMLElement>(`[data-catalog-id="${TREE}"]`)!;
      finger(held, 'pointerdown', press.x, press.y);
      const shown = ring();
      expect(shown, 'the ring shows while the finger holds still').not.toBeNull();
      const top = parseFloat(shown!.style.top), height = parseFloat(shown!.style.height);
      expect(top + height, 'the ring stands wholly above the fingertip').toBeLessThan(press.y);
      act(() => { vi.advanceTimersByTime(GESTURE_TIMING.touch.holdMs - 1); });
      expect(ring(), 'the ring still fills a moment before the hold time').not.toBeNull();
      expect(isCarried(4)).toBe(false);
      act(() => { vi.advanceTimersByTime(1); });
      expect(isCarried(4), 'the card lifts at the hold time').toBe(true);
      expect(ring(), 'the carry takes over from the ring').toBeNull();
      finger(held, 'pointerup', press.x, BAR_TOP + 40);
    });
  }

  spec('EDIT-49', 'a finger that moves scrolls the shelf and the ring goes at once', () => {
    openPanel();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    finger(card(), 'pointerdown', press.x, press.y);
    expect(ring()).not.toBeNull();
    finger(card(), 'pointermove', press.x + GESTURE_TIMING.touch.dragThreshold + 1, press.y);
    expect(ring(), 'a scroll ends the ring').toBeNull();
    act(() => { vi.advanceTimersByTime(GESTURE_TIMING.touch.holdMs); });
    expect(isCarried(4), 'a scrolled press never lifts the card').toBe(false);
  });

  spec('EDIT-49', 'a finger that lifts before the hold time takes the ring with it', () => {
    openPanel();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    finger(card(), 'pointerdown', press.x, press.y);
    finger(card(), 'pointerup', press.x, press.y);
    expect(ring()).toBeNull();
  });

  spec('EDIT-49', 'a cancelled finger takes the ring with it, as does a pen whose capture is lost', () => {
    openPanel();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    finger(card(), 'pointerdown', press.x, press.y);
    expect(ring()).not.toBeNull();
    finger(card(), 'pointercancel', press.x, press.y);
    expect(ring(), 'the browser took the pointer').toBeNull();
    // A pen's press is captured by the card from the start, so it can lose that capture mid-hold.
    pointer('pen', card(), 'pointerdown', press.x, press.y);
    expect(ring()).not.toBeNull();
    pointer('pen', card(), 'lostpointercapture', press.x, press.y);
    expect(ring(), 'the card lost the pointer').toBeNull();
    act(() => { vi.advanceTimersByTime(GESTURE_TIMING.touch.holdMs); });
    expect(isCarried(4), 'neither press lifts the card').toBe(false);
  });

  spec('EDIT-49', 'a finger lifting from the map leaves the ring of a card another finger still holds', () => {
    openPanel();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    const canvas = screen.getByTestId('canvas');
    const other = { pointerType: 'touch', id: 7 };
    pointer(other, canvas, 'pointerdown', 100, 100);
    finger(card(), 'pointerdown', press.x, press.y);
    expect(ring()?.dataset.place).toBe('control');
    pointer(other, canvas, 'pointerup', 100, 100);
    expect(ring()?.dataset.place, 'the card is still held').toBe('control');
    act(() => { vi.advanceTimersByTime(GESTURE_TIMING.touch.holdMs); });
    expect(isCarried(4)).toBe(true);
    finger(card(), 'pointerup', press.x, BAR_TOP + 40);
  });

  spec('EDIT-49', 'a finger holding an object on the map rings its own press and leaves the card\'s ring standing', () => {
    const { w, at } = openPanel();
    const tree = w.sandbox.place(TREE, at.x, at.y);
    expect(tree, 'a tree stands on the map').not.toBeNull();
    const onTree = { x: at.x * 10 + 5, y: at.y * 10 + 5 };
    expect(onTree.y).toBeLessThan(BAR_TOP);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    finger(card(), 'pointerdown', press.x, press.y);
    const other = { pointerType: 'touch', id: 7 };
    pointer(other, screen.getByTestId('canvas'), 'pointerdown', onTree.x, onTree.y);
    const places = () => screen.queryAllByTestId('press-hold').map((r) => r.dataset.place);
    expect(places(), 'each held press shows its own ring').toEqual(['control', 'map']);
    pointer(other, screen.getByTestId('canvas'), 'pointerup', onTree.x, onTree.y);
    expect(places(), 'the map finger takes only its own ring').toEqual(['control']);
    act(() => { vi.advanceTimersByTime(GESTURE_TIMING.touch.holdMs); });
    expect(isCarried(4)).toBe(true);
    finger(card(), 'pointerup', press.x, BAR_TOP + 40);
  });

  spec('EDIT-49', 'a card pressed at the window\'s edge keeps its ring inside the window', () => {
    openPanel();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    finger(card(), 'pointerdown', 2, press.y);
    const left = parseFloat(ring()!.style.left), width = parseFloat(ring()!.style.width);
    expect(left).toBeGreaterThanOrEqual(0);
    expect(left + width).toBeLessThanOrEqual(window.innerWidth);
    finger(card(), 'pointerup', 2, press.y);
  });

  spec('EDIT-49', 'a mouse press on a card shows no ring', () => {
    openPanel();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    pointer('mouse', card(), 'pointerdown', press.x, press.y);
    expect(ring()).toBeNull();
    pointer('mouse', card(), 'pointerup', press.x, press.y);
  });
});
