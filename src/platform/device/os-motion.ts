/** The device's own request for reduced motion, the only reader of `prefers-reduced-motion` in
 *  script; the motion preference decides what it counts for (`storage/prefs.ts:resolveReducedMotion`). */
const QUERY = '(prefers-reduced-motion: reduce)';

function mediaQuery(): MediaQueryList | null {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(QUERY) : null;
}

/** Whether this device asks for reduced motion now; false where no media query can be read. */
export function osReducesMotion(): boolean {
  return mediaQuery()?.matches ?? false;
}

/** Calls `onChange` whenever the device's setting changes; returns the stop. */
export function watchOsReducedMotion(onChange: () => void): () => void {
  const mq = mediaQuery();
  if (!mq) return () => {};
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
}
