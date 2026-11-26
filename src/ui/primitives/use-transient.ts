import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * A value that stands for `holdMs` after `show` and then returns to `null`: a confirmation that
 * flashes and goes. A `show` while one stands replaces it and restarts the hold; `clear` drops it at
 * once, and unmounting clears it. With `linger`, the value is also `linger` while that is not null and
 * stays `holdMs` after it turns null, so what it covers or holds back can leave first; a `holdMs` of 0
 * lets it go with `linger`.
 */
export function useTransient<T>(holdMs: number, { linger }: { linger?: T | null } = {}): {
  value: T | null; show: (value: T) => void; clear: () => void;
} {
  const [value, setValue] = useState<T | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stop = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);
  useEffect(() => stop, [stop]);
  const show = useCallback((next: T) => {
    setValue(next);
    stop();
    timer.current = setTimeout(() => { timer.current = null; setValue(null); }, holdMs);
  }, [holdMs, stop]);
  const clear = useCallback(() => { stop(); setValue(null); }, [stop]);
  const following = linger !== undefined;
  const live = linger ?? null;
  // What `linger` last stood at: the render it turns null in still shows it, before its hold starts.
  const lingering = useRef<T | null>(live);
  useEffect(() => {
    if (!following) return;
    if (live !== null) { lingering.current = live; clear(); return; }
    const last = lingering.current;
    lingering.current = null;
    if (last !== null && holdMs > 0) show(last);
  }, [following, live, holdMs, show, clear]);
  const held = following && holdMs > 0 ? lingering.current : null;
  return { value: live ?? held ?? value, show, clear };
}
