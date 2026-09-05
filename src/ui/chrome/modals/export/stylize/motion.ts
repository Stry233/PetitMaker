/*
 * motion.ts — this window's reader of the interface's motion table.
 *
 * A CALL SITE NAMES AN ID. `ui/shell/motion/registry.ts` holds what moves, how long, how far and on
 * which curve; nothing in this directory writes a duration, a bezier or a stagger where a thing
 * MOVES. The panel keeps its own reader for the shapes it needs (a flip's profile, a leave's own
 * curve); this window asks for the handful it needs rather than inheriting a surface's adapter.
 *
 * HOVER AND PRESS ARE NOT READ FROM HERE. They are the house's own shared affordances
 * (`design/styles.ts`'s `pressable` and `buttonMotion`), which carry their own spring, so a control
 * in this window answers the pointer exactly as its siblings elsewhere in the app do.
 *
 * The backdrop, the card and the entrance are `primitives/ModalShell`'s own, so nothing here
 * declares them.
 */
import type { Transition } from 'framer-motion';
import { CSS_CURVES, isTween, type CurveId } from '../../../../shell/motion/curves';
import { CURVES, MOTIONS, type MotionId } from '../../../../shell/motion/registry';

/** The declared length in seconds. A spring carries its timing in its physics and has none, so a
 *  caller asking for one gets the shortest perceptible beat rather than `NaN`. */
export function seconds(id: MotionId): number {
  const m = MOTIONS[id];
  return 'duration' in m && typeof m.duration === 'number' ? m.duration : 0.2;
}

/** The declared travel, in whatever unit the entry names. */
export function amplitude(id: MotionId): number {
  const m = MOTIONS[id];
  return 'amplitude' in m && typeof m.amplitude === 'number' ? m.amplitude : 0;
}

/** How long the `index`-th member of a group waits before it arrives. */
export function staggerDelay(id: MotionId, index: number): number {
  const m = MOTIONS[id];
  const step = 'stagger' in m && typeof m.stagger === 'number' ? m.stagger : 0;
  return step * index;
}

/** The declared motion as a Framer transition. */
export function framerMotion(id: MotionId): Transition {
  const m = MOTIONS[id];
  const curve = CURVES[m.curve];
  if (!isTween(m.curve)) return curve as Transition;
  return { ...(curve as Transition), duration: seconds(id) };
}

/** The LEAVE half of a declared motion, for an entry that names one: a shorter, accelerating share
 *  of the landing's length. An entry that declares neither leaves exactly as it arrives. */
export function leaveMotion(id: MotionId): Transition {
  const m = MOTIONS[id];
  const share = 'outShare' in m && typeof m.outShare === 'number' ? m.outShare : 1;
  const curveId: CurveId = 'outCurve' in m && m.outCurve !== undefined ? m.outCurve : m.curve;
  const curve = CURVES[curveId];
  if (!isTween(curveId)) return curve as Transition;
  return { ...(curve as Transition), duration: seconds(id) * share };
}

/** The declared motion as a CSS `transition` value over `properties`. `animations.css` collapses
 *  these under the reduced-motion attribute, which is the gate this shape rides. */
export function cssMotion(id: MotionId, properties: readonly string[]): string {
  const curve = CSS_CURVES[MOTIONS[id].curve];
  return properties.map((p) => `${p} ${seconds(id)}s ${curve}`).join(', ');
}
