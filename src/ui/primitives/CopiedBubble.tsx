import type { CSSProperties, ReactNode } from 'react';
import { useTransient } from './use-transient';
import { ControlBubble } from './ControlBubble';

/** How long the confirmation stands after a copy, in ms; a copy while it stands restarts it. */
const COPIED_HOLD_MS = 1200;

/**
 * Runs the caller's `copy` and remembers which `target` was copied for `COPIED_HOLD_MS`. A copy
 * that answers false (refused or unavailable) leaves `copied` untouched.
 */
export function useCopyFeedback<T extends string = 'copied'>(copy: (text: string) => Promise<boolean>): {
  copied: T | null;
  copy: (text: string, target?: T) => Promise<void>;
} {
  const { value: copied, show } = useTransient<T>(COPIED_HOLD_MS);
  const copyAndShow = async (text: string, target = 'copied' as T) => {
    if (await copy(text)) show(target);
  };
  return { copied, copy: copyAndShow };
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
