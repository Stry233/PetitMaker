/**
 * The arrival channel: "the map under you is a planet, and you have just arrived on it".
 *
 * The same shape as `toast-bus.ts` and for the same reason — the fact is known where maps are
 * opened, and it is said by one surface in the React tree. An announcer names WHAT happened and
 * nothing about how it is drawn; whoever is presenting turns that into words.
 *
 * ONE DIFFERENCE FROM THE TOAST BUS: an arrival is LATCHED rather than dropped when nothing is
 * listening. A toast reports something the user just did, so a dropped one is a message about a
 * moment that has passed; an arrival describes where the map IS, which stays true until the next
 * one. That is what lets a caller announce during boot, before the presenter has mounted.
 */
export type ArrivalKind =
  /** A map template opened: the editor starting up, or a planet chosen in the New-project window. */
  | 'boot'
  /** The saved session resumed. */
  | 'restored'
  /** The map carried in from somewhere else: the Change-a-planet window's transfer, which hands
   *  over its own report as the detail. */
  | 'transferred';

/**
 * A line the notice says, NAMED rather than written out.
 *
 * An announcer hands over a key and its values, never a sentence: it can be a layer with no business
 * translating anything (a transfer that lands in `kit` returns data, not prose), and a line frozen
 * into one language at announce time would still be in that language after the visitor changes it.
 * The words are resolved where they are drawn.
 */
export interface ArrivalLine {
  key: string;
  params?: Record<string, string | number>;
}

export interface Arrival {
  kind: ArrivalKind;
  /**
   * What the notice says after the arrival phrase, for a kind that carries lines of its own.
   *
   * A SEQUENCE, said one line at a time. A transfer has more than one thing to report — what came
   * along, and what the new coast could not take — and chaining those into one row makes a sentence
   * nobody stops to read over a map. 'restored' has a fixed line of its own and supplies nothing.
   */
  detail?: readonly ArrivalLine[];
}

type ArrivalListener = (arrival: Arrival) => void;

let listener: ArrivalListener | null = null;
let latched: Arrival | null = null;

/** Post an arrival. Held for the next subscriber when nothing is listening yet. */
export function announceArrival(arrival: Arrival): void {
  if (listener) listener(arrival);
  else latched = arrival;
}

/** Listen for as long as the presenter is mounted; returns its unsubscribe. A latched arrival is
 *  delivered immediately, so a boot announcement made before the mount is not lost. */
export function subscribeArrival(next: ArrivalListener): () => void {
  listener = next;
  if (latched) {
    const held = latched;
    latched = null;
    next(held);
  }
  return () => { if (listener === next) listener = null; };
}

/** Tests only: forget the listener and anything latched. */
export function __resetArrivals(): void {
  listener = null;
  latched = null;
}
