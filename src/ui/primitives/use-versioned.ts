import { useRef } from 'react';

/**
 * `compute()`, recomputed only when one of `versions` changes (compared with `Object.is`). A version
 * stands in for state `compute` reads that changes in place (a counter a store bumps on every
 * write), so the list names what the value follows rather than what the closure captures.
 */
export function useVersioned<T>(compute: () => T, versions: readonly unknown[]): T {
  const held = useRef<{ versions: readonly unknown[]; value: T } | null>(null);
  const last = held.current;
  if (!last || last.versions.length !== versions.length || last.versions.some((v, i) => !Object.is(v, versions[i]))) {
    held.current = { versions: [...versions], value: compute() };
  }
  return held.current!.value;
}
