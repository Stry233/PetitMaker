/*
 * use-viewport.ts — the window's own height, as a subscription.
 *
 * The frame is laid out in fixed px and takes the room it needs, so most of it never asks how big
 * the window is. Two things must: a panel that has to end above the bars, and a shelf whose drawn
 * proportions would take half of a laptop screen. Both need the answer to CHANGE when the window
 * does, which a one-off read at mount does not give.
 */
import { useEffect, useState } from 'react';
import { useUiPreviewPose } from '../primitives/ui-preview';

/** Fallback for a render with no window (a test, a server): the height the design assumes. */
const ASSUMED_VH = 1080;

export function useViewportHeight(): number {
  const posed = useUiPreviewPose()?.viewport?.h;
  const [vh, setVh] = useState(() => (typeof window === 'undefined' ? ASSUMED_VH : window.innerHeight));
  useEffect(() => {
    const onResize = () => setVh(window.innerHeight);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  // A pictured shell is laid out for the window its figure poses, not the live one.
  return posed ?? vh;
}
