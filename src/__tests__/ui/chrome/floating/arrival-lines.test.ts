/**
 * What the arrival notice says, and the bus that hands it an arrival. When it may say it is the
 * greeting gate's (`__tests__/state/greetings.test.ts`).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  __resetArrivals, announceArrival, subscribeArrival, type Arrival,
} from '../../../../editor/session/arrival';
import { ARRIVAL_LEAD_KEY, arrivalLines } from '../../../../ui/chrome/floating/arrival-lines';
import type { ArrivalLine } from '../../../../editor/session/arrival';

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
    const report: ArrivalLine[] = [{ key: 'arrival.transferred' }, { key: 'arrival.transferred_ground', params: { cells: 4 } }];
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
