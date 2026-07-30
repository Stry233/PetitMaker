/*
 * useSpringState.ts — spring a numeric target into React state (so layout can
 * read it each frame). Extracted verbatim from GeneratePanel so it can be shared;
 * logic and effect deps are unchanged.
 */
import { useState, useEffect } from 'react';
import { useSpring, useMotionValueEvent, type MotionValue } from 'framer-motion';

/** Spring a numeric target into React state (so layout can read it each frame),
 *  returning the mirrored state value AND the underlying MotionValue (for
 *  useTransform). A bare numeric useSpring source doesn't re-animate on its own,
 *  so the target change is pushed via .set(); under reduced motion it jumps
 *  straight to the target instead. Shared by the maze terrain-row collapse and
 *  the card-bottom spring so all height changes behave identically. */
export function useSpringState(
  target: number,
  spring: Parameters<typeof useSpring>[1],
  reduced?: boolean | null,
): [number, MotionValue<number>] {
  const mv = useSpring(target, spring);
  const [value, setValue] = useState(target);
  useEffect(() => {
    if (reduced) { mv.jump(target); setValue(target); }
    else mv.set(target);
  }, [target, reduced, mv]);
  useMotionValueEvent(mv, 'change', setValue);
  return [value, mv];
}
