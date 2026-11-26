/**
 * Whether the arrival notice is on screen, which its presenter says for the surfaces that must not
 * cover it. The arrivals themselves are announced below ui (`editor/session/arrival.ts`).
 */
import { useSyncExternalStore } from 'react';
import { createSignal } from '../../core/base/signal';

const standing = createSignal(false);

/** The presenter says whether its notice is on screen. */
export function setArrivalStanding(on: boolean): void {
  if (standing.get() !== on) standing.emit(on);
}

/** Whether an arrival notice is on screen. */
export function useArrivalStanding(): boolean {
  return useSyncExternalStore(standing.subscribe, standing.get);
}
