import { useEffect, useLayoutEffect, useRef, type DependencyList } from 'react';

/**
 * Calls `onResize` with the observed elements once when the effect runs and again whenever any
 * element `targets` returns changes its box. `targets` runs inside the effect, so refs read there are committed; nothing is
 * observed, and `onResize` does not run, when it returns no element. Where `ResizeObserver` is
 * missing (jsdom) only the first call happens. `layout` (the default) measures before paint;
 * `immediate: false` waits for the first change; `deps` undefined re-observes after every render.
 */
export function useObservedSize<E extends Element = HTMLElement>(
  targets: () => E | null | undefined | readonly (E | null | undefined)[],
  onResize: (observed: readonly E[]) => void,
  deps: DependencyList | undefined,
  { layout = true, immediate = true }: { layout?: boolean; immediate?: boolean } = {},
): void {
  const callback = useRef(onResize);
  callback.current = onResize;
  const read = useRef(targets);
  read.current = targets;
  const useAnyEffect = layout ? useLayoutEffect : useEffect;
  useAnyEffect(() => {
    const found = read.current();
    const elements = ((Array.isArray(found) ? found : [found]) as (E | null | undefined)[]).filter((el): el is E => !!el);
    if (!elements.length) return undefined;
    const run = () => callback.current(elements);
    if (immediate) run();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(run);
    for (const el of elements) observer.observe(el);
    return () => observer.disconnect();
    // The caller's deps decide when to re-observe.
  }, deps);
}
