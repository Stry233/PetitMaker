import { useLayoutEffect, useState, type RefObject } from 'react';

/**
 * The element's natural layout width (`scrollWidth`), so a clip hiding part of it does not change
 * the number. Re-read before paint when `remeasureOn` changes; a change under `tolerance` css px
 * keeps the previous reading.
 */
export function useNaturalWidth(ref: RefObject<HTMLElement | null>, remeasureOn: unknown, tolerance = 0): number {
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const w = ref.current?.scrollWidth ?? 0;
    setWidth((was) => ((tolerance > 0 ? Math.abs(was - w) < tolerance : was === w) ? was : w));
  }, [ref, remeasureOn, tolerance]);
  return width;
}
