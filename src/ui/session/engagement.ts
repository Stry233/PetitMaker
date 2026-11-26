/**
 * Whether the visitor has set to work, as the surfaces that greet a visit read it: the rule is
 * `editor/session/restore.ts:watchVisitorEngaged` (a surface they chose stands open, or their own
 * first edit), which declines the welcome-back offer itself; the arrival notice gives way to it here.
 *
 * The open surfaces are the shell's to know, the menu among them, so the shell publishes them
 * (`useShellEngagedSource`); the tips publish nothing, since what their Show me opens is not the
 * visitor's choice.
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import {
  chosenSurfacesOpen, publishChosenSurfaces, subscribeChosenSurfaces, watchVisitorEngaged,
} from '../../editor/session/restore';

/** The live shell's half: whether one of its surfaces the visitor chose stands open, for as long as
 *  it is mounted. `null` from a pictured shell, which speaks for no visitor. */
export function useShellEngagedSource(engaged: boolean | null): void {
  useEffect(() => {
    if (engaged === null) return undefined;
    publishChosenSurfaces(engaged);
    return engaged ? () => publishChosenSurfaces(false) : undefined;
  }, [engaged]);
}

/** Whether a surface the visitor chose stands open now, for a check made outside a render. */
export function shellEngaged(): boolean {
  return chosenSurfacesOpen();
}

/** The same, as a hook that re-renders when it changes. */
export function useShellEngaged(): boolean {
  return useSyncExternalStore(subscribeChosenSurfaces, chosenSurfacesOpen, () => false);
}

/** True while `armed` once the visitor has set to work (an open surface, or an edit made since arming). */
export function useVisitorEngaged(armed: boolean): boolean {
  const [engaged, setEngaged] = useState(false);
  useEffect(() => {
    setEngaged(false);
    return armed ? watchVisitorEngaged(() => setEngaged(true)) : undefined;
  }, [armed]);
  return armed && engaged;
}
