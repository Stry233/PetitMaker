import { framerMotion, NO_MOTION } from '../../design/motion';
import { useReducedMotionConfig } from 'framer-motion';
import { beatOf, type BeatTarget, type ScoreId } from './choreography';
import { MOTIONS, type MotionId } from './registry';

/** Informing state remains available when decorative motion is disabled. */
export function useMotionAllowed(id: MotionId): boolean {
  const reduced = useReducedMotionConfig();
  return !reduced || MOTIONS[id].tier === 'inform';
}

/** Reduced motion drops travel and repeats; callers supply a settled target for loops. */
export function useMotion(id: MotionId): Record<string, unknown> {
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
  const transition = useMotion(beat.motion);
  return reduced || beat.at === 0 ? transition : { ...transition, delay: beat.at / 1000 };
}
