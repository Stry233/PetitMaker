import { useRef, type KeyboardEvent } from 'react';
import { isComposingKey } from '../../../platform/input/text-entry';

/** A composer field's IME composition: the handlers that follow it, and whether a key belongs to it
 *  rather than to the field or the panel around it. */
export function useComposition(): {
  bind: { onCompositionStart(): void; onCompositionEnd(): void };
  owns(e: KeyboardEvent): boolean;
} {
  const composing = useRef(false);
  return {
    bind: {
      onCompositionStart: () => { composing.current = true; },
      onCompositionEnd: () => { composing.current = false; },
    },
    owns: (e) => composing.current || isComposingKey(e.nativeEvent),
  };
}
