import { useEffect, useSyncExternalStore } from 'react';
import { setReducedMotion } from '../../platform/channels/motion-state';
import { useEditorStore } from '../../state/store';
import type { MotionPref } from '../../platform/storage/prefs';

/**
 * The one owner of the reduced-motion decision. The OS reading is subscribed live, the user's
 * preference overrides it ('reduced' and 'full'), and the effective value reaches all three gates:
 *   - Framer/DOM: App passes `reducedMotion="always" | "never"` from `useMotionEnabled()`;
 *   - canvas rAF loops (2D Pixi and the 3D scene): the `motion-state` module singleton;
 *   - CSS: `<html data-reduced-motion="1|0">`, which `ui/design/animations.css` keys off.
 * CSS cannot use the media query alone because it would ignore both overrides.
 */
const QUERY = '(prefers-reduced-motion: reduce)';

function mediaQuery(): MediaQueryList | null {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(QUERY) : null;
}

function subscribeOs(onChange: () => void): () => void {
  const mq = mediaQuery();
  if (!mq) return () => {};
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
}

const osReduces = (): boolean => mediaQuery()?.matches ?? false;

/** Whether this device asks for reduced motion, updated live when the OS setting changes. */
export function useOsReducedMotion(): boolean {
  return useSyncExternalStore(subscribeOs, osReduces, () => false);
}

export function resolveReducedMotion(pref: MotionPref, os: boolean): boolean {
  return pref === 'reduced' || (pref === 'system' && os);
}

function publish(reduced: boolean): void {
  setReducedMotion(reduced);
  // Always a definitive value, never absent, so a Full override beats an OS that asks for reduce.
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.reducedMotion = reduced ? '1' : '0';
  }
}

/** Publishes the effective preference to the canvas and CSS gates and returns it for Framer.
 *  Mount once near the app root. */
export function useMotionEnabled(): boolean {
  const reduced = resolveReducedMotion(useEditorStore((s) => s.motionPref), useOsReducedMotion());
  useEffect(() => publish(reduced), [reduced]);
  return reduced;
}
