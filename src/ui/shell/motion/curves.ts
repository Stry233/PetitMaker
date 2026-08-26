/*
 * curves.ts — the closed set of curves a shell motion may use.
 *
 * Every entry is one the interface already moves on, taken from `ui/design/styles.ts` rather than restated
 * here, so every surface accelerates the same way and a curve has one definition. Adding one is a
 * deliberate act with a reason, which is the point of the set being closed: the drift this system
 * exists to stop began as one call site choosing its own number.
 */
import { bezierOf, easing, springs } from '../../design/styles';

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
  /**
   * Leaves from rest and is still gaining speed when it goes. The shape of a DEPARTURE that has
   * nothing left to show: a card turning edge-on before its new face is even written accelerates
   * away rather than easing to a stop it never reaches. It is the only curve here that does not
   * settle, which is why nothing may name it for an arrival.
   */
  accel: { ease: bezierOf('accel') },
  /**
   * Comes to rest with no overshoot of its own, gently at both ends. For the LAST segment of a
   * motion whose overshoot is already in its keyframes: `punchy` would decelerate hard into the
   * mark and read as a second bounce on top of the one the keyframes describe, so the settle back
   * from past-flat runs on this instead.
   */
  settle: { ease: bezierOf('settle') },
  /** Slows into each extreme and out of it again. The shape of a thing that swings rather than one
   *  that arrives: a back-and-forth on any of the three above has a corner at the turn, which reads
   *  as a machine reversing. A TWEEN, and for a repeating motion its length is one whole cycle. */
  swing: { ease: 'easeInOut' },
  /**
   * No shape at all, and that is the reason it is here: it is the curve for a motion whose shape is
   * NOT the registry's to choose. Two kinds qualify, and nothing else does.
   *
   * A pattern that repeats SEAMLESSLY has to travel at a constant rate: any of the four above would
   * slow into the end of a cycle and leave again from the start of the next, so the loop would
   * visibly pulse at a seam the drawing itself does not have. A crawling stripe, a turning badge.
   *
   * And a SAMPLED track already carries its shape in its own frames — the character's leap plays
   * fifty keyframes off a damped-oscillator spring, so a second easing over the top of them would
   * be two curves multiplied together. `motion-registry.test.ts` holds the pair to those two cases.
   */
  linear: { ease: 'linear' },
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
  accel: easing.accel,
  settle: easing.settle,
  swing: 'ease-in-out',
  linear: 'linear',
} as const satisfies Record<CurveId, string>;
