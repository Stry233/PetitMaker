/*
 * Adapts registered motion entries to Framer transitions, CSS transition strings and WAAPI easing.
 * Tween entries receive their declared duration; spring entries retain their physics configuration.
 */
import type { MotionProps, TargetAndTransition, Transition } from 'framer-motion';
import { CSS_CURVES, cssBezier, isTween, scaleRest, type CurveId } from './curves';
import { CURVES, MOTIONS, type Motion, type MotionId } from './registry';

/** Every entry as the declared shape, which the `as const` table narrows past its optional fields. */
function motionOf(id: MotionId): Motion {
  return MOTIONS[id];
}

/** The entry's curve; a follow has none, as it closes on its target a frame at a time. */
function curveOf(id: MotionId): CurveId {
  const m = motionOf(id);
  if (m.curve === undefined) throw new Error(`${id} is a follow; step it with followToward`);
  return m.curve;
}

/** Timed paths require a tween entry; springs have no fixed duration. */
export function seconds(id: MotionId): number {
  const m = motionOf(id);
  if (typeof m.duration !== 'number') throw new Error(`${id} is a ${m.follow === undefined ? 'spring' : 'follow'}; select a timed motion`);
  return m.duration;
}

/** A first frame (no previous timestamp) counts as this many ms. */
const NOMINAL_FRAME_MS = 1000 / 60;
/** The longest frame a follow counts, in ms, so a stalled or background tab resumes with one bounded step. */
const MAX_FRAME_MS = 100;

/** The ms a per-frame follow advances between the frame timestamps `last` and `now`. Floored at 0: a
 *  frame's timestamp can precede the `performance.now()` its loop was armed with. */
export function frameDt(last: number | undefined, now: number): number {
  return last === undefined ? NOMINAL_FRAME_MS : Math.min(Math.max(now - last, 0), MAX_FRAME_MS);
}

/** One step of an exponential follow from `cur` toward `target` over `dtMs`, on `id`'s time constant,
 *  so it moves at one speed at any refresh rate. */
export function followToward(cur: number, target: number, dtMs: number, id: MotionId): number {
  const m = motionOf(id);
  if (m.follow === undefined) throw new Error(`${id} is not a follow`);
  return cur + (target - cur) * (1 - Math.exp(-dtMs / (m.follow * 1000)));
}

/** Declared travel in the unit documented by the registry entry. */
export function amplitude(id: MotionId): number {
  const m = MOTIONS[id];
  return 'amplitude' in m ? m.amplitude : 0;
}

/** How long the entry's transient state stands, in seconds; 0 when it declares no hold. */
export function holdSeconds(id: MotionId): number {
  const m = MOTIONS[id];
  return 'hold' in m && typeof m.hold === 'number' ? m.hold : 0;
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

/** A re-arrangement's fades as shares of its travel's progress: what only the old arrangement has is
 *  gone by `out`, and what only the new has starts in at `in` (`registry.ts:inAt`). */
export function fadeShares(id: MotionId): { out: number; in: number } {
  const m = MOTIONS[id];
  const out = 'outShare' in m && typeof m.outShare === 'number' ? m.outShare : 1;
  return { out, in: 'inAt' in m && typeof m.inAt === 'number' ? m.inAt : out };
}

/** Framer transition for the departure segment, including an optional departure curve. */
export function outMotion(id: MotionId): Transition {
  const m = motionOf(id);
  const idOfCurve = m.outCurve ?? curveOf(id);
  const curve = CURVES[idOfCurve];
  return isTween(idOfCurve) ? { ...(curve as Transition), duration: outSeconds(id) } : curve as Transition;
}

/** Framer keyframe timing for an arrival and optional overshoot settle. */
export function flipProfile(id: MotionId): Transition {
  const m = motionOf(id);
  const at = m.overshootAt;
  if (at === undefined) return framerMotion(id);
  const land = CURVES[m.landCurve ?? curveOf(id)];
  return {
    ...framerMotion(id),
    times: [0, at, 1],
    // Framer expects one easing per interval between keyframes.
    ease: [(CURVES[curveOf(id)] as { ease: unknown }).ease, (land as { ease: unknown }).ease],
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
  const m = motionOf(id);
  const curve = CURVES[curveOf(id)];
  if (!isTween(curveOf(id))) return m.settleScale ? { ...(curve as Transition), ...scaleRest } : curve as Transition;
  return { ...(curve as Transition), duration: seconds(id) };
}

/** The values a surface can arrive from and leave to; each rests at 1 (opacity, scale) or 0 (x, y). */
interface PresenceShape { opacity?: number; scale?: number; x?: number | string; y?: number | string }
const REST: Required<PresenceShape> = { opacity: 1, scale: 1, x: 0, y: 0 };

/**
 * Framer presence props for a surface that arrives from `from` on `arrive` and rests at its natural
 * state: `exit` is where it leaves to (`from` by default), on `leave` when given and on `arrive`
 * otherwise; `hold` is a value every state carries unchanged (a centring `x: '-50%'`). `reduced`
 * lands every state at once.
 */
export function presence(arrive: MotionId, from: PresenceShape, { exit = from, hold, leave, reduced = false }: {
  exit?: PresenceShape;
  hold?: PresenceShape;
  leave?: MotionId;
  reduced?: boolean | null;
} = {}): Required<Pick<MotionProps, 'initial' | 'animate' | 'exit' | 'transition'>> {
  const rest = Object.fromEntries(Object.keys(from).map((key) => [key, REST[key as keyof PresenceShape]])) as PresenceShape;
  return {
    initial: { ...from, ...hold } as TargetAndTransition,
    animate: { ...rest, ...hold } as TargetAndTransition,
    exit: { ...exit, ...hold, ...(leave ? { transition: framerMotion(leave, reduced) } : {}) } as TargetAndTransition,
    transition: framerMotion(arrive, reduced),
  };
}

/** Bare CSS easing for Web Animations keyframes. */
export function easingCss(id: MotionId): string {
  return CSS_CURVES[curveOf(id)];
}

/** Bare CSS easing for the departure segment. */
export function outEasingCss(id: MotionId): string {
  return CSS_CURVES[motionOf(id).outCurve ?? curveOf(id)];
}

/** Bare CSS easing for an overshoot settle, falling back to the entry curve. */
export function landEasingCss(id: MotionId): string {
  return CSS_CURVES[motionOf(id).landCurve ?? curveOf(id)];
}

/** CSS transition declaration for the supplied properties, or `none` under reduced motion. */
export function cssMotion(id: MotionId, properties: readonly string[], reduced: boolean | null = false): string {
  if (reduced) return 'none';
  const curve = CSS_CURVES[curveOf(id)];
  return properties.map((p) => `${p} ${seconds(id)}s ${curve}`).join(', ');
}

export function staggerDelay(id: MotionId, index: number): number {
  const motion = MOTIONS[id];
  return ('stagger' in motion ? motion.stagger : 0) * index;
}

/** A tween's control points, or null for a curve named by keyword (linear). */
function pointsOf(curve: CurveId): [number, number, number, number] | null {
  const m = /^cubic-bezier\(([^,]+),([^,]+),([^,]+),([^)]+)\)$/.exec(CSS_CURVES[curve].replace(/\s+/g, ''));
  return m ? m.slice(1).map(Number) as [number, number, number, number] : null;
}

/** One coordinate of a cubic bezier from 0 to 1 with inner control values `a` and `b`, at parameter `u`. */
const bezierAt = (a: number, b: number, u: number) => 3 * a * u * (1 - u) ** 2 + 3 * b * u * u * (1 - u) + u ** 3;

/** The parameter at which the coordinate with inner control values `a`, `b` reaches `v`, by bisection
 *  (each coordinate rises monotonically for the set's curves that do not overshoot). */
function solve(a: number, b: number, v: number): number {
  let lo = 0, hi = 1;
  for (let i = 0; i < 32; i++) { const mid = (lo + hi) / 2; if (bezierAt(a, b, mid) < v) lo = mid; else hi = mid; }
  return (lo + hi) / 2;
}

/** How far along its way a tween on `curve` stands at time share `t`, for a motion stepped by hand
 *  rather than by Framer or CSS. */
function curveProgress(curve: CurveId, t: number): number {
  const p = pointsOf(curve);
  if (!p) return t;
  return bezierAt(p[1], p[3], solve(p[0], p[2], t));
}

/** How far along its way a timed motion stands at time share `t`, on its own curve. */
export function progressAt(id: MotionId, t: number): number {
  return curveProgress(curveOf(id), t);
}

/** When a timed motion has travelled `share` of its way, in seconds: its curve read as a cubic bezier
 *  without overshoot, or as linear for a curve named by keyword. */
export function travelSeconds(id: MotionId, share: number): number {
  const d = seconds(id);
  const p = pointsOf(curveOf(id));
  if (!p) return d * share;
  return d * bezierAt(p[0], p[2], solve(p[1], p[3], share));
}

/** Web Animations timing for a timed motion: its length in ms and its CSS curve. */
export function waapiTiming(id: MotionId): { duration: number; easing: string } {
  return { duration: seconds(id) * 1000, easing: easingCss(id) };
}

/** The CSS `animation` shorthand playing `keyframes` on a timed motion; a loop repeats while it stands. */
export function cssAnimation(id: MotionId, keyframes: string): string {
  return `${keyframes} ${seconds(id)}s ${easingCss(id)}${motionOf(id).loop ? ' infinite' : ''}`;
}

/** One fade of a re-arrangement: when it starts and how long it runs, in seconds, and its curve as a
 *  Framer `ease` and as CSS. */
interface FadeTiming { delay: number; duration: number; ease: [number, number, number, number] | string; css: string }

/** The stretch of `curve` from parameter `u0` to `u1`, scaled to run 0 to 1 on both axes: its control
 *  points from the ends and their slopes, which a cubic's stretch keeps exactly. */
function stretch([x1, y1, x2, y2]: [number, number, number, number], u0: number, u1: number): [number, number, number, number] {
  const slope = (a: number, b: number, u: number) => 3 * (1 - u) ** 2 * a + 6 * (1 - u) * u * (b - a) + 3 * u * u * (1 - b);
  const k = (u1 - u0) / 3;
  const [ax, ay, bx, by] = [bezierAt(x1, x2, u0), bezierAt(y1, y2, u0), bezierAt(x1, x2, u1), bezierAt(y1, y2, u1)];
  const share = (v: number, from: number, to: number) => Math.min(1, Math.max(0, (v - from) / (to - from)));
  const round = (v: number) => Math.round(v * 1e4) / 1e4;
  return [
    round(share(ax + k * slope(x1, x2, u0), ax, bx)), round((ay + k * slope(y1, y2, u0) - ay) / (by - ay)),
    round(share(bx - k * slope(x1, x2, u1), ax, bx)), round((by - k * slope(y1, y2, u1) - ay) / (by - ay)),
  ];
}

/** A re-arrangement's fades of what only one arrangement shows (`fadeShares`), read off its travel's
 *  own progress: `out` runs from the start until the travel has gone its `outShare` and `in` from
 *  when it has gone its `inAt` to its end, each on the stretch of the travel's curve it spans, so a
 *  fade stands where the travel's progress puts it on every frame, as the morph's keyframed fades do
 *  (`primitives/morph.ts`), rather than taking the whole curve again inside its own span. */
export function fadeTimings(id: MotionId): { in: FadeTiming; out: FadeTiming } {
  const d = seconds(id), shares = fadeShares(id), wait = travelSeconds(id, shares.in), gone = travelSeconds(id, shares.out);
  const p = pointsOf(curveOf(id));
  const timing = (delay: number, duration: number, u0: number, u1: number): FadeTiming => {
    if (!p) return { delay, duration, ease: 'linear', css: 'linear' };
    const points = stretch(p, u0, u1);
    return { delay, duration, ease: points, css: cssBezier(points) };
  };
  return {
    in: timing(wait, d - wait, p ? solve(p[1], p[3], shares.in) : shares.in, 1),
    out: timing(0, gone, 0, p ? solve(p[1], p[3], shares.out) : shares.out),
  };
}

/** Framer transitions for what only one arrangement of a re-arrangement on `id` shows: `in` fades it
 *  in where it stands once `inAt` of the travel is done, `out` fades it out over the travel's first
 *  `outShare` (`fadeTimings`). */
export function arrangementFades(id: MotionId, reduced: boolean | null = false): { in: Transition; out: Transition } {
  if (reduced) return { in: NO_MOTION, out: NO_MOTION };
  const { in: arrive, out: leave } = fadeTimings(id);
  const fades = { in: { ease: arrive.ease, delay: arrive.delay, duration: arrive.duration }, out: { ease: leave.ease, duration: leave.duration } };
  return fades as { in: Transition; out: Transition };
}

/** `arrangementFades` as the CSS transition of `properties` toward a state `shown` or not. */
export function arrangementFadeCss(id: MotionId, shown: boolean, properties: readonly string[], reduced: boolean | null = false): string {
  if (reduced) return 'none';
  const { in: arrive, out: leave } = fadeTimings(id);
  return properties.map((p) => (shown ? `${p} ${arrive.duration}s ${arrive.css} ${arrive.delay}s` : `${p} ${leave.duration}s ${leave.css}`)).join(', ');
}

/** The CSS transition of a view that crossfades on `id`: opacity on the motion, and visibility
 *  flipping as a fade in starts and as a fade out ends, so a hidden view takes no pointer events. */
export function fadeVisibilityCss(id: MotionId, visible: boolean): string {
  return `${cssMotion(id, ['opacity'])}, visibility 0s linear ${visible ? 0 : seconds(id)}s`;
}
