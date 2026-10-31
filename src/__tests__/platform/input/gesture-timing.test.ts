/**
 * The gesture timing table: one row of thresholds and windows per input mode, chosen by the
 * pointer that made the event.
 */
import { describe, it, expect } from 'vitest';
import { GESTURE_TIMING, modalityOf, pointerHovers, timingFor, travelledPast } from '../../../platform/input/gesture-timing';

describe('the gesture timing table', () => {
  it('keeps the mouse values the map has always used', () => {
    expect(GESTURE_TIMING.pc).toEqual({ dragThreshold: 3, holdMs: 400, doubleTapMs: 400, doubleTapSlop: 0, twoFingerTapMs: 0, twoFingerTapSlop: 0 });
  });

  it('gives a finger room to wander and a two-finger tap window', () => {
    expect(GESTURE_TIMING.touch).toEqual({ dragThreshold: 10, holdMs: 400, doubleTapMs: 300, doubleTapSlop: 24, twoFingerTapMs: 250, twoFingerTapSlop: 10 });
  });

  it('reads a finger and a pen as touch, a mouse and an unknown pointer as pc', () => {
    expect(modalityOf({ pointerType: 'touch' })).toBe('touch');
    expect(modalityOf({ pointerType: 'pen' })).toBe('touch');
    expect(modalityOf({ pointerType: 'mouse' })).toBe('pc');
    expect(modalityOf({ pointerType: '' })).toBe('pc');
    expect(timingFor({ pointerType: 'pen' })).toBe(GESTURE_TIMING.touch);
    expect(timingFor({ pointerType: 'mouse' })).toBe(GESTURE_TIMING.pc);
  });

  it('lets a touch press wander 6 px without travelling, where a mouse press has', () => {
    expect(travelledPast(6, 0, timingFor({ pointerType: 'touch' }).dragThreshold)).toBe(false);
    expect(travelledPast(6, 0, timingFor({ pointerType: 'mouse' }).dragThreshold)).toBe(true);
  });

  it('reads a mouse and a pen as hovering pointers, a finger as not', () => {
    expect(pointerHovers({ pointerType: 'mouse' })).toBe(true);
    expect(pointerHovers({ pointerType: 'pen' })).toBe(true);
    expect(pointerHovers({ pointerType: 'touch' })).toBe(false);
  });
});
