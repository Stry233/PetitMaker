/** Readiness stays latched so a figure keeps its layout and state through scrolling and exit. */
import { useEffect, useState, type RefObject } from 'react';
import { useFigureReady } from './figure-ready';

/** Shared admission and demo-playback margin around the viewport. */
export const NEAR = '320px';

export function useInView(ref: RefObject<HTMLElement | null>): boolean {
  const allowed = useFigureReady();
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    if (seen || !allowed) return undefined;
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') { setSeen(true); return undefined; }
    const io = new IntersectionObserver(
      (entries) => { if (entries.some((e) => e.isIntersecting)) setSeen(true); },
      { rootMargin: NEAR },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [seen, ref, allowed]);
  return seen;
}
