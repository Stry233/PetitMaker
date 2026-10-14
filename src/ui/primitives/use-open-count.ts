import { useState } from 'react';

/** How many times `open` has turned on, counted during render: a key that gives each opening a fresh
 *  subtree, even one that lands while the last close is still animating out. */
export function useOpenCount(open: boolean): number {
  const [count, setCount] = useState(open ? 1 : 0);
  const [was, setWas] = useState(open);
  if (open !== was) {
    setWas(open);
    if (open) setCount((n) => n + 1);
  }
  return count;
}
