import { useRef } from 'react';

/**
 * `value`, keeping the identity it had while its `keyOf` stays the same: a record rebuilt every
 * render with equal contents (options, notes, a list of shots) can stand in a dependency list and
 * change only when its contents do. The default key is the JSON text, so `value` must serialize.
 */
export function useSettledValue<T>(value: T, keyOf: (value: T) => string = JSON.stringify): T {
  const key = keyOf(value);
  const held = useRef({ key, value });
  if (held.current.key !== key) held.current = { key, value };
  return held.current.value;
}
