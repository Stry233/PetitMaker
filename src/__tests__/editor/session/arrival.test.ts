/** The arrival channel below ui: an arrival waits for its presenter, and a carry's report becomes
 *  the lines the notice says and the one loss an edition without the notice toasts. */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  __resetArrivals, announceArrival, arrivalLoss, subscribeArrival, transferArrival, type Arrival,
} from '../../../editor/session/arrival';

const none = { cells: 0, objects: 0 };
const loss = (outcome: Parameters<typeof transferArrival>[0]) => arrivalLoss(transferArrival(outcome));

beforeEach(() => { __resetArrivals(); });

describe('the arrival channel', () => {
  it('holds an arrival announced before its presenter listens, and hands later ones straight over', () => {
    announceArrival({ kind: 'boot' });
    announceArrival({ kind: 'restored' });
    const heard: Arrival[] = [];
    const off = subscribeArrival((arrival) => { heard.push(arrival); });
    expect(heard, 'the newest one waited').toEqual([{ kind: 'restored' }]);
    announceArrival({ kind: 'boot' });
    expect(heard).toEqual([{ kind: 'restored' }, { kind: 'boot' }]);
    off();
    announceArrival({ kind: 'transferred' });
    expect(heard).toHaveLength(2);
  });
});

describe('what a planet switch announces', () => {
  it('a planet started over, or a carry nothing travelled on, arrives like any boot', () => {
    expect(transferArrival(null)).toEqual({ kind: 'boot' });
    expect(transferArrival({ moved: none, dropped: none })).toEqual({ kind: 'boot' });
  });

  it('names nothing lost when the carry left nothing behind', () => {
    expect(loss({ moved: { cells: 4, objects: 2 }, dropped: none })).toBeNull();
    expect(loss({ moved: none, dropped: none })).toBeNull();
    expect(loss(null)).toBeNull();
  });

  it('says what was left behind beside what came along', () => {
    expect(loss({ moved: { cells: 4, objects: 2 }, dropped: { cells: 3, objects: 1 } }))
      .toEqual({ key: 'arrival.transferred_both', params: { cells: 3, objects: 1 } });
    expect(loss({ moved: { cells: 4, objects: 2 }, dropped: { cells: 3, objects: 0 } }))
      .toEqual({ key: 'arrival.transferred_ground', params: { cells: 3 } });
    expect(loss({ moved: { cells: 4, objects: 2 }, dropped: { cells: 0, objects: 1 } }))
      .toEqual({ key: 'arrival.transferred_pieces', params: { objects: 1 } });
  });

  it('says everything was lost when nothing came along', () => {
    expect(loss({ moved: none, dropped: { cells: 3, objects: 1 } })).toEqual({ key: 'arrival.transferred_lost' });
  });
});
