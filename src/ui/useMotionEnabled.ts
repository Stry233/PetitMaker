import { useEffect } from 'react';
import { setReducedMotion } from '../canvas/map2d/motion-state';
import { useEditorStore } from '../state/store';

/**
 * Publishes the user's EFFECTIVE motion preference to the two gates that can't read the store
 * themselves, so all three stay in agreement:
 *   - canvas rAF loops (2D Pixi + the 3D scene) → the `motion-state` module singleton;
 *   - CSS → `<html data-reduced-motion="1|0">`, which `ui/animations.css` keys off.
 * (The third gate, Framer/DOM, is driven separately by <MotionConfig> in App from the same store
 * value.) 'system' follows the OS prefers-reduced-motion live; 'reduced'/'full' are explicit
 * overrides — which is why CSS cannot just use the media query: it would ignore both overrides.
 * Mount once near the app root.
 */
function publish(reduced: boolean): void {
  setReducedMotion(reduced);
  // Always write a definitive value (never "absent"), so a Full override can beat an OS that asks
  // for reduce, exactly as it already does for Framer and the canvas.
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.reducedMotion = reduced ? '1' : '0';
  }
}

export function useMotionEnabled(): void {
  const motionPref = useEditorStore((s) => s.motionPref);
  useEffect(() => {
    if (motionPref === 'reduced') { publish(true); return; }
    if (motionPref === 'full') { publish(false); return; }
    // 'system' — follow the OS preference, live.
    if (typeof window === 'undefined' || !window.matchMedia) { publish(false); return; }
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const apply = () => publish(mq.matches);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [motionPref]);
}
