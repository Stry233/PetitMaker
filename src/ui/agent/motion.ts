/*
 * Adapts registered motion entries to Framer transitions, CSS transition strings and WAAPI easing.
 * Tween entries receive their declared duration; spring entries retain their physics configuration.
 */
import type { Transition } from 'framer-motion';
import { CSS_CURVES, isTween } from '../shell/motion/curves';
import { CURVES, MOTIONS, type MotionId } from '../shell/motion/registry';

/** Declared duration in seconds, with a short fallback for spring entries used on timed paths. */
export function seconds(id: MotionId): number {
  const m = MOTIONS[id];
  return 'duration' in m && typeof m.duration === 'number' ? m.duration : 0.2;
}

/** Declared travel in the unit documented by the registry entry. */
export function amplitude(id: MotionId): number | undefined {
  const m = MOTIONS[id];
  return 'amplitude' in m ? m.amplitude : undefined;
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
  const curve = 'outCurve' in m && m.outCurve !== undefined ? CURVES[m.outCurve] : CURVES[m.curve];
  return { ...(curve as Transition), duration: outSeconds(id) };
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
export function framerMotion(id: MotionId): Transition {
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
export function cssMotion(id: MotionId, properties: readonly string[], reduced = false): string {
  if (reduced) return 'none';
  const curve = CSS_CURVES[MOTIONS[id].curve];
  return properties.map((p) => `${p} ${seconds(id)}s ${curve}`).join(', ');
}
