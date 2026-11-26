/**
 * The arrival channel: "the map under you is a planet, and you have just arrived on it". The fact is
 * known where a map is opened (the boot, a restored session, a planet switch), so it is announced
 * here, and said by whichever surface the edition presents it on. An announcer names what happened
 * and nothing about how it is drawn.
 *
 * An arrival is latched when nothing is listening: it says where the map is, which stays true
 * until the next one, so an announcement made during boot waits for its presenter.
 */
import type { I18nKey } from '../../i18n/keys';
import type { TransferCounts } from '../../tools/generation/transfer';

export type ArrivalKind =
  /** A map template opened: the editor starting up, or a planet opened with nothing carried. */
  | 'boot'
  /** The saved session resumed. */
  | 'restored'
  /** The build carried over to another planet; its report is the detail. */
  | 'transferred';

/** A line the notice says, as a key and its values: the words are resolved where they are drawn, so
 *  they follow a language changed while the notice stands. */
export interface ArrivalLine {
  key: I18nKey;
  params?: Record<string, string | number>;
}

export interface Arrival {
  kind: ArrivalKind;
  /** What the notice says after the arrival phrase, one line at a time, for a kind with lines of
   *  its own; 'restored' has a fixed line and supplies none. */
  detail?: readonly ArrivalLine[];
}

type ArrivalListener = (arrival: Arrival) => void;

let listener: ArrivalListener | null = null;
let latched: Arrival | null = null;

/** Posts an arrival, held for the next subscriber when nothing is listening yet. */
export function announceArrival(arrival: Arrival): void {
  if (listener) listener(arrival);
  else latched = arrival;
}

/** Listens for as long as the presenter is mounted; returns its unsubscribe. A latched arrival is
 *  delivered at once. */
export function subscribeArrival(next: ArrivalListener): () => void {
  listener = next;
  if (latched) {
    const held = latched;
    latched = null;
    next(held);
  }
  return () => { if (listener === next) listener = null; };
}

/** Tests only: forgets the listener and anything latched. */
export function __resetArrivals(): void {
  listener = null;
  latched = null;
}

const CAME_ALONG: ArrivalLine = { key: 'arrival.transferred' };

/** Terrain cells and objects use separate counts and translated labels. */
function transferLines(dropped: TransferCounts): readonly ArrivalLine[] {
  const { cells, objects } = dropped;
  if (cells > 0 && objects > 0) return [CAME_ALONG, { key: 'arrival.transferred_both', params: { cells, objects } }];
  if (cells > 0) return [CAME_ALONG, { key: 'arrival.transferred_ground', params: { cells } }];
  if (objects > 0) return [CAME_ALONG, { key: 'arrival.transferred_pieces', params: { objects } }];
  return [CAME_ALONG];
}

const NOTHING_ARRIVED: readonly ArrivalLine[] = [
  { key: 'arrival.transferred_lost' },
  { key: 'arrival.transferred_lost_none' },
];

/** The arrival a planet switch announces: what its carry reported, or a plain arrival where the
 *  planet started over (`outcome` null) or nothing travelled. */
export function transferArrival(outcome: { moved: TransferCounts; dropped: TransferCounts } | null): Arrival {
  if (!outcome) return { kind: 'boot' };
  const { moved, dropped } = outcome;
  if (moved.cells + moved.objects > 0) return { kind: 'transferred', detail: transferLines(dropped) };
  if (dropped.cells + dropped.objects > 0) return { kind: 'transferred', detail: NOTHING_ARRIVED };
  return { kind: 'boot' };
}

/** The first thing `arrival`'s carry left behind, as its lines say it after what came along; null
 *  when nothing was left behind. An edition without the arrival card says only this. */
export function arrivalLoss(arrival: Arrival): ArrivalLine | null {
  return arrival.detail?.find((line) => line.key !== CAME_ALONG.key) ?? null;
}
