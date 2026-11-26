// @vitest-environment jsdom
/**
 * Carrying blueprint cards out of the strip and the explorer: onto a folder they are filed there with a
 * toast naming it, a selection travelling together; a lone card carried above the explorer folds it
 * until the release; a finger lifts a card only after the hold. Driven through the real shelf; hit
 * testing and the explorer's top are the stubs jsdom needs.
 */
import { afterEach, beforeEach, expect, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MotionConfig } from 'framer-motion';
import { spec } from '../../../../_support/spec';
import { setStoreState } from '../../../../_support/store';
import { I18nProvider } from '../../../../../i18n/context';
import { useEditorStore } from '../../../../../state/store';
import type { BlueprintRecord } from '../../../../../io/blueprint';
import type { InputMode } from '../../../../../platform/device/input-mode';
import type { LayoutShape } from '../../../../../platform/device/layout-shape';
import { GESTURE_TIMING } from '../../../../../platform/input/gesture-timing';
import { isCarried } from '../../../../../view/interaction/pointer/carry';
import { InputModeProvider } from '../../../../../ui/design/input-mode';
import { FrameLayoutProvider } from '../../../../../ui/shell/frame-layout';
import { BlueprintShelf } from '../../../../../ui/shell/bars/blueprint/BlueprintShelf';
import { BLUEPRINT_CARD_ASPECT } from '../../../../../ui/shell/bars/blueprint/BlueprintCard';
import { __setBlueprintLibrary } from '../../../../../editor/editing/blueprint';
import { createBlueprintLibrary, memoryBlueprintBackend, memoryBlueprintLists } from '../../../../../io/storage/blueprint-library';
import { blueprintEditor, blueprintUi } from '../../../../spec/blueprints/_blueprints';

const { lib, toasts, action } = blueprintEditor();

const BODY = { w: 3, h: 2, cells: Array(12).fill(null), objects: [] } as unknown as BlueprintRecord['body'];

function record(id: string, name: string, folder: string | null, savedAt: number): BlueprintRecord {
  return {
    id, name, folder, author: null, origin: null, savedAt, appVersion: '0', body: BODY,
    thumbs: { flat: `data:image/png;base64,flat-${id}`, lifted: `data:image/png;base64,lifted-${id}` },
  };
}

/** What sits under a native point: the stub stands in for the browser's hit testing. */
let under: () => Element | null = () => null;

beforeEach(async () => {
  await lib().save(record('a', 'Harbour', 'Docks', 4));
  await lib().save(record('b', 'Garden corner', 'Gardens', 3));
  await lib().save(record('c', 'Market street', null, 2));
  await lib().save(record('d', 'Pier', 'Docks', 1));
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });
  under = () => null;
  document.elementFromPoint = (() => under()) as typeof document.elementFromPoint;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  delete (document as { elementFromPoint?: unknown }).elementFromPoint;
});

function mount(shape: LayoutShape = 'landscape', inputMode: InputMode = 'pc') {
  if (shape === 'portrait') {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 844 });
  }
  setStoreState({ locale: 'en' });
  useEditorStore.getState().setEditMode({ mode: 'blueprint' });
  return render(
    <MotionConfig reducedMotion="always">
      <InputModeProvider inputMode={inputMode} shape={shape}>
        <I18nProvider><FrameLayoutProvider><BlueprintShelf /></FrameLayoutProvider></I18nProvider>
      </InputModeProvider>
    </MotionConfig>,
  );
}

/** jsdom has no PointerEvent; a MouseEvent of the pointer type carries what the carry reads. */
function pointer(el: Element, type: string, { pointerType = 'mouse', x = 0, y = 0, pointerId = 3 } = {}): void {
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y });
  Object.defineProperties(e, { pointerId: { value: pointerId }, pointerType: { value: pointerType } });
  act(() => { el.dispatchEvent(e); });
}

const ui = blueprintUi;
const explorer = () => screen.queryByTestId('blueprint-explorer');
const card = (name: string) => within(screen.getByTestId('blueprint-explorer-cards')).getByRole('button', { name });
const folders = () => within(explorer()!).getByRole('tablist', { name: 'Blueprint' });
const unfold = () => act(() => { fireEvent.click(screen.getByTestId('shell-blueprint-unfold')); });
const folderOf = (id: string) => lib().records().find((r) => r.id === id)?.folder;

spec('BLUE-10', 'a carried card dropped on a folder moves the selection there', async () => {
  mount();
  unfold();
  fireEvent.click(card('Harbour'));
  fireEvent.click(card('Market street'), { ctrlKey: true });
  expect(ui().selected).toEqual(['a', 'c']);

  const gardens = within(folders()).getByRole('tab', { name: 'Gardens' });
  const harbour = card('Harbour');
  pointer(harbour, 'pointerdown', { x: 300, y: 600 });
  // A mouse past the drag threshold lifts the card, with its selection.
  under = () => gardens;
  pointer(harbour, 'pointermove', { x: 120, y: 500 });
  // Several cards never go to the map: nothing is armed for them.
  expect(ui().armed).toBeNull();
  expect(isCarried(3)).toBe(false);
  pointer(harbour, 'pointerup', { x: 120, y: 500 });

  await waitFor(() => expect(folderOf('c')).toBe('Gardens'));
  expect(folderOf('a')).toBe('Gardens');
  expect(folderOf('d')).toBe('Docks');
  expect(toasts()).toContain('2 blueprints moved to Gardens');
  // The release ended a carry, so its click selects nothing new.
  fireEvent.click(explorer()!);
  expect(ui().unfolded).toBe(true);
});

spec('BLUE-10', 'while a stack is carried the unfold square is the delete target; a drop there deletes, and undo restores', async () => {
  mount();
  unfold();
  fireEvent.click(card('Harbour'));
  fireEvent.click(card('Pier'), { ctrlKey: true });
  const bin = () => screen.queryByRole('img', { name: 'Delete' });
  const square = () => screen.queryByRole('button', { name: 'Expand' });
  expect(bin()).toBeNull();
  expect(square()).toBeTruthy();
  const harbour = card('Harbour');
  pointer(harbour, 'pointerdown', { x: 300, y: 600 });
  under = () => harbour;
  pointer(harbour, 'pointermove', { x: 900, y: 700 });
  // The square stands in its place as the delete target, only while something is carried; the face
  // fading out takes no press or focus.
  expect(bin()).toBeTruthy();
  expect(square()).toBeNull();
  expect(screen.getByTestId('shell-blueprint-fold').closest('[inert]')).not.toBeNull();
  expect(screen.getByTestId('shell-blueprint-bin').closest('[inert]')).toBeNull();
  // The stack the pointer carries wears its count.
  expect(within(screen.getByTestId('blueprint-carried')).getByText('2')).toBeTruthy();
  under = () => bin();
  pointer(harbour, 'pointermove', { x: 1200, y: 760 });
  pointer(harbour, 'pointerup', { x: 1200, y: 760 });
  await waitFor(() => expect(lib().records().map((r) => r.id)).toEqual(['b', 'c']));
  expect(toasts()).toContain('2 blueprints deleted');
  expect(bin()).toBeNull();
  expect(square()).toBeTruthy();
  expect(screen.getByTestId('shell-blueprint-bin').closest('[inert]')).not.toBeNull();
  expect(screen.getByTestId('shell-blueprint-fold').closest('[inert]')).toBeNull();
  // The toast's Undo puts them back as they were.
  expect(action()?.label).toBe('Undo');
  await act(async () => { action()!.run(); });
  await waitFor(() => expect(lib().records().map((r) => r.id)).toEqual(['a', 'b', 'c', 'd']));
  expect(folderOf('a')).toBe('Docks');
});

spec('BLUE-10', 'one card dropped on the strip\'s delete target is named in the toast', async () => {
  mount();
  const market = screen.getByRole('button', { name: 'Market street' });
  pointer(market, 'pointerdown', { x: 300, y: 700 });
  pointer(market, 'pointermove', { x: 400, y: 700 });
  under = () => screen.getByTestId('shell-blueprint-bin');
  pointer(market, 'pointermove', { x: 900, y: 700 });
  pointer(market, 'pointerup', { x: 900, y: 700 });
  await waitFor(() => expect(lib().records().map((r) => r.id)).toEqual(['a', 'b', 'd']));
  expect(toasts()).toContain('Deleted “Market street”');
  expect(ui().armed).toBeNull();
  expect(isCarried(3)).toBe(false);
});

spec('BLUE-10', 'a strip card carried onto a folder tab moves that card alone and puts the arming back', async () => {
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'Pier' }));
  expect(ui().armed).toBe('d');
  const market = screen.getByRole('button', { name: 'Market street' });
  pointer(market, 'pointerdown', { x: 300, y: 700 });
  under = () => screen.getByRole('tab', { name: 'Docks' });
  pointer(market, 'pointermove', { x: 200, y: 640 });
  // One card is armed for its carry, so over the map it would be the armed tool's ghost.
  expect(ui().armed).toBe('c');
  expect(isCarried(3)).toBe(true);
  pointer(market, 'pointerup', { x: 200, y: 640 });

  await waitFor(() => expect(folderOf('c')).toBe('Docks'));
  expect(toasts()).toContain('1 blueprint moved to Docks');
  expect(ui().armed).toBe('d');
  expect(isCarried(3)).toBe(false);
});

/** Every element's rect at the top of the window, except the edge a carry folds the explorer past. */
function edgeAt(top: number): void {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const y = this.hasAttribute('data-blueprint-carry-edge') ? top : 0;
    return { x: 0, y, top: y, left: 0, right: 0, bottom: y, width: 0, height: 0, toJSON: () => ({}) } as DOMRect;
  });
}

/** Whether the explorer can be seen: a folded one stays mounted out of sight. */
const explorerShown = () => {
  const el = explorer();
  return !!el && !el.closest('[style*="visibility: hidden"]');
};

spec('BLUE-03', 'a carried card leaving the explorer folds it until release', () => {
  mount();
  unfold();
  const top = 420;
  edgeAt(top);
  const pier = card('Pier');
  pointer(pier, 'pointerdown', { x: 300, y: 600 });
  pointer(pier, 'pointermove', { x: 300, y: 560 });
  expect(ui().armed).toBe('d');
  expect(explorerShown()).toBe(true);
  // Above the explorer's top the map is what the card is carried to: the explorer folds.
  pointer(pier, 'pointermove', { x: 300, y: top - 40 });
  expect(ui().unfolded).toBe(false);
  expect(explorerShown()).toBe(false);
  expect(screen.getByTestId('blueprint-cards')).toBeTruthy();
  // Released off any map, nothing lands; the arming goes back and the explorer unfolds again.
  pointer(pier, 'pointerup', { x: 300, y: top - 40 });
  expect(ui().unfolded).toBe(true);
  expect(ui().armed).toBeNull();
  expect(explorerShown()).toBe(true);
});

spec('BLUE-03', 'a carry that folded the explorer and ends after Blueprint mode was left never unfolds it again', () => {
  mount();
  unfold();
  const top = 420;
  edgeAt(top);
  const pier = card('Pier');
  pointer(pier, 'pointerdown', { x: 300, y: 600 });
  pointer(pier, 'pointermove', { x: 300, y: 560 });
  pointer(pier, 'pointermove', { x: 300, y: top - 40 });
  expect(ui().unfolded).toBe(false);
  act(() => { useEditorStore.getState().setEditMode({ mode: 'object' }); });
  pointer(pier, 'pointerup', { x: 300, y: top - 40 });
  act(() => { useEditorStore.getState().setEditMode({ mode: 'blueprint' }); });
  expect(ui().unfolded).toBe(false);
  expect(useEditorStore.getState().blueprintStep.at).toBe('strip');
});

/** jsdom has no TouchEvent constructor; an event carrying the changed touches is what the carry reads. */
function touch(el: Element, type: string, { x = 0, y = 0, id = 7 } = {}): void {
  const e = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(e, 'changedTouches', { value: [{ identifier: id, clientX: x, clientY: y }] });
  act(() => { el.dispatchEvent(e); });
}

/** jsdom has no pointer capture; this models a browser's. The element taking a pointer holds it, and
 *  `send` hands that pointer's events to the holder wherever the point is, else to what stands under
 *  it; a release or cancel lets go once heard. A holder leaving the document lets go at once, even when
 *  it is only moved within it, and unless it takes the pointer again first it hears lostpointercapture
 *  with the pointer's next event. */
function captureOn() {
  const held = new Map<number, Element>();
  const lost = new Map<number, Element>();
  const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
  const before = ['setPointerCapture', 'hasPointerCapture', 'releasePointerCapture'].map((k) => [k, proto[k]] as const);
  const lose = (records: MutationRecord[]): void => {
    for (const r of records) for (const gone of r.removedNodes) for (const [id, el] of held) {
      if (gone.contains(el)) { held.delete(id); lost.set(id, el); }
    }
  };
  const watch = new MutationObserver(lose);
  /** What the document did so far, heard before any use of the capture. */
  const settle = (): void => lose(watch.takeRecords());
  proto.setPointerCapture = function (this: Element, id: number) { settle(); held.set(id, this); };
  proto.hasPointerCapture = function (this: Element, id: number) { settle(); return held.get(id) === this; };
  proto.releasePointerCapture = function (this: Element, id: number) { settle(); if (held.get(id) === this) held.delete(id); };
  watch.observe(document.body, { childList: true, subtree: true });
  const send = async (type: string, at: { x: number; y: number; pointerId?: number }): Promise<void> => {
    await act(async () => {});
    settle();
    const id = at.pointerId ?? 3;
    const was = lost.get(id);
    lost.delete(id);
    if (was && held.get(id) !== was) pointer(was, 'lostpointercapture', { ...at, pointerId: id });
    pointer(held.get(id) ?? under() ?? document.body, type, { ...at, pointerId: id });
    if (type === 'pointerup' || type === 'pointercancel') held.delete(id);
  };
  return { send, restore: () => { watch.disconnect(); for (const [k, v] of before) proto[k] = v; } };
}

for (const view of ['grid', 'list'] as const) {
  spec('BLUE-03', `a stack carried back over a card it leaves out keeps going in the ${view}, the slot opening there`, async () => {
    const capture = captureOn();
    try {
      mount();
      act(() => { useEditorStore.getState().unfoldBlueprintExplorer([], { view }); });
      fireEvent.click(card('Harbour'));
      fireEvent.click(card('Market street'), { ctrlKey: true });
      const market = card('Market street');
      under = () => market;
      await capture.send('pointerdown', { x: 600, y: 350 });
      await capture.send('pointermove', { x: 500, y: 350 });
      // Back over Garden corner, which stands between the two it carries.
      under = () => card('Garden corner');
      await capture.send('pointermove', { x: 450, y: 350 });
      await capture.send('pointermove', { x: 440, y: 350 });
      expect(screen.getByTestId('blueprint-carried')).toBeTruthy();
      expect(screen.getByTestId('blueprint-explorer-cards').querySelector('[data-blueprint-gap]')).toBeTruthy();
      await capture.send('pointerup', { x: 440, y: 350 });
      await waitFor(() => expect(order()).toEqual(['b', 'a', 'c', 'd']));
    } finally {
      capture.restore();
    }
  });
}

spec('BLUE-03', 'a finger carrying a card above the explorer folds it until release, even once the browser takes the pointer', () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
  const { restore: release } = captureOn();
  try {
    mount('portrait', 'touch');
    act(() => { useEditorStore.getState().unfoldBlueprintExplorer([]); });
    const top = 300;
    edgeAt(top);
    const pier = card('Pier');
    pointer(pier, 'pointerdown', { pointerType: 'touch', x: 100, y: 600, pointerId: 11 });
    touch(pier, 'touchstart', { x: 100, y: 600 });
    act(() => { vi.advanceTimersByTime(GESTURE_TIMING.touch.holdMs + 1); });
    expect(isCarried(11)).toBe(true);
    // The browser takes the pointer stream; the finger's touches carry on.
    pointer(pier, 'pointercancel', { pointerType: 'touch', x: 100, y: 590, pointerId: 11 });
    expect(isCarried(11)).toBe(true);
    touch(pier, 'touchmove', { x: 100, y: top - 50 });
    expect(ui().unfolded).toBe(false);
    expect(explorerShown()).toBe(false);
    touch(pier, 'touchend', { x: 100, y: top - 50 });
    expect(isCarried(11)).toBe(false);
    expect(ui().unfolded).toBe(true);
    expect(ui().armed).toBeNull();
  } finally {
    release();
  }
});

spec('BLUE-10', 'a finger lifts a card only after the hold, and otherwise scrolls', () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
  mount('portrait', 'touch');
  const pier = screen.getByRole('button', { name: 'Pier' });
  // A finger that slides before the hold scrolls the row.
  pointer(pier, 'pointerdown', { pointerType: 'touch', x: 100, y: 700, pointerId: 9 });
  pointer(pier, 'pointermove', { pointerType: 'touch', x: 160, y: 700, pointerId: 9 });
  act(() => { vi.advanceTimersByTime(GESTURE_TIMING.touch.holdMs * 2); });
  expect(isCarried(9)).toBe(false);
  pointer(pier, 'pointerup', { pointerType: 'touch', x: 160, y: 700, pointerId: 9 });
  // Held still, it lifts, and the row gives way to the line saying a release here puts it back.
  pointer(pier, 'pointerdown', { pointerType: 'touch', x: 100, y: 700, pointerId: 10 });
  act(() => { vi.advanceTimersByTime(GESTURE_TIMING.touch.holdMs + 1); });
  expect(isCarried(10)).toBe(true);
  expect(screen.getByRole('status').textContent).toMatch(/cancel/i);
  pointer(pier, 'pointerup', { pointerType: 'touch', x: 100, y: 700, pointerId: 10 });
  expect(isCarried(10)).toBe(false);
  expect(ui().armed).toBeNull();
});

spec('BLUE-10', 'a card carried over the explorer lifts and its copy follows the pointer until the release', async () => {
  mount();
  unfold();
  const harbour = card('Harbour');
  pointer(harbour, 'pointerdown', { x: 300, y: 600 });
  under = () => within(folders()).getByRole('tab', { name: 'Gardens' });
  pointer(harbour, 'pointermove', { x: 120, y: 500 });
  // The card in the grid rises off it, and a copy of it stands under the pointer.
  expect(harbour.getAttribute('data-lifted')).toBe('');
  const carried = screen.getByTestId('blueprint-carried');
  expect(within(carried).getByText('Harbour')).toBeTruthy();
  pointer(harbour, 'pointermove', { x: 110, y: 480 });
  expect(carried.style.transform).toContain('110');
  pointer(harbour, 'pointerup', { x: 110, y: 480 });
  await waitFor(() => expect(folderOf('a')).toBe('Gardens'));
  expect(screen.queryByTestId('blueprint-carried')).toBeNull();
  expect(harbour.hasAttribute('data-lifted')).toBe(false);
});

/** The carried copy's size while the entry `entry` finds is carried over the shelf, released at once. */
function carriedSize(entry: () => HTMLElement): [number, number] {
  const el = entry();
  pointer(el, 'pointerdown', { x: 600, y: 320 });
  under = () => el;
  pointer(el, 'pointermove', { x: 500, y: 330 });
  const carried = screen.getByTestId('blueprint-carried');
  const size: [number, number] = [parseFloat(carried.style.width), parseFloat(carried.style.height)];
  pointer(el, 'pointerup', { x: 500, y: 330 });
  return size;
}

spec('BLUE-03', 'a card carried from the strip, the explorer\'s grid or the details list follows the pointer at one size', () => {
  mount();
  const strip = carriedSize(() => screen.getByRole('button', { name: 'Harbour' }));
  expect(strip[0]).toBeGreaterThan(0);
  unfold();
  expect(carriedSize(() => card('Harbour'))).toEqual(strip);
  act(() => { useEditorStore.getState().setBlueprintUi({ view: 'list' }); });
  expect(carriedSize(() => card('Harbour'))).toEqual(strip);
});

spec('BLUE-10', 'a row carried from the details list lifts and a card follows the pointer, held by its middle', async () => {
  mount();
  act(() => { useEditorStore.getState().unfoldBlueprintExplorer([], { view: 'list' }); });
  const row = card('Harbour');
  pointer(row, 'pointerdown', { x: 600, y: 320 });
  under = () => row;
  pointer(row, 'pointermove', { x: 500, y: 330 });
  expect(row.getAttribute('data-lifted'), 'the row rises off the list').toBe('');
  const carried = screen.getByTestId('blueprint-carried');
  // A card, not a stretched copy of the row: of a card's shape, held by its middle.
  const [w, h] = [parseFloat(carried.style.width), parseFloat(carried.style.height)];
  expect(w / h).toBeCloseTo(BLUEPRINT_CARD_ASPECT, 2);
  expect(carried.style.transform).toBe(`translate(500px, 330px) translate(${-w / 2}px, ${-h / 2}px)`);
  pointer(row, 'pointerup', { x: 500, y: 330 });
  expect(screen.queryByTestId('blueprint-carried')).toBeNull();
  expect(row.hasAttribute('data-lifted')).toBe(false);
});

/** Draws the slot holding `el` at `left`..`left + 100` across and 300..400 down, the rest where jsdom leaves it. */
function slotDrawnAt(el: HTMLElement, left: number): () => void {
  const slot = el.closest('[data-blueprint-slot]')!;
  const real = Element.prototype.getBoundingClientRect;
  const spy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this !== slot) return real.call(this);
    return { x: left, y: 300, left, top: 300, width: 100, height: 100, right: left + 100, bottom: 400, toJSON: () => ({}) } as DOMRect;
  });
  return () => spy.mockRestore();
}

/** Carries `from` with a mouse onto `onto`'s slot at `x` (its slot drawn from 100 to 200 across), and lets go there. */
function dropAmong(from: HTMLElement, onto: HTMLElement, x: number): void {
  const restore = slotDrawnAt(onto, 100);
  pointer(from, 'pointerdown', { x: 600, y: 350 });
  under = () => onto;
  pointer(from, 'pointermove', { x, y: 350 });
  pointer(from, 'pointermove', { x, y: 350 });
  pointer(from, 'pointerup', { x, y: 350 });
  restore();
}

const stripNames = () => [...screen.getByTestId('blueprint-cards').querySelectorAll('[data-blueprint-id]')].map((b) => b.getAttribute('aria-label'));
const order = () => lib().records().map((r) => r.id);

spec('BLUE-10', 'a strip card dropped among the others takes the slot it was let go in, kept by the library', async () => {
  mount();
  expect(stripNames()).toEqual(['Harbour', 'Garden corner', 'Market street', 'Pier']);
  const strip = (name: string) => within(screen.getByTestId('blueprint-cards')).getByRole('button', { name });
  // Over the near half of a card it goes before it.
  dropAmong(strip('Pier'), strip('Harbour'), 120);
  expect(stripNames()).toEqual(['Pier', 'Harbour', 'Garden corner', 'Market street']);
  await waitFor(() => expect(order()).toEqual(['d', 'a', 'b', 'c']));
  // Over the far half, after it; nothing was armed or placed on the way.
  dropAmong(strip('Pier'), strip('Garden corner'), 180);
  await waitFor(() => expect(order()).toEqual(['a', 'b', 'd', 'c']));
  expect(stripNames()).toEqual(['Harbour', 'Garden corner', 'Pier', 'Market street']);
  expect(ui().armed).toBeNull();
  expect(isCarried(3)).toBe(false);
  expect(toasts()).toEqual([]);
});

spec('BLUE-10', 'a selection carried among the explorer\'s cards in a folder moves beside its neighbours there', async () => {
  mount();
  unfold();
  act(() => { fireEvent.click(within(folders()).getByRole('tab', { name: 'Docks' })); });
  // Docks shows Harbour then Pier; Pier dropped before Harbour leads All too.
  dropAmong(card('Pier'), card('Harbour'), 120);
  await waitFor(() => expect(order()).toEqual(['d', 'a', 'b', 'c']));
  act(() => { fireEvent.click(within(folders()).getByRole('tab', { name: 'All' })); });
  fireEvent.click(card('Garden corner'));
  fireEvent.click(card('Market street'), { ctrlKey: true });
  dropAmong(card('Garden corner'), card('Pier'), 120);
  await waitFor(() => expect(order()).toEqual(['b', 'c', 'd', 'a']));
  expect(ui().selected).toEqual(['b', 'c']);
});

spec('BLUE-10', 'dragging a row of the sorted details list drops the sort and moves it in the library\'s order', async () => {
  mount();
  act(() => { useEditorStore.getState().unfoldBlueprintExplorer([], { view: 'list' }); });
  act(() => { fireEvent.click(within(explorer()!).getByRole('button', { name: 'Name' })); });
  const rows = () => [...screen.getByTestId('blueprint-explorer-cards').querySelectorAll('[data-blueprint-id]')].map((b) => b.getAttribute('aria-label'));
  expect(rows()).toEqual(['Garden corner', 'Harbour', 'Market street', 'Pier']);
  const market = card('Market street');
  pointer(market, 'pointerdown', { x: 600, y: 350 });
  under = () => card('Pier');
  pointer(market, 'pointermove', { x: 500, y: 390 });
  // Carried over the rows, the list shows the library's own order, no column pressed.
  expect(ui().sort).toBeNull();
  expect(within(explorer()!).getByRole('button', { name: 'Name' }).getAttribute('aria-pressed')).toBe('false');
  expect(rows()).toEqual(['Harbour', 'Garden corner', 'Market street', 'Pier']);
  pointer(market, 'pointermove', { x: 500, y: 390 });
  pointer(market, 'pointerup', { x: 500, y: 390 });
  await waitFor(() => expect(order()).toEqual(['a', 'b', 'd', 'c']));
  expect(rows()).toEqual(['Harbour', 'Garden corner', 'Pier', 'Market street']);
});

spec('BLUE-10', 'a row whose place the dropped sort changes stays carried over the rows', async () => {
  const capture = captureOn();
  try {
    mount();
    act(() => { useEditorStore.getState().unfoldBlueprintExplorer([], { view: 'list' }); });
    act(() => { fireEvent.click(within(explorer()!).getByRole('button', { name: 'Name' })); });
    // Sorted by name Garden corner leads; in the library's order it stands second.
    const garden = card('Garden corner');
    under = () => garden;
    await capture.send('pointerdown', { x: 600, y: 350 });
    under = () => card('Pier');
    await capture.send('pointermove', { x: 500, y: 390 });
    expect(ui().sort).toBeNull();
    await capture.send('pointermove', { x: 500, y: 395 });
    await capture.send('pointermove', { x: 500, y: 400 });
    expect(screen.getByTestId('blueprint-carried')).toBeTruthy();
    await capture.send('pointerup', { x: 500, y: 400 });
    await waitFor(() => expect(order()).toEqual(['a', 'c', 'd', 'b']));
  } finally {
    capture.restore();
  }
});

spec('BLUE-10', 'two drops among the strip\'s cards each show at once, the first landing never undoing the second', async () => {
  const inner = memoryBlueprintBackend();
  let wait: Promise<void> | null = null;
  const slow = createBlueprintLibrary({ ...inner, put: async (r) => { if (wait) await wait; await inner.put(r); } }, memoryBlueprintLists());
  for (const r of lib().records()) await slow.save(r);
  const restore = __setBlueprintLibrary(slow);
  try {
    mount();
    const strip = (name: string) => within(screen.getByTestId('blueprint-cards')).getByRole('button', { name });
    /** Holds the library's next write that starts until the returned release, so the moves queued behind it wait. */
    const holdQueue = async (id: string): Promise<() => void> => {
      let go!: () => void;
      wait = new Promise<void>((r) => { go = r; });
      void slow.rename(id, slow.records().find((r) => r.id === id)!.name);
      await act(async () => { await Promise.resolve(); });
      return go;
    };
    const first = await holdQueue('c');
    dropAmong(strip('Pier'), strip('Harbour'), 120);
    expect(stripNames()).toEqual(['Pier', 'Harbour', 'Garden corner', 'Market street']);
    const second = await holdQueue('b');
    dropAmong(strip('Pier'), strip('Garden corner'), 180);
    expect(stripNames()).toEqual(['Harbour', 'Garden corner', 'Pier', 'Market street']);
    // The first move lands while the second still waits: the cards keep showing the second.
    first();
    await waitFor(() => expect(slow.records().map((r) => r.id)).toEqual(['d', 'a', 'b', 'c']));
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(stripNames()).toEqual(['Harbour', 'Garden corner', 'Pier', 'Market street']);
    second();
    await waitFor(() => expect(slow.records().map((r) => r.id)).toEqual(['a', 'b', 'd', 'c']));
    expect(stripNames()).toEqual(['Harbour', 'Garden corner', 'Pier', 'Market street']);
  } finally { restore(); }
});
