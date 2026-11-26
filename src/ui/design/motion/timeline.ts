/*
 * A scripted timeline: beats timed against one another and played as one piece (a pose, an idle
 * dressing, a Help demo), so their lengths are the script's data rather than tiers of the duration
 * scale. Its curves still come from the set, and a beat that does a registry motion's job takes that
 * motion's timing through `beatFor`. `motion-registry.test.ts` reads a `timeline(...)` call as the
 * declaration that its contents are scripted.
 */
import { easingCss, seconds } from '.';
import type { MotionId } from './registry';

/** One Web Animations one-shot of a script: its length and start in ms, its CSS curve, and for a family
 *  of elements the delay added per member. */
export interface TimelineBeat {
  dur: number;
  easing: string;
  delay?: number;
  stagger?: number;
}

/** Marks `script` as a scripted timeline and returns it unchanged. */
export function timeline<T>(script: T): T {
  return script;
}

/** A registry motion's length and curve as a beat of a script. */
export function beatFor(id: MotionId): TimelineBeat {
  return { dur: seconds(id) * 1000, easing: easingCss(id) };
}

/** A beat as the CSS transition of `property`. */
export function beatCss(beat: TimelineBeat, property: string): string {
  return `${property} ${beat.dur}ms ${beat.easing}${beat.delay ? ` ${beat.delay}ms` : ''}`;
}
