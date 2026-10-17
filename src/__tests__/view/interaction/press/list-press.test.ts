/**
 * What a held press on a carryable list entry means: still a possible tap, a carry, or the hand
 * scrolling the list.
 */
import { describe, it, expect } from 'vitest';
import { LIST_HOLD_MS, resolveListPress, type ListPressFacts } from '../../../../view/interaction/press/list-press';
import { DRAG_THRESHOLD, TOUCH_SLOP } from '../../../../view/interaction/press/travel';

const press = (over: Partial<ListPressFacts>): ListPressFacts => ({ pointerType: 'mouse', heldMs: 0, dx: 0, dy: 0, ...over });

describe('a mouse press on a list entry', () => {
  it('is undecided while it stays put and the hold has not run out, so a release is a tap', () => {
    expect(resolveListPress(press({ heldMs: LIST_HOLD_MS - 1 }))).toBe('wait');
    expect(resolveListPress(press({ dx: DRAG_THRESHOLD, dy: -DRAG_THRESHOLD }))).toBe('wait');
  });

  it('carries once it moves past the drag threshold, on either axis', () => {
    expect(resolveListPress(press({ dx: DRAG_THRESHOLD + 1 }))).toBe('carry');
    expect(resolveListPress(press({ dy: -(DRAG_THRESHOLD + 1) }))).toBe('carry');
  });

  it('carries once held, without moving', () => {
    expect(resolveListPress(press({ heldMs: LIST_HOLD_MS }))).toBe('carry');
  });

  it('never scrolls: a mouse drag is not how the list scrolls', () => {
    expect(resolveListPress(press({ dx: 200 }))).toBe('carry');
  });

  it('reads an unknown pointer type as a mouse', () => {
    expect(resolveListPress(press({ pointerType: '', dx: DRAG_THRESHOLD + 1 }))).toBe('carry');
  });
});

describe.each(['touch', 'pen'])('a %s press on a list entry', (pointerType) => {
  it('is undecided while it stays within the slop before the hold, so a lift is a tap', () => {
    expect(resolveListPress(press({ pointerType, heldMs: LIST_HOLD_MS - 1, dx: TOUCH_SLOP }))).toBe('wait');
  });

  it('scrolls when it moves before the hold, however far a mouse would have carried', () => {
    expect(resolveListPress(press({ pointerType, heldMs: 100, dx: TOUCH_SLOP + 1 }))).toBe('scroll');
    expect(resolveListPress(press({ pointerType, heldMs: 100, dy: TOUCH_SLOP + 1 }))).toBe('scroll');
  });

  it('carries when held in place', () => {
    expect(resolveListPress(press({ pointerType, heldMs: LIST_HOLD_MS, dx: 2, dy: -3 }))).toBe('carry');
  });

  it('scrolls rather than carries when the hold arrives after the press already slid away', () => {
    expect(resolveListPress(press({ pointerType, heldMs: LIST_HOLD_MS, dx: TOUCH_SLOP + 1 }))).toBe('scroll');
  });
});
