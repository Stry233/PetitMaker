import { useEffect, useLayoutEffect, useRef } from 'react';
import { animate, useMotionValue, useReducedMotionConfig, type AnimationPlaybackControls, type MotionValue } from 'framer-motion';
import type { MotionId } from '../../design/motion/registry';
import { useTransition } from '../../design/motion/use-motion';
import { glideRemainingNow, onLiveScale } from '../../design/scale';
import { pageMorphing } from '../../primitives/morph';

/**
 * Offsets that glide an element from where it stood to where a discrete reflow put it, in its own
 * unzoomed px, while a continuous CSS zoom around it follows the frame directly. Spread `x`/`y` onto
 * a motion element positioned at its new place. A glide starts only when `place` (what the layout
 * decided) changes while `enabled`; the offset is rebased with `jump`, so the coordinate change
 * never becomes spring velocity. Reduced motion lands at once. `drawnY`, where given, says where the
 * element is drawn when something past React (a per-frame writer) has moved it since the last render,
 * so the glide starts there rather than at the last rendered place. A reflow that starts during a
 * UI-zoom glide rides it instead of its own motion, closing with what is left of the glide so it lands
 * on the glide's last frame and nothing moves after the glide ends. A reflow committed while the page's
 * morph measures (an input-mode switch, a shape flip) lands at once: the morph carries it.
 */
export function useLocalReflow(x: number, y: number, place: string, { motionId, enabled = true, drawnY }: {
  motionId: MotionId;
  enabled?: boolean;
  drawnY?: () => number | null;
}): { x: MotionValue<number>; y: MotionValue<number> } {
  const dx = useMotionValue(0), dy = useMotionValue(0);
  const previous = useRef<{ x: number; y: number; place: string }>();
  const running = useRef<AnimationPlaybackControls[]>([]);
  const riding = useRef<(() => void) | null>(null);
  const stop = () => {
    running.current.forEach(animation => animation.stop());
    running.current = [];
    riding.current?.();
    riding.current = null;
  };
  const reduced = useReducedMotionConfig();
  const transition = useTransition(motionId);
  useLayoutEffect(() => {
    const before = previous.current;
    if (reduced || pageMorphing()) {
      stop();
      dx.set(0);
      dy.set(0);
    } else if (enabled && before && before.place !== place) {
      stop();
      dx.jump(dx.get() + before.x - x);
      dy.jump(dy.get() + (drawnY?.() ?? before.y) - y);
      running.current = [animate(dx, 0, transition), animate(dy, 0, transition)];
      // A UI-zoom glide running now takes the offset over from the reflow's own motion.
      let base: { left: number; x: number; y: number } | null = null;
      const ride = () => {
        const now = glideRemainingNow();
        if (!base) {
          if (now === null || now <= 0) return;
          running.current.forEach(animation => animation.stop());
          running.current = [];
          base = { left: now, x: dx.get(), y: dy.get() };
        }
        const share = Math.min(1, (now ?? 0) / base.left);
        dx.set(base.x * share);
        dy.set(base.y * share);
        if (!now) stopRiding();
      };
      const off = onLiveScale(ride);
      const stopRiding = () => { off(); if (riding.current === stopRiding) riding.current = null; };
      riding.current = stopRiding;
      ride();
      void Promise.all(running.current).then(() => { if (!base) stopRiding(); });
    }
    previous.current = { x, y, place };
  });
  useEffect(() => stop, []);
  return { x: dx, y: dy };
}
