import { useCallback, useState } from 'react';

/** A set of open keys with a toggle, for lists whose rows open independently of one another. */
export function useToggleSet<K>(): { has(key: K): boolean; toggle(key: K): void } {
  const [open, setOpen] = useState<ReadonlySet<K>>(() => new Set());
  const toggle = useCallback((key: K) => {
    setOpen((was) => {
      const next = new Set(was);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  }, []);
  return { has: (key: K) => open.has(key), toggle };
}
