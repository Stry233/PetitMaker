/*
 * The closed duration scale. Every timed motion names one tier, and one job takes one tier wherever
 * it plays, so two surfaces doing the same thing finish together. A length off the scale is a loop's
 * cycle, a sampled track or a deliberately long wait, and its entry says why in `lengthFrom`.
 */

/** Tween lengths, in seconds. */
export const DURATIONS = {
  /** A tint, a colour or a hover reveal changing, and anything leaving: over before the eye follows it. */
  quick: 0.14,
  /** A change in place and a small arrival: a crossfade, a status line, a row rising, a mark landing. */
  short: 0.2,
  /** A piece travelling to a new place, a height unfolding, a card turning, a fill advancing. */
  base: 0.26,
  /** A whole surface moving or crossfading, a shake, a growth meant to be noticed. */
  long: 0.36,
  /** A pulse, a count and a first reveal: emphasis that is meant to be watched. */
  slow: 0.6,
} as const;

/** The time constant of every per-frame exponential follow, in seconds: a 60 Hz frame closes about a
 *  fifth of the gap, so a follow keeps up with a hand without stepping. */
export const FOLLOW_S = 0.07;

/** Delays between successive members of a group, in seconds. A loop's phase offsets belong to its
 *  cycle and are not staggers. */
export const STAGGERS = {
  /** Rows, cards or marks arriving in reading order. */
  row: 0.045,
  /** Graphemes of streamed text, at a reading pace. */
  glyph: 0.012,
} as const;
