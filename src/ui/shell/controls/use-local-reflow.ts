import { useEffect, useLayoutEffect, useRef } from 'react';
import { animate, useMotionValue, useReducedMotionConfig, type AnimationPlaybackControls, type MotionValue } from 'framer-motion';
import type { MotionId } from '../../design/motion/registry';
import { useTransition } from '../../design/motion/use-motion';

/**
 * Offsets that glide an element from where it stood to where a discrete reflow put it, in its own
 * unzoomed px, while a continuous CSS zoom around it follows the frame directly. Spread `x`/`y` onto
 * a motion element positioned at its new place. A glide starts only when `place` (what the layout
 * decided) changes while `enabled`; the offset is rebased with `jump`, so the coordinate change
 * never becomes spring velocity. Reduced motion lands at once.
 */
export function useLocalReflow(x: number, y: number, place: string, { motionId, enabled = true }: {
  motionId: MotionId;
  enabled?: boolean;
}): { x: MotionValue<number>; y: MotionValue<number> } {
  const dx = useMotionValue(0), dy = useMotionValue(0);
  const previous = useRef<{ x: number; y: number; place: string }>();
  const running = useRef<AnimationPlaybackControls[]>([]);
  const reduced = useReducedMotionConfig();
  const transition = useTransition(motionId);
  useLayoutEffect(() => {
    const before = previous.current;
    if (reduced) {
      running.current.forEach(animation => animation.stop());
      running.current = [];
      dx.set(0);
      dy.set(0);
    } else if (enabled && before && before.place !== place) {
      running.current.forEach(animation => animation.stop());
      dx.jump(dx.get() + before.x - x);
      dy.jump(dy.get() + before.y - y);
      running.current = [animate(dx, 0, transition), animate(dy, 0, transition)];
    }
    previous.current = { x, y, place };
  });
  useEffect(() => () => running.current.forEach(animation => animation.stop()), []);
  return { x: dx, y: dy };
}
