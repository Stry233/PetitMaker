/*
 * use-in-view.ts — when a figure should start its EXPENSIVE work.
 *
 * A help page mounts every section's figure at once, but a reader arrives at the top: a demo's
 * Pixi renderer, a generate figure's candidate batch, the camera film's 3D captures all standing
 * up together is what made the window slow to open. Each figure holds a fixed box whether or not
 * its content has started, so deferring the work until the box nears the viewport changes nothing
 * the reader can see — the figure below the fold begins as they approach it.
 *
 * The result stays latched after the figure enters view. Environments without IntersectionObserver,
 * including the test DOM, start immediately.
 */
import { useEffect, useState, type RefObject } from 'react';

/** How far below the fold a figure starts working: early enough that a steady scroll never meets
 *  an empty box. The playback pause in `HelpDemo` reads the same margin, so where a demo may start
 *  and where it keeps playing are one boundary. */
export const NEAR = '320px';

export function useInView(ref: RefObject<HTMLElement | null>): boolean {
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    if (seen) return undefined;
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') { setSeen(true); return undefined; }
    const io = new IntersectionObserver(
      (entries) => { if (entries.some((e) => e.isIntersecting)) setSeen(true); },
      { rootMargin: NEAR },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [seen, ref]);
  return seen;
}
