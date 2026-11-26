/*
 * The live selection card's delete control, which the delete question grows from while the card shows.
 * One live card stands at a time, so this is the page-wide registration that card makes and takes back;
 * a pictured card makes none.
 */
import { useSyncExternalStore, type RefObject } from 'react';

export interface CardAnchor {
  /** The card's placed box, hidden while the selection stands out of view. */
  box: RefObject<HTMLElement | null>;
  /** The card's plate, header and details together. */
  plate: RefObject<HTMLElement | null>;
  /** Its delete control, empty where the selection offers none. */
  control: RefObject<HTMLElement | null>;
  /** Whether the details grow up from the header, so the plate's far edge is its top. */
  growUp: boolean;
}

let current: CardAnchor | null = null;
const listeners = new Set<() => void>();

/** Stands `anchor` as the live card's until the returned call takes it back. */
export function registerCardAnchor(anchor: CardAnchor): () => void {
  current = anchor;
  for (const heard of listeners) heard();
  return () => {
    if (current !== anchor) return;
    current = null;
    for (const heard of listeners) heard();
  };
}

const subscribe = (heard: () => void) => { listeners.add(heard); return () => { listeners.delete(heard); }; };

/** The live card's anchor, or null while no card stands. */
export function useCardAnchor(): CardAnchor | null {
  return useSyncExternalStore(subscribe, () => current, () => null);
}
