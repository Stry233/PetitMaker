/**
 * What the arrival notice says; when it may say it is the greeting gate (`state/greetings.ts`).
 *
 * The saved-session offer stands beside the notice rather than behind it: answering one answers the
 * other, since resuming re-announces the arrival as 'restored' into the notice already up, and a
 * hand on the notice declines the offer (`editor/session/restore.ts:declineRestoreOffer`). Setting to
 * work withdraws both alike.
 */
import type { Arrival, ArrivalKind, ArrivalLine } from '../../../editor/session/arrival';
import type { I18nKey } from '../../../i18n/keys';

/** The phrase the notice opens with, above the planet's name. A lead-in, so each locale writes
 *  whatever reads as one in that language. */
export const ARRIVAL_LEAD_KEY: Record<ArrivalKind, I18nKey> = {
  boot: 'arrival.here',
  restored: 'arrival.here',
  transferred: 'arrival.arrived',
};

/** An arrival with nothing further to say, and the one line a resumed session says. Constants
 *  rather than fresh arrays, so a consumer may key an effect on the sequence it was handed. */
const NO_LINES: readonly ArrivalLine[] = [];
const RESTORED_LINES: readonly ArrivalLine[] = [{ key: 'arrival.restored' }];

/**
 * The lines the phrase gives way to, in the order they are said, or none. Never shown beside the
 * phrase and never chained into one row: the eyebrow says one line at a time.
 *
 * Keys, not words: 'restored' names its own, a transfer carries the ones it was announced with, and
 * either is resolved at render, so the words follow a locale changed while the notice is up.
 */
export function arrivalLines(arrival: Arrival): readonly ArrivalLine[] {
  if (arrival.kind === 'restored') return RESTORED_LINES;
  return arrival.detail ?? NO_LINES;
}
