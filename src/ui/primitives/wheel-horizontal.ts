import { useLayoutEffect, useRef, type RefObject } from 'react';
import { useReducedMotionConfig } from 'framer-motion';
import { STOP_EPS } from './scroll-fade';
import { wheelGlider, wheelPush } from './scroll-input';

/** A non-passive listener consumes redirected input only while the row can travel in that direction. */
export function useWheelToHorizontal(ref: RefObject<HTMLElement | null>, { zoom, smooth = false }: { zoom: number; smooth?: boolean }): void {
  const reduced = useReducedMotionConfig();
  const options = useRef({ zoom, smooth, reduced });
  options.current = { zoom, smooth, reduced };
  const binding = useRef<{ element: HTMLElement; release(): void } | null>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (binding.current?.element === element) return;
    binding.current?.release();
    binding.current = null;
    if (!element) return;
    const glide = wheelGlider();
    const onWheel = (event: WheelEvent) => {
      const { zoom, smooth, reduced } = options.current;
      if (element.scrollHeight - element.clientHeight > 1) return;
      const room = element.scrollWidth - element.clientWidth;
      const push = wheelPush(event, element.clientWidth, zoom);
      if (!push || room <= 1 || (push.by < 0 ? element.scrollLeft <= 0 : element.scrollLeft >= room - STOP_EPS)) return;
      glide.wheel(element, push.by, !smooth || !!reduced);
      event.preventDefault();
      event.stopPropagation();
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    binding.current = { element, release: () => { element.removeEventListener('wheel', onWheel); glide.stop(); } };
  });
  useLayoutEffect(() => () => { binding.current?.release(); binding.current = null; }, []);
}
