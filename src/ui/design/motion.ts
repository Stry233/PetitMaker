/*
 * Adapts registered motion entries to Framer transitions, CSS transition strings and WAAPI easing.
 * Tween entries receive their declared duration; spring entries retain their physics configuration.
 */
import type { Transition } from 'framer-motion';
import { CSS_CURVES, isTween } from '../shell/motion/curves';
import { CURVES, MOTIONS, type MotionId } from '../shell/motion/registry';

/** Timed paths require a tween entry; springs have no fixed duration. */
export function seconds(id: MotionId): number {
  const m = MOTIONS[id];
  if (!('duration' in m) || typeof m.duration !== 'number') throw new Error(`${id} is a spring; select a timed motion`);
  return m.duration;
}

/** Declared travel in the unit documented by the registry entry. */
export function amplitude(id: MotionId): number {
  const m = MOTIONS[id];
  return 'amplitude' in m ? m.amplitude : 0;
}

/** Fractional position of an overshoot keyframe, or even spacing when none is declared. */
export function overshootAt(id: MotionId): number {
  const m = MOTIONS[id];
  return 'overshootAt' in m && typeof m.overshootAt === 'number' ? m.overshootAt : 0.5;
}

/** Departure duration after applying the entry's optional `outShare`. */
export function outSeconds(id: MotionId): number {
  const m = MOTIONS[id];
  const share = 'outShare' in m && typeof m.outShare === 'number' ? m.outShare : 1;
  return seconds(id) * share;
}

/** Framer transition for the departure segment, including an optional departure curve. */
export function outMotion(id: MotionId): Transition {
  const m = MOTIONS[id];
  const idOfCurve = 'outCurve' in m && m.outCurve !== undefined ? m.outCurve : m.curve;
  const curve = CURVES[idOfCurve];
  return isTween(idOfCurve) ? { ...(curve as Transition), duration: outSeconds(id) } : curve as Transition;
}

/** Framer keyframe timing for an arrival and optional overshoot settle. */
export function flipProfile(id: MotionId): Transition {
  const m = MOTIONS[id];
  const at = 'overshootAt' in m ? m.overshootAt : undefined;
  if (at === undefined) return framerMotion(id);
  const land = 'landCurve' in m && m.landCurve !== undefined ? CURVES[m.landCurve] : CURVES[m.curve];
  return {
    ...framerMotion(id),
    times: [0, at, 1],
    // Framer expects one easing per interval between keyframes.
    ease: [(CURVES[m.curve] as { ease: unknown }).ease, (land as { ease: unknown }).ease],
  } as Transition;
}

/** Total departure and arrival duration for a flip. */
export function turnSeconds(id: MotionId): number {
  return outSeconds(id) + seconds(id);
}

/** Zero-duration transition for value animations outside MotionConfig's reduced-motion coverage. */
export const NO_MOTION: Transition = { duration: 0 };

/** The declared motion as a Framer transition. */
export function framerMotion(id: MotionId, reduced: boolean | null = false): Transition {
  if (reduced) return NO_MOTION;
  const m = MOTIONS[id];
  const curve = CURVES[m.curve];
  if (!isTween(m.curve)) return curve as Transition;
  return { ...(curve as Transition), duration: seconds(id) };
}

/** Shared Framer and CSS forms of the inline-confirm arming motion. */
export const CONFIRM_ARM = {
  transition: framerMotion('panel.confirm.arm'),
  paint: cssMotion('panel.confirm.arm', ['background-color', 'color', 'border-color']),
} as const;

/** Bare CSS easing for Web Animations keyframes. */
export function easingCss(id: MotionId): string {
  return CSS_CURVES[MOTIONS[id].curve];
}

/** Bare CSS easing for the departure segment. */
export function outEasingCss(id: MotionId): string {
  const m = MOTIONS[id];
  return CSS_CURVES['outCurve' in m && m.outCurve !== undefined ? m.outCurve : m.curve];
}

/** Bare CSS easing for an overshoot settle, falling back to the entry curve. */
export function landEasingCss(id: MotionId): string {
  const m = MOTIONS[id];
  return CSS_CURVES['landCurve' in m && m.landCurve !== undefined ? m.landCurve : m.curve];
}

/** CSS transition declaration for the supplied properties, or `none` under reduced motion. */
export function cssMotion(id: MotionId, properties: readonly string[], reduced: boolean | null = false): string {
  if (reduced) return 'none';
  const curve = CSS_CURVES[MOTIONS[id].curve];
  return properties.map((p) => `${p} ${seconds(id)}s ${curve}`).join(', ');
}

export function staggerDelay(id: MotionId, index: number): number {
  const motion = MOTIONS[id];
  return ('stagger' in motion ? motion.stagger : 0) * index;
}

/** The CSS transition of a view that crossfades on `id`: opacity on the motion, and visibility
 *  flipping as a fade in starts and as a fade out ends, so a hidden view takes no pointer events. */
export function fadeVisibilityCss(id: MotionId, visible: boolean): string {
  return `${cssMotion(id, ['opacity'])}, visibility 0s linear ${visible ? 0 : seconds(id)}s`;
}
