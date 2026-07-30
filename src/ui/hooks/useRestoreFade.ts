/**
 * The resume-from-last fade.
 *
 * A restore swaps the map AND both cameras, so the view arrives somewhere else with no travel: an
 * instant jump. This covers that with a short fade of the VIEW rather than a flight of the camera —
 * a camera easing from the default framing to the restored one takes time proportional to the
 * distance and sweeps across the whole map on the way, while a fade hides the change entirely and
 * reads as arriving. Same 0.35s vocabulary as the 2D↔3D crossfade.
 *
 * WHAT THE FADE MUST COVER is the whole restore, and a restore is not one commit. `begin()` hides
 * the view in the same commit that applies the map; the camera lands in a LATER effect (App's, so
 * the 2D fitToMap cannot clobber it); the renderer draws later still, and in 3D only after an async
 * scene rebuild. Releasing on a frame count therefore lands mid-sequence — it showed the EMPTY map
 * fading in and left the camera to snap into place afterwards, exactly the discontinuity the fade
 * exists to hide. So the release is GATED on the restored map being painted: `settle()` hands the
 * new state to `whenActiveViewPainted` (see canvas/view-settled for the full event order), and only
 * the ACTIVE view has to be right — a saved 3D camera with no 3D scene mounted is deferred by
 * design and must not hold the fade open.
 *
 * Two safety nets, neither of them the mechanism:
 *  - `begin()` with no `settle()` in the same flush means the restore threw before the map changed;
 *    there is nothing to wait for, so the effect releases on the next frame.
 *  - a view that never reports a paint (a torn-down renderer, a headless test) releases after
 *    RELEASE_SAFETY_MS. Both renderers flush their waiters on teardown, so this is a last resort.
 *
 * Reduced motion skips the hide altogether: `hidden` never goes true, so the restore simply arrives.
 * (Collapsing the transition instead would still flash one transparent frame.)
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { isMotionReduced } from '../../canvas/map2d/motion-state';
import { whenActiveViewPainted } from '../../canvas/view-settled';
import type { GridState } from '../../core/model/types';

/** Upper bound on the hide, for the case where no paint is ever reported. Generous: a real rebuild
 *  of a full map in the 3D view is the slowest honest path through the gate, and cutting it short
 *  brings back the visible snap. */
const RELEASE_SAFETY_MS = 4000;

export interface RestoreFade {
  /** True while the view is hidden: from the commit that applies the restore until it is painted. */
  hidden: boolean;
  /** Call alongside the restore itself. A no-op under reduced motion. */
  begin: () => void;
  /** Arm the release on `state` reaching the screen. Call once the map AND the cameras are applied
   *  (App's gridState effect). A no-op unless a fade is in flight. */
  settle: (state: GridState) => void;
}

export function useRestoreFade(): RestoreFade {
  const [hidden, setHidden] = useState(false);
  const hiddenRef = useRef(false);
  const armed = useRef(false);
  const cancelPending = useRef<(() => void) | null>(null);

  const release = useCallback(() => {
    cancelPending.current?.();
    cancelPending.current = null;
    armed.current = false;
    hiddenRef.current = false;
    setHidden(false);
  }, []);

  const begin = useCallback(() => {
    if (isMotionReduced()) return;
    armed.current = false;
    hiddenRef.current = true;
    setHidden(true);
  }, []);

  const settle = useCallback((state: GridState) => {
    if (!hiddenRef.current || armed.current) return;
    armed.current = true;
    cancelPending.current?.();          // drop the "the restore threw" fallback below
    const stopGate = whenActiveViewPainted(state, release);
    const safety = setTimeout(release, RELEASE_SAFETY_MS);
    cancelPending.current = () => { stopGate(); clearTimeout(safety); };
  }, [release]);

  // The release is the EFFECT's job, never the caller's, so a restore that throws after `begin()`
  // cannot park the canvas at opacity 0. This effect runs BEFORE App's gridState effect (hook order
  // within one commit), so in the normal path `settle()` replaces this fallback before it can fire.
  useEffect(() => {
    if (!hidden || armed.current) return;
    const raf = requestAnimationFrame(release);
    cancelPending.current = () => cancelAnimationFrame(raf);
    return () => cancelAnimationFrame(raf);
  }, [hidden, release]);

  useEffect(() => () => cancelPending.current?.(), []);

  return { hidden, begin, settle };
}
