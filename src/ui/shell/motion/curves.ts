/*
 * curves.ts — the closed set of curves a shell motion may use.
 *
 * Every entry is one the interface already moves on, taken from `ui/design/styles.ts` rather than restated
 * here, so every surface accelerates the same way and a curve has one definition. Adding one is a
 * deliberate act with a reason, which is the point of the set being closed: the drift this system
 * exists to stop began as one call site choosing its own number.
 */
import { easing, springs } from '../../design/styles';

export const CURVES = {
  /** Arrives with a small overshoot. A thing appearing, where the overshoot reads as it landing. */
  bouncy: springs.bouncy,
  /** Arrives fast and stops. The default for anything the user is waiting on. */
  stiff: springs.stiff,
  /** Arrives slowly and evenly. Ambient motion, and anything that must not draw the eye. */
  gentle: springs.gentle,
  /** Leaves at once and settles flat. The shelves already arrive on this bezier; it is `easing
   *  .punchy`'s own control points, so the two spellings are one curve. A TWEEN rather than a
   *  spring, so a motion naming it also gives a duration and one naming any other must not. */
  punchy: { ease: [0.2, 0, 0, 1] },
  /** Slows into each extreme and out of it again. The shape of a thing that swings rather than one
   *  that arrives: a back-and-forth on any of the three above has a corner at the turn, which reads
   *  as a machine reversing. A TWEEN, and for a repeating motion its length is one whole cycle. */
  swing: { ease: 'easeInOut' },
} as const;

export type CurveId = keyof typeof CURVES;

/** Whether a curve needs a duration to be a complete answer. A spring carries its own timing in its
 *  physics; a bezier is a shape with no length until something gives it one. */
export function isTween(id: CurveId): boolean {
  return !('type' in CURVES[id]);
}

/** The same three as CSS timing functions, for a motion driven by a transition rather than by
 *  Framer. Kept beside their spring twins so a curve's two spellings cannot drift apart. */
export const CSS_CURVES = {
  bouncy: easing.springBouncy,
  stiff: easing.springStiff,
  gentle: easing.punchy,
  punchy: easing.punchy,
  swing: 'ease-in-out',
} as const satisfies Record<CurveId, string>;
