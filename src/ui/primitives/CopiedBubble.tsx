import type { CSSProperties, ReactNode } from 'react';
import { SUPPORTS_CLIPBOARD } from '../../platform/build/edition';
import { useTransient } from './use-transient';
import { ControlBubble } from './ControlBubble';

/** How long the confirmation stands after a copy, in ms; a copy while it stands restarts it. */
const COPIED_HOLD_MS = 1200;

/**
 * Copies text to the clipboard and remembers which `target` was copied for `COPIED_HOLD_MS`.
 * A refused or unavailable clipboard leaves `copied` untouched; an edition without clipboard support
 * (`edition.ts:SUPPORTS_CLIPBOARD`) never attempts it.
 */
export function useCopyFeedback<T extends string = 'copied'>(): {
  copied: T | null;
  copy: (text: string, target?: T) => Promise<void>;
} {
  const { value: copied, show } = useTransient<T>(COPIED_HOLD_MS);
  const copy = async (text: string, target = 'copied' as T) => {
    if (!SUPPORTS_CLIPBOARD) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      return;
    }
    show(target);
  };
  return { copied, copy };
}

/**
 * The "Copied" confirmation hung from the control that copied: above it (`side="above"`, tail
 * down) or below it, announced as a status. Place it inside a positioned wrapper around the control.
 */
export function CopiedBubble({ show, side, style, children }: {
  show: boolean;
  side: 'above' | 'below';
  style?: CSSProperties;
  children: ReactNode;
}) {
  return <ControlBubble show={show} side={side} announce {...(style ? { style } : {})}>{children}</ControlBubble>;
}
