/*
 * use-motion.ts — the one way a component reaches the registry.
 *
 * `useMotionAllowed` is where the two tiers differ at runtime: an informing motion survives reduced
 * motion because it is feedback, and a decorative one does not because it is decoration. Both ride
 * the existing `motionPref`, so Reduced gains the clearer meaning of "keep what tells me things,
 * drop what is only pleasant" and no second setting is introduced.
 */
import { useReducedMotionConfig } from 'framer-motion';
import { beatOf, type BeatTarget, type ScoreId } from './choreography';
import { CSS_CURVES } from './curves';
import { CURVES, MOTIONS, type Motion, type MotionId } from './registry';

/**
 * The same motion as a CSS transition, for a property a stylesheet drives rather than Framer.
 *
 * Not a hook and not reduced-motion-aware, because it does not have to be: `animations.css`
 * collapses every CSS transition under the reduced-motion attribute, which is the third of the
 * three gates. A tween only — a bezier has a length and a spring does not, and CSS has no springs.
 */
export function cssMotion(id: MotionId, ...properties: string[]): string {
  const motion: Motion = MOTIONS[id];
  if (motion.duration === undefined) throw new Error(`${id} is a spring; CSS has none`);
  const shape = `${motion.duration}s ${CSS_CURVES[motion.curve]}`;
  return properties.map((property) => `${property} ${shape}`).join(', ');
}

/**
 * Whether this motion HAPPENS at all.
 *
 * The tiers differ here and only here. An informing motion still happens under reduced motion,
 * because the fact it carries is one the person needs: the plate still reaches the block they
 * chose. A decorative one does not happen, because there is no fact under it — an idle sway is
 * simply not run.
 *
 * This is the question a component asks before rendering an ambient behaviour at all. It is NOT the
 * question of whether that motion travels; see below.
 */
export function useMotionAllowed(id: MotionId): boolean {
  const reduced = useReducedMotionConfig();
  return !reduced || MOTIONS[id].tier === 'inform';
}

/**
 * The Framer transition for a motion, or an instant one under reduced motion.
 *
 * INSTANT FOR BOTH TIERS, which is the distinction `useMotionAllowed` does not make. Reduced motion
 * is a request about TRAVEL, not about outcomes: an informing motion must still arrive, so its
 * property still changes, but it crosses no distance getting there. Returning a transition rather
 * than nothing is what keeps a component from branching, which would put the rule in two places.
 *
 * A tween's declared length rides along with its curve, since a bezier without one has no length.
 *
 * A LOOP UNDER REDUCED MOTION IS NOT A FAST LOOP. `{ duration: 0 }` on a repeating keyframe run is a
 * strobe, which is the opposite of what was asked for, so the repeat is dropped with the travel: the
 * caller animates to the state's settled value instead and the motion arrives there at once.
 */
export function useMotion(id: MotionId): Record<string, unknown> {
  const reduced = useReducedMotionConfig();
  if (reduced) return { duration: 0 };
  const motion = MOTIONS[id];
  const curve = CURVES[motion.curve] as Record<string, unknown>;
  return {
    ...curve,
    ...('duration' in motion && motion.duration !== undefined ? { duration: motion.duration } : {}),
    ...('loop' in motion && motion.loop ? { repeat: Infinity } : {}),
  };
}

/**
 * NO TRAVEL: a value that must arrive at once.
 *
 * It lives here because "how long" is this directory's question even when the answer is "not at
 * all". A property that FOLLOWS something already animated takes this — a second spring chasing the
 * first's output trails it by its own response time, which is the pill lagging behind the control
 * folding inside it rather than two things moving as one.
 */
export const STILL = { duration: 0 } as const;

/**
 * The same transition, for a target where only SOME of the values loop.
 *
 * Framer applies one transition to every value in a target, so a value that is merely arriving at a
 * number replays its arrival for ever under a repeating one. Measured in the browser: entering the
 * character's working pump from its resting sway left the rotation it was settling out of sawtoothing
 * by a pixel and a half, at the pump's period, permanently — which is the sub-pixel judder the
 * amplitude floor exists to keep off the screen, arriving by the back door.
 *
 * A value written as KEYFRAMES is the loop. A value written as a number is arriving, and arrives once.
 */
export function loopedOverTarget(
  transition: Record<string, unknown>,
  target: object,
): Record<string, unknown> {
  if (transition.repeat === undefined) return transition;
  const once = { ...transition, repeat: 0 };
  const out = { ...transition };
  for (const [value, keyframes] of Object.entries(target)) {
    if (!Array.isArray(keyframes)) out[value] = once;
  }
  return out;
}

/**
 * The transition for one BEAT of a score: its motion, waiting its turn.
 *
 * Where a beat sits is the only thing this adds, and it is the only place a delay is written: a
 * number typed at the element would put the order of a four-element move in four files.
 *
 * The wait goes under reduced motion along with the travel. An element that still waited its turn
 * before arriving instantly would leave a hole where it is simply missing, which is worse than the
 * motion it was asked to drop.
 */
export function useBeat<S extends ScoreId>(score: S, target: BeatTarget<S>): Record<string, unknown> {
  const reduced = useReducedMotionConfig();
  const beat = beatOf(score, target);
  const transition = useMotion(beat.motion);
  return reduced || beat.at === 0 ? transition : { ...transition, delay: beat.at / 1000 };
}
