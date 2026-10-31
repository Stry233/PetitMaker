/**
 * Whether the visitor has set to work: a mode, the menu, a window other than What's new or the
 * assistant open, or their own first edit on the map. The surfaces that greet a visit (the
 * welcome-back offer and the arrival notice) give way to it alike.
 *
 * The open surfaces are the shell's to know, the menu among them, so the shell publishes them here
 * (`useShellEngagedSource`); the tips publish nothing, since what their Show me opens is not the
 * visitor's choice. The first edit is counted from the moment a greeting arms the watch.
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import { createSignal } from '../../core/base/signal';
import { watchFirstEdit } from '../../editor/session/restore';

const open = createSignal(false);

/** The live shell's half: whether one of its surfaces the visitor chose stands open, for as long as
 *  it is mounted. `null` from a pictured shell, which speaks for no visitor. */
export function useShellEngagedSource(engaged: boolean | null): void {
  useEffect(() => {
    if (engaged === null) return undefined;
    if (open.get() !== engaged) open.emit(engaged);
    return engaged ? () => open.emit(false) : undefined;
  }, [engaged]);
}

/** Whether a surface the visitor chose stands open now, for a check made outside a render. */
export function shellEngaged(): boolean {
  return open.get();
}

/** The same, as a hook that re-renders when it changes. */
export function useShellEngaged(): boolean {
  return useSyncExternalStore(open.subscribe, open.get, () => false);
}

/** True while `armed` once the visitor has set to work (an open surface, or an edit made since arming). */
export function useVisitorEngaged(armed: boolean): boolean {
  const surfaces = useShellEngaged();
  const [edited, setEdited] = useState(false);
  useEffect(() => {
    setEdited(false);
    return armed ? watchFirstEdit(() => setEdited(true)) : undefined;
  }, [armed]);
  return armed && (surfaces || edited);
}

/** Tests only: forget what the shell published. */
export function __resetEngagement(): void {
  open.emit(false);
}
