import type { ReactNode } from 'react';
import { MotionConfig, motion } from 'framer-motion';
import { framerMotion, NO_MOTION } from '.';
import { MOTIONS, type SampleMotionId } from './registry';

/**
 * Plays a registered sample motion under every reduced-motion preference. The nested
 * `MotionConfig` covers only this element, so surrounding feedback still obeys the app's gate.
 */
export function MotionSample({ id, playing, children }: { id: SampleMotionId; playing: boolean; children: ReactNode }) {
  const m = MOTIONS[id];
  return (
    <MotionConfig reducedMotion="never">
      <motion.span
        style={{ display: 'block' }}
        data-motion-sample={id}
        animate={{ [m.property]: playing ? m.amplitude : 0 }}
        transition={playing ? { ...framerMotion(id), ...(m.loop ? { repeat: Infinity } : {}) } : NO_MOTION}
      >
        {children}
      </motion.span>
    </MotionConfig>
  );
}
