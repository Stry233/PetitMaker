/*
 * What a map press that waits before acting has become. In touch mode a press with nothing armed,
 * or with an item armed in the placer, does nothing on the way down: the finger may be about to
 * tap, drag, hold still or be joined by a second finger, and each means something different.
 *
 * Read on every move of the pressing pointer, when the hold timer runs out and on the release,
 * from the facts at that moment. The pointer machine owns the timer and runs the plan arm the
 * outcome names (`press-plan.ts:PressPlan`).
 */
import { travelledPast, type GestureTiming } from '../../../platform/input/gesture-timing';

export interface PendingFacts {
  /** Milliseconds the press has been down. */
  heldMs: number;
  /** Travel from where the press landed, in screen px. */
  dx: number;
  dy: number;
  /** Pointers down on the map, the waiting one included. */
  pointers: number;
  /** The waiting pointer has lifted. */
  released: boolean;
  /** The row of the pointer that pressed. */
  timing: GestureTiming;
}

/** `wait`: undecided, keep listening. `tap`, `drag` and `hold` name the plan arm to run;
 *  `navigate`: the camera takes the gesture and the press does nothing. */
export type PendingOutcome = 'wait' | 'tap' | 'drag' | 'hold' | 'navigate';

/** A second finger, then travel past the drag threshold, then a release, then the hold time. */
export function resolvePending(f: PendingFacts): PendingOutcome {
  if (f.pointers > 1) return 'navigate';
  if (travelledPast(f.dx, f.dy, f.timing.dragThreshold)) return 'drag';
  if (f.released) return 'tap';
  return f.heldMs >= f.timing.holdMs ? 'hold' : 'wait';
}
