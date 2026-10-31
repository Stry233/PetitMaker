/**
 * The edits still landing on the live map over several frames (a Generate card's replay, a press on
 * the map from its landing to its release, a card carried to the map): each holds itself here with
 * the way to cancel it while it lands, so something that takes the map back (a Show me giving back
 * what the visitor tried) cancels them first, Escape on the map takes back those the hand holds, and a watch can
 * tell a landing still open from one done. A page-wide registration: the edits are the live map's.
 */
import { createSignal } from '../core/base/signal';

/** Who an edit lands by: the visitor's hand (a press still down, a card carried), which Escape takes
 *  back, or a build landing by itself (a Generate card's replay), which only taking the map back stops. */
export type EditLanding = 'hand' | 'build';

const cancels = new Map<() => void, EditLanding>();
const changed = createSignal();

/** Holds an edit as landing until the returned release; `cancel` stops it and takes it back. */
export function holdEditInFlight(cancel: () => void, by: EditLanding): () => void {
  cancels.set(cancel, by);
  changed.emit();
  return () => { if (cancels.delete(cancel)) changed.emit(); };
}

/** Whether an edit is still landing, of either kind or of `by` alone. */
export function editsInFlight(by?: EditLanding): boolean {
  return by === undefined ? cancels.size > 0 : [...cancels.values()].includes(by);
}

/** Cancels every edit still landing, or those landing `by` alone; whether there was one. */
export function cancelEditsInFlight(by?: EditLanding): boolean {
  const landing = [...cancels].filter(([, kind]) => by === undefined || kind === by).map(([cancel]) => cancel);
  for (const cancel of landing) cancel();
  return landing.length > 0;
}

/** Called whenever an edit starts or stops landing; returns the unsubscribe. */
export function onEditsInFlightChange(listener: () => void): () => void {
  return changed.subscribe(listener);
}
