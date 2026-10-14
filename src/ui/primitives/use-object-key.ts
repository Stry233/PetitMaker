import { useState } from 'react';

/**
 * A stable React key per object identity, for a list whose items carry no id of their own: the
 * same object keeps its key for the component's life, a new object takes the next one.
 */
export function useObjectKey<T extends object>(): (item: T) => number {
  const [keyOf] = useState(() => {
    const keys = new WeakMap<T, number>();
    let last = 0;
    return (item: T): number => {
      let key = keys.get(item);
      if (key === undefined) { key = ++last; keys.set(item, key); }
      return key;
    };
  });
  return keyOf;
}
