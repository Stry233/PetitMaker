// @vitest-environment jsdom
/**
 * A press on a shelf card: a tap arms it, a hold or a moving mouse carries it, and a
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
import { GESTURE_TIMING } from '../../../../../platform/input/gesture-timing';

const LIST_HOLD_MS = GESTURE_TIMING.pc.holdMs;
const TOUCH_HOLD_MS = GESTURE_TIMING.touch.holdMs;
const TOUCH_SLOP = GESTURE_TIMING.touch.dragThreshold;

const ITEM = 'tree-apple';

/** jsdom has no PointerEvent; a MouseEvent of the pointer type carries what the card reads. */
function pointer(el: Element, type: string, { pointerType = 'mouse', x = 0, y = 0, pointerId = 3 } = {}): void {
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y });
  Object.defineProperties(e, { pointerId: { value: pointerId }, pointerType: { value: pointerType } });
  act(() => { el.dispatchEvent(e); });
}

/** jsdom has no TouchEvent constructor; an event carrying the changed touches is what the card reads. */
function touch(el: Element, type: string, { x = 0, y = 0, id = 7 } = {}): Event {
  const e = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(e, 'changedTouches', { value: [{ identifier: id, clientX: x, clientY: y }] });
  act(() => { el.dispatchEvent(e); });
  return e;
}

/** jsdom has no pointer capture; this one remembers what the card took and gives it up on demand. */
function captureOn(): () => void {
  const held = new Set<number>();
  const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
  const before = ['setPointerCapture', 'hasPointerCapture', 'releasePointerCapture'].map((k) => [k, proto[k]] as const);
  proto.setPointerCapture = (id: number) => { held.add(id); };
  proto.hasPointerCapture = (id: number) => held.has(id);
  proto.releasePointerCapture = (id: number) => { held.delete(id); };
  return () => { for (const [k, v] of before) proto[k] = v; };
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
    act(() => { vi.advanceTimersByTime(TOUCH_HOLD_MS * 2); });
    expect(isCarried(3)).toBe(false);
    expect(armed()).toBeNull();
  });

  it('lifts under a held finger, and a cancel the card does not hold the pointer through puts it back', () => {
    pointer(card(), 'pointerdown', { pointerType: 'touch' });
    act(() => { vi.advanceTimersByTime(TOUCH_HOLD_MS); });
    expect(isCarried(3)).toBe(true);
    pointer(card(), 'pointercancel', { pointerType: 'touch' });
    expect(isCarried(3)).toBe(false);
    expect(armed()).toBeNull();
  });

  it('a pointercancel after the hold does not end the carry while the pointer is captured', () => {
    const restore = captureOn();
    try {
      pointer(card(), 'pointerdown', { pointerType: 'touch', x: 50, y: 50 });
      touch(card(), 'touchstart', { x: 50, y: 50 });
      act(() => { vi.advanceTimersByTime(TOUCH_HOLD_MS); });
      expect(isCarried(3)).toBe(true);
      // The browser takes the pointer stream for its own gesture; the finger's touches still reach the card.
      pointer(card(), 'pointercancel', { pointerType: 'touch' });
      card().releasePointerCapture(3);
      act(() => { card().dispatchEvent(new Event('lostpointercapture', { bubbles: true })); });
      expect(isCarried(3)).toBe(true);
      touch(card(), 'touchmove', { x: 50, y: 20 });
      expect(isCarried(3)).toBe(true);
      touch(card(), 'touchend', { x: 50, y: 20 });
      expect(isCarried(3)).toBe(false);
      // Let go without reaching a map, the held card is picked (EDIT-70).
      expect(armed()).toBe(ITEM);
    } finally {
      restore();
    }
  });

  it('a captured carry the system takes the touch from puts the item back', () => {
    const restore = captureOn();
    try {
      pointer(card(), 'pointerdown', { pointerType: 'touch' });
      touch(card(), 'touchstart');
      act(() => { vi.advanceTimersByTime(TOUCH_HOLD_MS); });
      pointer(card(), 'pointercancel', { pointerType: 'touch' });
      touch(card(), 'touchcancel');
      expect(isCarried(3)).toBe(false);
      expect(armed()).toBeNull();
    } finally {
      restore();
    }
  });

  it('refuses a lifted finger\'s moves, so the browser starts no pan of its own', () => {
    pointer(card(), 'pointerdown', { pointerType: 'touch', x: 50, y: 50 });
    touch(card(), 'touchstart', { x: 50, y: 50 });
    act(() => { vi.advanceTimersByTime(TOUCH_HOLD_MS); });
    expect(isCarried(3)).toBe(true);
    expect(touch(card(), 'touchmove', { x: 50, y: 50 - TOUCH_SLOP - 1 }).defaultPrevented).toBe(true);
  });

  it('leaves a finger\'s moves before the hold to the row, which may scroll', () => {
    pointer(card(), 'pointerdown', { pointerType: 'touch', x: 50, y: 50 });
    touch(card(), 'touchstart', { x: 50, y: 50 });
    expect(touch(card(), 'touchmove', { x: 50 - TOUCH_SLOP - 1, y: 50 }).defaultPrevented).toBe(false);
  });

  it('follows the finger that lifted the card when a second finger lands on it during the hold', () => {
    const restore = captureOn();
    try {
      pointer(card(), 'pointerdown', { pointerType: 'touch', x: 50, y: 50 });
      touch(card(), 'touchstart', { x: 50, y: 50 });
      pointer(card(), 'pointerdown', { pointerType: 'touch', x: 80, y: 50, pointerId: 9 });
      touch(card(), 'touchstart', { x: 80, y: 50, id: 8 });
      act(() => { vi.advanceTimersByTime(TOUCH_HOLD_MS); });
      expect(isCarried(3)).toBe(true);
      pointer(card(), 'pointercancel', { pointerType: 'touch' });
      touch(card(), 'touchend', { x: 80, y: 20, id: 8 });
      expect(isCarried(3), 'the second finger lifting ends nothing').toBe(true);
      touch(card(), 'touchend', { x: 50, y: 20 });
      expect(isCarried(3)).toBe(false);
    } finally {
      restore();
    }
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
