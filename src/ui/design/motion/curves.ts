/*
 * The closed set of curves every motion uses, in both spellings: a Framer transition (`CURVES`) and a
 * CSS timing function (`CSS_CURVES`), each derived from the one definition below. Each curve has one
 * job, so two surfaces doing the same thing move the same way; adding one is a deliberate act with a
 * job no member already does.
 */

/** Every tween's control points, as CSS. Only this module spells a `cubic-bezier`. */
export const easing = {
  /** Decelerates into its mark and stops flat. */
  punchy: 'cubic-bezier(0.2, 0, 0, 1)',
  /** Still gaining speed when it goes. */
  accel: 'cubic-bezier(0.4, 0, 1, 1)',
  /** Comes to rest at both ends. */
  settle: 'cubic-bezier(0.3, 0, 0.55, 1)',
  /** Slows into each end and out of it. */
  swing: 'cubic-bezier(0.42, 0, 0.58, 1)',
  /** A body falling under gravity: leaves its height at rest and is fastest as it lands. */
  gravity: 'cubic-bezier(0.55, 0, 1, 0.45)',
  /** A body thrown upward: leaves fastest and comes to rest at the top of its arc. */
  toss: 'cubic-bezier(0, 0.55, 0.45, 1)',
  /** A light body falling against drag: gathers speed over its first tenth, then falls at a steady
   *  speed to the end (within 0.3% of an approach whose time constant is 8% of the fall). */
  drift: 'cubic-bezier(0.12, 0, 0.38, 0.34)',
  /** Lands past its mark by about 8% and settles back. */
  snap: 'cubic-bezier(0.2, 1.5, 0.4, 1)',
  /** `springs.stiff` over `DURATIONS.quick`, its 1% settle, within 1% of the spring. */
  springStiff: 'cubic-bezier(0.25, 0.1, 0.3, 0.96)',
  /** `springs.bouncy` over its 0.5 s settle as closely as one overshoot can follow a spring that rings
   *  (within 9%). */
  springBouncy: 'cubic-bezier(0.5, 2.2, 0, 0.8)',
} as const;

/** The same four control points as an `easing` entry, for a Framer `ease` array. */
export function bezierOf(id: keyof typeof easing): [number, number, number, number] {
  const parts = easing[id].slice('cubic-bezier('.length, -1).split(',').map((n) => Number(n));
  return [parts[0]!, parts[1]!, parts[2]!, parts[3]!];
}

/** Control points as a CSS timing function: a stretch of a member curve read over part of its way
 *  (`design/motion:fadeTimings`), which is that curve, not another. */
export function cssBezier([x1, y1, x2, y2]: readonly [number, number, number, number]): string {
  return `cubic-bezier(${x1}, ${y1}, ${x2}, ${y2})`;
}

/** The two springs, as Framer configurations. */
export const springs = {
  bouncy: { type: 'spring' as const, stiffness: 400, damping: 15, mass: 0.8 },
  stiff: { type: 'spring' as const, stiffness: 600, damping: 30, mass: 0.5 },
} as const;

/**
 * Rest thresholds for a spring driving `scale`, spread over the spring (`settleScale` in the registry).
 * The defaults suit pixels: within `restDelta` (0.01) of its target a spring is declared done and
 * Framer writes the target, which on a scale is a whole percent of the element, half a pixel on a
 * 300 px card appearing in one frame. These thresholds keep the last movement under a tenth of a pixel.
 */
export const scaleRest = { restDelta: 0.0002, restSpeed: 0.02 } as const;

export const CURVES = {
  /** Travel, arrivals, a change in place and a departure that stands alone: decelerates into its mark
   *  with no overshoot, so most of the change shows at once and the end is flat. The default tween. */
  punchy: { ease: bezierOf('punchy') },
  /** The departure half of a turn or a crossing (`outCurve` only): still gaining speed when the
   *  second half takes over, so the speed is greatest where the two meet. */
  accel: { ease: bezierOf('accel') },
  /** The landing segment after an overshoot keyframe (`landCurve` only): the overshoot is in the
   *  keyframes, and `punchy` there would read as a second bounce. */
  settle: { ease: bezierOf('settle') },
  /** A control's part and a surface that may be re-aimed mid-flight: a spring keeps its velocity
   *  through a retarget where a tween restarts, and this one stops without visible overshoot. */
  stiff: springs.stiff,
  /** Something deliberately landing (a card answering a press, a callout popping): a spring that
   *  overshoots and settles. Nothing that only travels takes it. */
  bouncy: springs.bouncy,
  /** A move from rest to rest that is not an arrival: a back-and-forth (a shake, a pulse, a breath, a
   *  marquee), a hand moving a pictured pointer or a pencil, the splash and the app sliding apart. For
   *  a repeating motion its length is one whole cycle. */
  swing: { ease: bezierOf('swing') },
  /** The two halves of a ballistic arc: `gravity` falls from rest and lands at full speed, `toss`
   *  leaves the ground at full speed and stops at the top. A bounce alternates them, so its speed is
   *  continuous at every turn and every landing. */
  gravity: { ease: bezierOf('gravity') },
  toss: { ease: bezierOf('toss') },
  /** Paper, petals, a leaf: a fall that drag holds to a steady speed, so what the body does on the way
   *  (a sway, a turn) keeps one rhythm, where `gravity` would make it hang and then rush. */
  drift: { ease: bezierOf('drift') },
  /** A deliberate landing played as Web Animations, where a spring cannot run: the character landing
   *  a pose, a pip or a glyph popping into her sketch. */
  snap: { ease: bezierOf('snap') },
  /**
   * No shape at all, for a motion whose shape is not the registry's to choose: a pattern that repeats
   * seamlessly (any other curve would pulse at the seam), and a sampled track whose frames already
   * carry its shape. `motion-registry.test.ts` holds it to those two cases.
   */
  linear: { ease: 'linear' },
} as const;

export type CurveId = keyof typeof CURVES;

/** Whether a curve needs a duration to be a complete answer. A spring carries its own timing in its
 *  physics; a bezier is a shape with no length until something gives it one. */
export function isTween(id: CurveId): boolean {
  return !('type' in CURVES[id]);
}

/** Every curve as a CSS timing function, for a motion driven by a transition or Web Animations rather
 *  than by Framer; a spring as its nearest bezier. */
export const CSS_CURVES = {
  punchy: easing.punchy,
  accel: easing.accel,
  settle: easing.settle,
  stiff: easing.springStiff,
  bouncy: easing.springBouncy,
  swing: easing.swing,
  gravity: easing.gravity,
  toss: easing.toss,
  drift: easing.drift,
  snap: easing.snap,
  linear: 'linear',
} as const satisfies Record<CurveId, string>;
