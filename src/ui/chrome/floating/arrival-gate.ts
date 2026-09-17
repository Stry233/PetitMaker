/**
 * When an arrival may be said, and what it says.
 *
 * The notice is a greeting, so it never competes: it waits behind anything that owns the screen or
 * asks the visitor a question, and an arrival announced during any of that is held rather than
 * dropped (`core/runtime/arrival-bus`). Pure, so the whole of "may it show yet" can be read and
 * tested in one place — the component only collects the facts.
 */
import type { Arrival, ArrivalKind, ArrivalLine } from '../../../core/runtime/arrival-bus';

export interface ArrivalFacts {
  /** The boot splash still covers the app. */
  splashActive: boolean;
  /** Something stands in front of the app because it cannot be used as held (the portrait guard). */
  blocked: boolean;
  /** The first-launch tour is running. */
  tourRunning: boolean;
  /** The first-launch offer has been answered: the tour started, or it was waived. Until then a
   *  browser on its very first visit may be a frame away from opening the tour. */
  tourSettled: boolean;
  /** The tour's send-off card is still up. It belongs to the run that just ended, so the greeting
   *  waits for it the same way it waited for the tour. */
  tourDoneOpen: boolean;
  /** The What's new window is up. It speaks first; the greeting follows it. */
  whatsNewOpen: boolean;
}

/*
 * THE SAVED-SESSION OFFER IS NOT A GATE. It asks whether to pick the last map back up; the notice
 * says which planet is under you, which is true either way. So they stand together, and answering
 * one answers the other: resuming re-announces the arrival as 'restored' into the notice already up,
 * and a hand on the notice declines the offer through the shell's own dismissal.
 */

/** Whether the arrival notice may go up right now. */
export function arrivalOpens(f: ArrivalFacts): boolean {
  return !f.splashActive
    && !f.blocked
    && !f.tourRunning
    && f.tourSettled
    && !f.tourDoneOpen
    && !f.whatsNewOpen;
}

/** The phrase the notice opens with, above the planet's name. A lead-in, so each locale writes
 *  whatever reads as one in that language. */
export const ARRIVAL_LEAD_KEY: Record<ArrivalKind, string> = {
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
 * KEYS, not words: 'restored' names its own, a transfer carries the ones it was announced with, and
 * either is resolved at render, so the words follow a locale changed while the notice is up.
 */
export function arrivalLines(arrival: Arrival): readonly ArrivalLine[] {
  if (arrival.kind === 'restored') return RESTORED_LINES;
  return arrival.detail ?? NO_LINES;
}
