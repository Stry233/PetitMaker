/**
 * Hides a restored map until the active view has painted both its state and restored camera. A
 * next-frame fallback covers a failed restore that never calls `settle`; a timeout covers renderers
 * that never report paint. Reduced motion skips the fade and its transparent frame entirely.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { isMotionReduced } from '../../canvas/map2d/motion-state';
import { whenActiveViewPainted } from '../../canvas/view-settled';
import type { GridState } from '../../core/model/types';

/** Upper bound on the hide when no renderer reports a completed paint. */
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
