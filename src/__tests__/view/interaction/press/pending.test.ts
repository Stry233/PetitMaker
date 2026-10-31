/**
 * What a touch press that is still waiting has become: a tap, a drag, a long press, navigation,
 * or nothing yet. A second finger outranks travel, travel outranks a release, and a release
 * outranks the hold time, so whichever the hand did first is never overruled by a clock.
 */
import { describe, it, expect } from 'vitest';
import { resolvePending, type PendingFacts } from '../../../../view/interaction/press/pending';
import { GESTURE_TIMING } from '../../../../platform/input/gesture-timing';

const TOUCH = GESTURE_TIMING.touch;
const SLOP = TOUCH.dragThreshold;
const HOLD = TOUCH.holdMs;

const facts = (over: Partial<PendingFacts> = {}): PendingFacts => ({
  heldMs: 0, dx: 0, dy: 0, pointers: 1, released: false, timing: TOUCH, ...over,
});

describe('resolvePending', () => {
  it.each<[string, Partial<PendingFacts>, ReturnType<typeof resolvePending>]>([
    ['a still finger before the hold time waits', { heldMs: HOLD - 1 }, 'wait'],
    ['a wander inside the slop waits', { dx: SLOP, dy: -SLOP }, 'wait'],
    ['travel past the slop on either axis is a drag', { dy: SLOP + 1 }, 'drag'],
    ['a release before the hold time is a tap', { released: true, heldMs: HOLD - 1 }, 'tap'],
    ['a still finger at the hold time is a hold', { heldMs: HOLD }, 'hold'],
    ['a second finger is navigation', { pointers: 2 }, 'navigate'],
    ['a second finger outranks travel and a release', { pointers: 2, dx: SLOP + 1, released: true }, 'navigate'],
    ['travel outranks a release', { dx: -(SLOP + 1), released: true }, 'drag'],
    ['travel outranks the hold time', { dx: SLOP + 1, heldMs: HOLD }, 'drag'],
    ['a release outranks the hold time', { released: true, heldMs: HOLD }, 'tap'],
  ])('%s', (_name, over, outcome) => {
    expect(resolvePending(facts(over))).toBe(outcome);
  });

  it('reads its thresholds from the timing row it is given', () => {
    const pc = GESTURE_TIMING.pc;
    expect(resolvePending(facts({ timing: pc, dx: pc.dragThreshold + 1 }))).toBe('drag');
    expect(resolvePending(facts({ timing: pc, heldMs: pc.holdMs }))).toBe('hold');
  });
});
