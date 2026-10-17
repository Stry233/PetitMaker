// @vitest-environment jsdom
/**
 * A press on a shelf card: a tap arms it as before, a hold or a moving mouse carries it, and a
 * finger that slides before the hold scrolls the row and carries nothing. The click a carry or a
 * scroll ends with never toggles the card. Driven through the real shelf, on fake time.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, render, screen, cleanup, fireEvent } from '@testing-library/react';
import { I18nProvider } from '../../../../../i18n/context';
import { useEditorStore } from '../../../../../state/store';
import { ScaleProvider } from '../../../../../ui/design/scale';
import { ObjectShelf } from '../../../../../ui/shell/bars/objects/ObjectShelf';
import { armedItemOf } from '../../../../../state/editing/edit-mode';
import { isCarried } from '../../../../../view/interaction/pointer/carry';
import { LIST_HOLD_MS } from '../../../../../view/interaction/press/list-press';
import { TOUCH_SLOP } from '../../../../../view/interaction/press/travel';

const ITEM = 'tree-apple';

/** jsdom has no PointerEvent; a MouseEvent of the pointer type carries what the card reads. */
function pointer(el: Element, type: string, { pointerType = 'mouse', x = 0, y = 0 } = {}): void {
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y });
  Object.defineProperties(e, { pointerId: { value: 3 }, pointerType: { value: pointerType } });
  act(() => { el.dispatchEvent(e); });
}

const card = () => screen.getByRole('button', { name: 'Apple Tree' });
const armed = () => armedItemOf(useEditorStore.getState());

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
  useEditorStore.setState({ locale: 'en' });
  useEditorStore.getState().setEditMode({ mode: 'object', arm: { kind: 'none' } });
  // Nothing under the pointer is a map, so every carry here ends over the shelf.
  document.elementFromPoint = () => card();
  render(<I18nProvider><ScaleProvider value={0.5}><ObjectShelf /></ScaleProvider></I18nProvider>);
  fireEvent.click(screen.getByRole('tab', { name: 'Trees' }));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  delete (document as { elementFromPoint?: unknown }).elementFromPoint;
  useEditorStore.getState().setEditMode({ mode: null, arm: { kind: 'none' } });
});

describe('a press on a shelf card', () => {
  it('is a tap when it lifts before the hold: the card arms', () => {
    pointer(card(), 'pointerdown');
    pointer(card(), 'pointerup');
    fireEvent.click(card());
    expect(armed()).toBe(ITEM);
    act(() => { vi.advanceTimersByTime(LIST_HOLD_MS * 2); });
    expect(isCarried(3)).toBe(false);
  });

  it('lifts the card when held, and the release over the shelf puts it back without arming', () => {
    pointer(card(), 'pointerdown');
    act(() => { vi.advanceTimersByTime(LIST_HOLD_MS); });
    expect(isCarried(3)).toBe(true);
    expect(armed()).toBe(ITEM); // armed for the carry alone

    pointer(card(), 'pointerup');
    fireEvent.click(card());
    expect(isCarried(3)).toBe(false);
    expect(armed()).toBeNull(); // nor did the click that ended it toggle the card on
  });

  it('carries at once when a mouse moves past the drag threshold', () => {
    pointer(card(), 'pointerdown', { x: 50, y: 50 });
    pointer(card(), 'pointermove', { x: 50, y: 40 });
    expect(isCarried(3)).toBe(true);
    pointer(card(), 'pointerup', { x: 50, y: 40 });
    expect(isCarried(3)).toBe(false);
  });

  it('leaves a finger that slides before the hold to scroll the row', () => {
    pointer(card(), 'pointerdown', { pointerType: 'touch', x: 50, y: 50 });
    pointer(card(), 'pointermove', { pointerType: 'touch', x: 50 - TOUCH_SLOP - 1, y: 50 });
    act(() => { vi.advanceTimersByTime(LIST_HOLD_MS * 2); });
    expect(isCarried(3)).toBe(false);
    expect(armed()).toBeNull();
  });

  it('lifts under a held finger, and the browser taking the touch puts it back', () => {
    pointer(card(), 'pointerdown', { pointerType: 'touch' });
    act(() => { vi.advanceTimersByTime(LIST_HOLD_MS); });
    expect(isCarried(3)).toBe(true);
    pointer(card(), 'pointercancel', { pointerType: 'touch' });
    expect(isCarried(3)).toBe(false);
    expect(armed()).toBeNull();
  });

  it('stays a tap for the keyboard after a carry', () => {
    pointer(card(), 'pointerdown');
    act(() => { vi.advanceTimersByTime(LIST_HOLD_MS); });
    pointer(card(), 'pointerup');
    act(() => { vi.advanceTimersByTime(1); }); // no click followed the release
    fireEvent.click(card()); // Enter on the focused card
    expect(armed()).toBe(ITEM);
  });
});
