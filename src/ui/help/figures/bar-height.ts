/**
 * The height a demo's pictured bar takes, its hanging names included, measured once per bar look
 * and form for the page: one figure mounts its bar to measure it and every other figure of the same
 * look reserves that height without mounting its own until it nears the viewport, so a page of
 * demos mounts one bar per look rather than one per figure and every box holds its size from the
 * first frame (UI-62).
 */
import { useLayoutEffect, useState } from 'react';

const heights = new Map<string, number>();
const claimed = new Set<string>();
const waiting = new Map<string, Set<(h: number) => void>>();

/** Records the measured height of `key`'s bar and tells every figure waiting on it. Heights only
 *  grow, as a bar's own measure does, so a figure never shrinks under a later reading. */
export function publishBarHeight(key: string, h: number): void {
  if (h <= (heights.get(key) ?? 0)) return;
  heights.set(key, h);
  for (const tell of waiting.get(key) ?? []) tell(h);
}

/** The reserved height for `key` (0 until measured) and whether this figure is the one to mount
 *  its bar and measure it. */
export function useReservedBarHeight(key: string | null): { reserved: number; measure: boolean } {
  const [reserved, setReserved] = useState(() => (key ? heights.get(key) ?? 0 : 0));
  const [measure, setMeasure] = useState(false);
  useLayoutEffect(() => {
    if (!key) return undefined;
    const tell = (h: number) => setReserved(h);
    let set = waiting.get(key);
    if (!set) { set = new Set(); waiting.set(key, set); }
    set.add(tell);
    const known = heights.get(key);
    if (known !== undefined) setReserved(known);
    else if (!claimed.has(key)) { claimed.add(key); setMeasure(true); }
    return () => {
      set.delete(tell);
      // A measurer that leaves before measuring frees the claim for the next figure to stand.
      if (!heights.has(key)) claimed.delete(key);
      setMeasure(false);
    };
  }, [key]);
  return { reserved, measure };
}
