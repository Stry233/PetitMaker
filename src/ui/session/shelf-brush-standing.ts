/**
 * Whether the object shelf's brush button stands usable on the live screen, published by the button
 * for the speech bubble that points it out (`chrome/floating/MenuBubbles.tsx`), which stands outside
 * the shelf and must not point at a button that is gone or unavailable.
 */
import { useEffect, useSyncExternalStore } from 'react';
import { createSignal } from '../../core/base/signal';

const standing = createSignal(0);

/** The live button's half: counted while mounted and `usable`, so the upright panel's second seat
 *  handing over to the first never reads as gone. `null` from a pictured shell. */
export function useShelfBrushSource(usable: boolean | null): void {
  useEffect(() => {
    if (!usable) return undefined;
    standing.emit(standing.get() + 1);
    return () => standing.emit(standing.get() - 1);
  }, [usable]);
}

/** Whether a usable brush button stands on the live screen. */
export function useShelfBrushStanding(): boolean {
  return useSyncExternalStore(standing.subscribe, () => standing.get() > 0, () => false);
}
