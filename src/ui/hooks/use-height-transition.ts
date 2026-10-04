import { useLayoutEffect, useRef, type RefObject } from 'react';
import { useReducedMotionConfig } from 'framer-motion';
import { easingCss, seconds } from '../design/motion';
import type { MotionId } from '../shell/motion/registry';

/** Animates committed height changes without transforming descendants or overriding the next layout's bounds. */
export function useHeightTransition(ref: RefObject<HTMLElement | null>, { motionId, resetKey, disabled = false }: {
  motionId: MotionId;
  resetKey: unknown;
  disabled?: boolean;
}): void {
  const reduced = useReducedMotionConfig() === true;
  const painted = useRef<number | null>(null);
  const target = useRef<number | null>(null);
  const running = useRef<Animation | null>(null);
  const room = useRef(resetKey);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const reset = room.current !== resetKey;
    room.current = resetKey;
    const live = running.current;
    const held = live?.playState === 'running';
    const time = live?.currentTime ?? null;
    const from = held ? el.offsetHeight : painted.current;
    // Cancelling exposes the new natural CSS height, including its current min/max constraints.
    live?.cancel();
    const to = el.offsetHeight;
    if (held && to === target.current && !disabled && !reduced && !reset) {
      live.play();
      live.currentTime = time;
      return;
    }
    running.current = null;
    target.current = to;
    painted.current = to;
    if (from === null || disabled || reduced || reset || Math.abs(to - from) < 1 || typeof el.animate !== 'function') return;
    const frame = (height: number) => ({ height: `${height}px`, minHeight: `${height}px`, maxHeight: `${height}px` });
    running.current = el.animate([frame(from), frame(to)], { duration: seconds(motionId) * 1000, easing: easingCss(motionId) });
  });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver !== 'function') return;
    // Nested disclosures own their frame-by-frame travel; the enclosing surface records its settled size.
    const observer = new ResizeObserver(() => {
      if (running.current?.playState !== 'running') painted.current = el.offsetHeight;
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  useLayoutEffect(() => () => { running.current?.cancel(); }, []);
}
