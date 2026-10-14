import { useCallback, useInsertionEffect, useRef } from 'react';

/**
 * React 19's `useEffectEvent` on React 18: a function of fixed identity that runs the latest
 * `handler`, for an effect that reacts to some values and only reads others when it fires. The
 * hooks lint knows the name and leaves the result out of dependency lists. Call it from effects and
 * event handlers, never during render; the handler is swapped in before any layout effect runs.
 */
export function useEffectEvent<A extends unknown[], R>(handler: (...args: A) => R): (...args: A) => R {
  const latest = useRef(handler);
  useInsertionEffect(() => { latest.current = handler; });
  return useCallback((...args: A) => latest.current(...args), []);
}
