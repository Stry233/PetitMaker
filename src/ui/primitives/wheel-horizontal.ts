/*
 * A mouse wheel on a row that only travels sideways: the vertical notches drive the horizontal
 * scroll, because on a mouse they are the only notches there are. The redirect yields wherever the
 * native gesture already has an answer — a trackpad's own sideways delta, a pinch (ctrlKey), an
 * element with vertical room of its own, or a row already at the stop the wheel is pushing toward,
 * where the event is left to bubble so an outer scroller can take it.
 *
 * The listener is registered by hand because `preventDefault` on a wheel needs `passive: false`,
 * which React's synthetic handler does not offer.
 */
import { useEffect, type RefObject } from 'react';

export function useWheelToHorizontal(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey) return;
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      if (el.scrollWidth - el.clientWidth <= 1) return;
      if (el.scrollHeight - el.clientHeight > 1) return;
      // One wheel line is treated as 16px; pixel-mode deltas pass through as they are.
      const step = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      const before = el.scrollLeft;
      el.scrollLeft = before + step;
      if (el.scrollLeft !== before) e.preventDefault();
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [ref]);
}
