/**
 * The arrival notice's two pure parts: when it may be said, and what it says.
 *
 * The gate is where the whole of "why has the greeting not come up" lives, so every deferral it
 * knows about is pinned here rather than discovered by mounting the app in seven states.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  __resetArrivals, announceArrival, subscribeArrival, type Arrival,
} from '../../../core/runtime/arrival-bus';
import {
  ARRIVAL_LEAD_KEY, arrivalLines, arrivalOpens, type ArrivalFacts,
} from '../../../ui/chrome/floating/arrival-gate';

/** A browser with nothing in the way: the notice may go up. */
const clear: ArrivalFacts = {
  splashActive: false,
  blocked: false,
  tourRunning: false,
  tourSettled: true,
  tourDoneOpen: false,
};

describe('the arrival gate', () => {
  it('opens when nothing else owns the screen', () => {
    expect(arrivalOpens(clear)).toBe(true);
  });

  it('waits behind the boot splash', () => {
    expect(arrivalOpens({ ...clear, splashActive: true })).toBe(false);
  });

  it('waits behind the portrait guard', () => {
    expect(arrivalOpens({ ...clear, blocked: true })).toBe(false);
  });

  it('waits for the tour, its offer and its send-off', () => {
    expect(arrivalOpens({ ...clear, tourRunning: true })).toBe(false);
    // The first-launch offer has not been answered yet: the tour may still be a frame away.
    expect(arrivalOpens({ ...clear, tourSettled: false })).toBe(false);
    expect(arrivalOpens({ ...clear, tourDoneOpen: true })).toBe(false);
  });

  // The saved-session offer is deliberately NOT among the facts: the card asks whether to pick the
  // last map back up, the notice says which planet is under you, and both are true at once.
  it('knows nothing about the saved-session offer', () => {
    expect(Object.keys(clear)).not.toContain('restorePending');
  });
});

describe('what an arrival says', () => {
  it('leads with the arrival phrase its kind uses', () => {
    expect(ARRIVAL_LEAD_KEY.boot).toBe('arrival.here');
    expect(ARRIVAL_LEAD_KEY.restored).toBe('arrival.here');
    expect(ARRIVAL_LEAD_KEY.transferred).toBe('arrival.arrived');
  });

  it('gives a plain boot nothing to say after the phrase', () => {
    expect(arrivalLines({ kind: 'boot' })).toEqual([]);
  });

  it('names the restored line itself, rather than taking words from the caller', () => {
    expect(arrivalLines({ kind: 'restored' })).toEqual([{ key: 'arrival.restored' }]);
  });

  it('carries a transfer report as the sequence it was announced with', () => {
    // One fact per line: what came along, then what the new coast could not take.
    const report = [{ key: 'transfer.came' }, { key: 'transfer.left', params: { cells: 4 } }];
    expect(arrivalLines({ kind: 'transferred', detail: report })).toEqual(report);
    expect(arrivalLines({ kind: 'transferred' })).toEqual([]);
  });

  it('hands back the same empty sequence every time, so a cycle can be keyed on it', () => {
    expect(arrivalLines({ kind: 'boot' })).toBe(arrivalLines({ kind: 'transferred' }));
  });
});

describe('the arrival bus', () => {
  beforeEach(() => __resetArrivals());

  it('hands an arrival to whoever is listening', () => {
    const seen: Arrival[] = [];
    subscribeArrival((a) => seen.push(a));
    announceArrival({ kind: 'boot' });
    expect(seen).toEqual([{ kind: 'boot' }]);
  });

  it('latches an arrival announced before anything mounted', () => {
    announceArrival({ kind: 'restored' });
    const seen: Arrival[] = [];
    subscribeArrival((a) => seen.push(a));
    expect(seen).toEqual([{ kind: 'restored' }]);
  });

  it('delivers a latched arrival once, not to every later subscriber', () => {
    announceArrival({ kind: 'boot' });
    subscribeArrival(() => {});
    const later: Arrival[] = [];
    subscribeArrival((a) => later.push(a));
    expect(later).toEqual([]);
  });

  it('stops delivering once the presenter has gone', () => {
    const seen: Arrival[] = [];
    const off = subscribeArrival((a) => seen.push(a));
    off();
    announceArrival({ kind: 'boot' });
    expect(seen).toEqual([]);
  });
});
