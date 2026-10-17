import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * A value that stands for `holdMs` after `show` and then returns to `null`: a confirmation that
 * flashes and goes. A `show` while one stands replaces it and restarts the hold; unmounting clears it.
 */
export function useTransient<T>(holdMs: number): { value: T | null; show: (value: T) => void } {
  const [value, setValue] = useState<T | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const show = useCallback((next: T) => {
    setValue(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { timer.current = null; setValue(null); }, holdMs);
  }, [holdMs]);
  return { value, show };
}
