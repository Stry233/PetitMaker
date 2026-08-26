import { describe, expect, it } from 'vitest';
import { createLog } from '../../../agent/core/log';
import { append } from '../../../agent/core/log';
import { deliverSteers, queueSteer, recallSteer, undeliveredSteers } from '../../../agent/core/steering';

describe('queueSteer / undeliveredSteers', () => {
  it('queue then list: queueSteer appends steer and returns its seq; undeliveredSteers lists it', () => {
    const log = createLog();
    const seq = queueSteer(log, 'go bigger');
    expect(undeliveredSteers(log)).toEqual([{ seq, text: 'go bigger' }]);
  });

  it('lists multiple queued steers in queue order', () => {
    const log = createLog();
    const a = queueSteer(log, 'first');
    const b = queueSteer(log, 'second');
    expect(undeliveredSteers(log)).toEqual([{ seq: a, text: 'first' }, { seq: b, text: 'second' }]);
  });
});

describe('recallSteer', () => {
  it('removes the steer from the undelivered list and returns true', () => {
    const log = createLog();
    const seq = queueSteer(log, 'go bigger');
    expect(recallSteer(log, seq)).toBe(true);
    expect(undeliveredSteers(log)).toEqual([]);
  });

  it('returns false and appends nothing when already delivered', () => {
    const log = createLog();
    const seq = queueSteer(log, 'go bigger');
    deliverSteers(log);
    const countBefore = log.events.length;
    expect(recallSteer(log, seq)).toBe(false);
    expect(log.events.length).toBe(countBefore);
  });

  it('returns false and appends nothing when already recalled', () => {
    const log = createLog();
    const seq = queueSteer(log, 'go bigger');
    expect(recallSteer(log, seq)).toBe(true);
    const countBefore = log.events.length;
    expect(recallSteer(log, seq)).toBe(false);
    expect(log.events.length).toBe(countBefore);
  });

  it('returns false and appends nothing for a seq that is not a steer event at all', () => {
    const log = createLog();
    // an `order` event's seq is a real seq in the log, but never a steer.
    const orderEv = append(log, { kind: 'order', text: 'build a town', mapContext: '{}' });
    const countBefore = log.events.length;
    expect(recallSteer(log, orderEv.seq)).toBe(false);
    expect(log.events.length).toBe(countBefore);
  });

  it('returns false and appends nothing for a seq with no matching event at all', () => {
    const log = createLog();
    const countBefore = log.events.length;
    expect(recallSteer(log, 9999)).toBe(false);
    expect(log.events.length).toBe(countBefore);
  });
});

describe('deliverSteers', () => {
  it('marks every pending steer in queue order and returns the count', () => {
    const log = createLog();
    const a = queueSteer(log, 'first');
    const b = queueSteer(log, 'second');
    expect(deliverSteers(log)).toBe(2);
    const delivered = log.events.filter((ev) => ev.kind === 'steerDelivered');
    expect(delivered.map((ev) => (ev as { steerSeq: number }).steerSeq)).toEqual([a, b]);
    expect(undeliveredSteers(log)).toEqual([]);
  });

  it('a second deliver is a no-op', () => {
    const log = createLog();
    queueSteer(log, 'first');
    deliverSteers(log);
    const countBefore = log.events.length;
    expect(deliverSteers(log)).toBe(0);
    expect(log.events.length).toBe(countBefore);
  });

  it('a steer queued after a deliver waits for the next one', () => {
    const log = createLog();
    queueSteer(log, 'first');
    deliverSteers(log);
    const later = queueSteer(log, 'second');
    expect(undeliveredSteers(log)).toEqual([{ seq: later, text: 'second' }]);
    expect(deliverSteers(log)).toBe(1);
    expect(undeliveredSteers(log)).toEqual([]);
  });

  it('does not redeliver a recalled steer', () => {
    const log = createLog();
    const seq = queueSteer(log, 'first');
    recallSteer(log, seq);
    expect(deliverSteers(log)).toBe(0);
  });
});
