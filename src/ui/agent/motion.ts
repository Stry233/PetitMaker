/*
 * motion.ts — the panel's one adapter from a DECLARED motion to the two shapes a component can
 * actually use: a Framer transition object, and a CSS transition string.
 *
 * A CALL SITE NAMES AN ID. `ui/shell/motion/registry.ts` holds what moves, how long and on which
 * curve; nothing under `ui/agent/` writes a duration or a bezier at the place a thing MOVES, so the
 * answer to "what moves, how much, and why" stays in one file. `motion-registry.test.ts` scans this
 * directory for one and fails the build on it, exempting only this file and the character's own
 * choreography table (`character/poses.ts`), which are the two declarations.
 *
 * WHY BOTH SHAPES. Some of the panel's motion is Framer's (an element arriving, which needs
 * enter/exit state), and some is a plain CSS transition on a value that is already animating between
 * two renders (the dock's paper). The second kind is deliberately NOT converted to Framer: a
 * `background-color` transition is one declaration on the element that already exists, and
 * `animations.css` collapses every inline `transition:` under `[data-reduced-motion='1']`, so a
 * hand-written transition string is reduced-motion-gated for free where a hand-driven keyframe
 * animation would not be.
 *
 * A FLIP ASKS FOR THREE THINGS AND NAMES NO NUMBER FOR ANY OF THEM: how long the leave takes and on
 * which curve (`outMotion`), where its landing overshoot sits and how it settles back
 * (`flipProfile`), and how long the whole turn lasts (`turnSeconds`, which is what a guard over the
 * turning card is timed by). All three are derived from the entry, so a retune moves every half.
 *
 * A SPRING IS ALREADY A TRANSITION. `CURVES.stiff`/`bouncy`/`gentle` are the app's own Framer spring
 * configs, so `framerMotion` returns them unchanged; a tween carries no length of its own, so its
 * declared `duration` is attached. `cssMotion` needs a bezier either way, which is what
 * `CSS_CURVES` is for — the two spellings of one curve, kept beside each other so they cannot drift.
 */
import type { Transition } from 'framer-motion';
import { CSS_CURVES, isTween } from '../shell/motion/curves';
import { CURVES, MOTIONS, type MotionId } from '../shell/motion/registry';

/** The declared length in seconds. A spring has none — it carries its timing in its physics — and
 *  asking for one is a caller mistake the CSS path cannot express, so it falls back to the shortest
 *  perceptible beat rather than emitting `NaNs`. */
export function seconds(id: MotionId): number {
  const m = MOTIONS[id];
  return 'duration' in m && typeof m.duration === 'number' ? m.duration : 0.2;
}

/** The declared travel, in whatever unit the entry names. Undefined where the entry declares none
 *  (an inform motion is judged by what it says, and some of them travel a distance only measurable
 *  at run time). */
export function amplitude(id: MotionId): number | undefined {
  const m = MOTIONS[id];
  return 'amplitude' in m ? m.amplitude : undefined;
}

/** Where the entry's keyframe PAST the mark sits along the arrival, as a fraction. A landing whose
 *  overshoot is spaced evenly gives the settle as long as the whole approach and reads as a swing; this
 *  is the one reader for a track baked by hand, as `flipProfile` is for one Framer spaces. Halfway
 *  where the entry declares nothing, which IS even spacing for a three-point track. */
export function overshootAt(id: MotionId): number {
  const m = MOTIONS[id];
  return 'overshootAt' in m && typeof m.overshootAt === 'number' ? m.overshootAt : 0.5;
}

/** The declared LEAVE length: `seconds(id)` scaled by the entry's own `outShare`, or the same length
 *  where no split is declared (a flip whose leave and landing share one duration). The one reader of
 *  `outShare`, so a call site asks for the leave's length by name rather than doing the arithmetic
 *  itself. */
export function outSeconds(id: MotionId): number {
  const m = MOTIONS[id];
  const share = 'outShare' in m && typeof m.outShare === 'number' ? m.outShare : 1;
  return seconds(id) * share;
}

/**
 * The declared LEAVE as a Framer transition: its own length, and its own curve where the entry
 * names one. A departure and an arrival are not one motion reversed — see the `outCurve` note in
 * the registry — so a flip whose leave declares no curve of its own falls back to the entry's.
 */
export function outMotion(id: MotionId): Transition {
  const m = MOTIONS[id];
  const curve = 'outCurve' in m && m.outCurve !== undefined ? CURVES[m.outCurve] : CURVES[m.curve];
  return { ...(curve as Transition), duration: outSeconds(id) };
}

/**
 * A FLIP'S LANDING PROFILE: where its overshoot keyframe sits along the entry, and the curve each
 * segment runs on. Spread over the transition of a three-keyframe rotation.
 *
 * Framer spaces keyframes evenly unless told otherwise, which is the difference between a landing
 * with weight and a swing (registry `overshootAt`). An entry that declares no overshoot gets the
 * default spacing and its one curve, which is what every other keyframe motion here wants.
 */
export function flipProfile(id: MotionId): Transition {
  const m = MOTIONS[id];
  const at = 'overshootAt' in m ? m.overshootAt : undefined;
  if (at === undefined) return framerMotion(id);
  const land = 'landCurve' in m && m.landCurve !== undefined ? CURVES[m.landCurve] : CURVES[m.curve];
  return {
    ...framerMotion(id),
    times: [0, at, 1],
    // One easing per SEGMENT, so the array is one shorter than the keyframe list.
    ease: [(CURVES[m.curve] as { ease: unknown }).ease, (land as { ease: unknown }).ease],
  } as Transition;
}

/** The whole turn's length in seconds, leave plus landing: how long a flipping card is neither the
 *  face that left nor the face that arrived. */
export function turnSeconds(id: MotionId): number {
  return outSeconds(id) + seconds(id);
}

/**
 * NO MOTION AT ALL: the reduced-motion answer for a Framer animation the app's own `<MotionConfig>`
 * does not reach.
 *
 * That gate stands down transforms and layout animations. A morph whose values are a corner, a box
 * and a radius is none of those — they are ordinary animatable values — so a caller animating them
 * hands this in where it already knows the reader has asked for stillness, and the tween cuts to its
 * landing frame. Declared here for the same reason every other number is: so a call site names a
 * decision rather than writing one.
 */
export const NO_MOTION: Transition = { duration: 0 };

/** The declared motion as a Framer transition. */
export function framerMotion(id: MotionId): Transition {
  const m = MOTIONS[id];
  const curve = CURVES[m.curve];
  if (!isTween(m.curve)) return curve as Transition;
  return { ...(curve as Transition), duration: seconds(id) };
}

/**
 * THE BEAT A VERB GROWS INTO ITS OWN QUESTION ON (`primitives/InlineConfirm`).
 *
 * Handed to the primitive as a bundle rather than named there: a part is not allowed to read the
 * interface's motion table, so the surface that has a declaration passes the declaration. Built once
 * at module scope, since the registry is static.
 *
 * ONE DECLARATION, TWO SPELLINGS OF IT: the width is Framer's (a length tweened between two measured
 * numbers) and the colours are a plain css transition on the trigger the caller drew, so the growth
 * and the crossing to danger are the same length on the same curve and read as one move.
 */
export const CONFIRM_ARM = {
  transition: framerMotion('panel.confirm.arm'),
  paint: cssMotion('panel.confirm.arm', ['background-color', 'color', 'border-color']),
} as const;

/**
 * The declared curve as a bare CSS easing function, for the one shape neither of the others fits: a
 * Web Animations keyframe pair, which takes its length and its easing as separate options.
 *
 * `cssMotion` cannot serve there (it writes a whole `transition` declaration, which needs a property
 * that is animating between two RENDERS), and a spring has no bezier at all — a caller asking for
 * one is on the CSS path, where the tween curves are the only ones expressible.
 */
export function easingCss(id: MotionId): string {
  return CSS_CURVES[MOTIONS[id].curve];
}

/** The LEAVE's own curve as css, for a motion whose departure is not the shape of its arrival —
 *  `outMotion`'s twin for the engines that take a string (a WAAPI keyframe, a css transition). */
export function outEasingCss(id: MotionId): string {
  const m = MOTIONS[id];
  return CSS_CURVES['outCurve' in m && m.outCurve !== undefined ? m.outCurve : m.curve];
}

/** The SETTLE BACK from a landing overshoot, as css: `flipProfile`'s `landCurve` for the engines that
 *  take a string per keyframe. Falls back to the entry's own curve, which is one shape over both
 *  segments — right for a landing with no overshoot to come back from. */
export function landEasingCss(id: MotionId): string {
  const m = MOTIONS[id];
  return CSS_CURVES['landCurve' in m && m.landCurve !== undefined ? m.landCurve : m.curve];
}

/**
 * The declared motion as a CSS `transition` value over `properties`.
 *
 * `reduced` is passed IN rather than read here, so a component that already holds the answer (every
 * one of them does — it needs it for its Framer pieces too) makes one decision instead of two that
 * can disagree. `animations.css` also collapses these under the reduced-motion attribute; this is
 * the JS half of the same double gate the rest of the panel wears.
 */
export function cssMotion(id: MotionId, properties: readonly string[], reduced = false): string {
  if (reduced) return 'none';
  const curve = CSS_CURVES[MOTIONS[id].curve];
  return properties.map((p) => `${p} ${seconds(id)}s ${curve}`).join(', ');
}
