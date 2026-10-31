/*
 * The chrome lift read inside a surface's open branch: a floating surface that stands closed most of
 * the time mounts this with its content, so a closed one hears no scale or window change.
 */
import type { ReactNode } from 'react';
import { useChromeLift, type ChromeLift } from './chrome-layer';

/** Hands `children` the lift `useChromeLift(control, touch)` reads, for as long as it is mounted. */
export function ChromeLifted({ control, touch, children }: {
  control?: number;
  touch?: boolean;
  children: (lift: ChromeLift) => ReactNode;
}) {
  return <>{children(useChromeLift(control, touch))}</>;
}
