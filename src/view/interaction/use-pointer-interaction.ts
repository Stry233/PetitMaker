import { useEffect, type RefObject } from 'react';
import { installPointerMachine } from './pointer/machine';

/** Mounts the shared pointer machine (`pointer/machine.ts`) on a map view's container for the
 *  container's lifetime. Both canvases call this. */
export function usePointerInteraction(
  containerRef: RefObject<HTMLDivElement | null>,
) {
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    return installPointerMachine(container);
  }, [containerRef]);
}
