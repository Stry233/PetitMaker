/*
 * Where a stepped slider's knob and fill stand: the value's share of the track, as a motion value that
 * glides there past React. A move the slider's own input makes (a press, a drag crossing a stop, a key
 * step) eases on `slider.glide`, a spring that keeps its speed when the next stop retargets it; a value
 * set from elsewhere eases on the caller's motion. Reduced motion places it at once, and at rest it holds
 * the share exactly.
 */
import { animate, useMotionValue, useReducedMotionConfig, useTransform, type MotionValue } from 'framer-motion';
import { useCallback, useLayoutEffect, useRef } from 'react';
import { framerMotion } from '../design/motion';
import type { MotionId } from '../design/motion/registry';

export interface SliderGlide {
  /** The drawn share of the track, 0 to 1. */
  share: MotionValue<number>;
  /** The same share as a CSS percentage, for a `left` or a `width`. */
  percent: MotionValue<string>;
  /** Called with the share the slider's own input is about to set, before it sets it. */
  own: (share: number) => void;
}

export function useSliderGlide(share: number, elsewhere: MotionId = 'slider.glide'): SliderGlide {
  const reduced = useReducedMotionConfig();
  const drawn = useMotionValue(share);
  const percent = useTransform(drawn, (s) => `${s * 100}%`);
  const owned = useRef<number | null>(null);
  const own = useCallback((next: number) => { owned.current = next; }, []);
  useLayoutEffect(() => {
    const id = owned.current === share ? 'slider.glide' : elsewhere;
    owned.current = null;
    if (drawn.get() === share) return;
    if (reduced) { drawn.jump(share); return; }
    // Started from the drawn place with its velocity, so a stop crossed mid-glide bends the path rather than restarting it.
    const run = animate(drawn, share, framerMotion(id));
    return () => run.stop();
  }, [share, elsewhere, reduced, drawn]);
  return { share: drawn, percent, own };
}
