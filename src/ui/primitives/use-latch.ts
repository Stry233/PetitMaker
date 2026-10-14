import { useRef } from 'react';

/** True from the first render `on` is true, and for the rest of the component's life: what keeps a
 *  surface mounted after its first use so a close can finish its animation. */
export function useLatch(on: boolean): boolean {
  const latched = useRef(false);
  if (on) latched.current = true;
  return latched.current;
}
