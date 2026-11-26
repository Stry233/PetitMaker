import { createContext, useContext, type CSSProperties, type ReactNode } from 'react';
import { useIsPresent } from 'framer-motion';

/** Whether an owner above stands away; React context follows body portals, so a portaled card goes with its owner. */
const OwnerAway = createContext(false);

/** The attributes of a surface put away: hidden, covered by another, under an owner put away
 *  (`AwayOwner`), or leaving inside `AnimatePresence` from its first exit frame (`data-leaving` marks
 *  that last case). It takes no input and assistive technology no longer reads it; outside a presence
 *  only `away` and the owner count. */
export function useAway(away = false): Record<string, unknown> {
  const leaving = !useIsPresent();
  const owner = useContext(OwnerAway);
  if (leaving) return { inert: '', 'aria-hidden': true, 'data-leaving': '' };
  return away || owner ? { inert: '', 'aria-hidden': true } : {};
}

/** Hands `away` down to every surface `useAway` puts away below it, body portals included. */
export function AwayOwner({ away, children }: { away: boolean; children: ReactNode }) {
  const owner = useContext(OwnerAway);
  return <OwnerAway.Provider value={away || owner}>{children}</OwnerAway.Provider>;
}

/** A box wearing `useAway`'s attributes around a surface, the presence child when it fades away. */
export function Away({ away = false, style, children }: { away?: boolean; style?: CSSProperties; children: ReactNode }) {
  return <div style={style} {...useAway(away)}>{children}</div>;
}
