import { framerMotion, NO_MOTION } from '.';
import { useReducedMotionConfig } from 'framer-motion';
import { beatOf, type BeatTarget, type ScoreId } from './choreography';
import { MOTIONS, type MotionId } from './registry';

/** Informing state remains available when decorative motion is disabled. */
export function useMotionAllowed(id: MotionId): boolean {
  const reduced = useReducedMotionConfig();
  return !reduced || MOTIONS[id].tier === 'inform';
}

/** The one Framer adapter for a registry motion: reduced motion drops travel and repeats (callers
 *  supply a settled target for loops), and a loop entry repeats for as long as it stands. */
export function useTransition(id: MotionId): Record<string, unknown> {
  const reduced = useReducedMotionConfig();
  if (reduced) return { ...NO_MOTION };
  const motion = MOTIONS[id];
  return {
    ...framerMotion(id),
    ...('loop' in motion && motion.loop ? { repeat: Infinity } : {}),
  };
}

/** Reduced motion drops stagger delays together with travel. */
export function useBeat<S extends ScoreId>(score: S, target: BeatTarget<S>): Record<string, unknown> {
  const reduced = useReducedMotionConfig();
  const beat = beatOf(score, target);
  const transition = useTransition(beat.motion);
  return reduced || beat.at === 0 ? transition : { ...transition, delay: beat.at / 1000 };
}
