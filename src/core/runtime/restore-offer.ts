/**
 * The saved-session offer, as something a surface standing beside it can answer.
 *
 * The offer belongs to the shell, which owns the card, the candidate and every existing way of
 * putting it away: the two answers on it, opening the menu, choosing a mode, making the first edit.
 * They are ONE path (`Shell.tsx`'s `dismissRestore`) and this is how a surface outside the shell
 * reaches that path rather than growing a second one — the arrival notice, which stands over the map
 * at the same moment and whose OK is a hand saying "yes, this is where I am".
 *
 * The same channel shape as `toast-bus.ts`: the shell registers while there is something to decline
 * and `declineRestoreOffer` is a no-op when nothing is standing, so a caller never has to ask
 * whether the offer is up.
 */
type RestoreDismiss = () => void;

let dismiss: RestoreDismiss | null = null;

/** Register the standing offer's own dismissal for as long as it stands; returns its withdrawal. */
export function offerRestoreDismiss(next: RestoreDismiss): () => void {
  dismiss = next;
  return () => { if (dismiss === next) dismiss = null; };
}

/** Decline the standing offer, through the offer's own path. Silently dropped when none stands. */
export function declineRestoreOffer(): void {
  dismiss?.();
}

/** Tests only: forget whatever is registered. */
export function __resetRestoreOffer(): void {
  dismiss = null;
}
