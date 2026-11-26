/** The assistant's repair policy as the panel reads it: one repair per failure class and whether an order may be sent under it. */
import { describe, it, expect } from 'vitest';
import {
  firstRepair, incidentNotice, noticeOffer, REPAIR_POLICY, repairPolicy, standingActions, troubleStanding,
  type ErrorClass, type JobView, type PanelView,
} from '../../../agent/panel';
import { isRetryable } from '../../../agent/core/errors';
import { ordersRefused } from '../../../agent/core/repair-policy';

const CLASSES = Object.keys(REPAIR_POLICY) as ErrorClass[];

describe('the repair policy', () => {
  it('offers every failure class its own repair first, then a way to put the job down or try another way', () => {
    for (const cls of CLASSES) {
      const { act, actions } = REPAIR_POLICY[cls];
      expect(actions[0], cls).toBe(act);
      expect(actions.length, cls).toBeGreaterThan(1);
    }
    expect(REPAIR_POLICY.auth.act).toBe('fix-key');
    expect(REPAIR_POLICY.quota.act).toBe('change-provider');
    expect(REPAIR_POLICY.model.act).toBe('edit-model');
    expect(REPAIR_POLICY.overflow.act).toBe('new-order');
  });

  it('refuses an order only while sending it would fail the same way', () => {
    const refusing = CLASSES.filter((cls) => REPAIR_POLICY[cls].refusesOrders).sort();
    expect(refusing).toEqual(['auth', 'cors', 'model', 'network', 'overloaded', 'quota', 'rate-limit']);
    // A shorter order is the repair of an overflow, so the composer stays open for it.
    expect(REPAIR_POLICY.overflow.refusesOrders).toBe(false);
  });

  it('reads a transient failure as retries run out, and offers the same order again', () => {
    for (const cls of CLASSES) {
      expect(REPAIR_POLICY[cls].exhausted, cls).toBe(isRetryable(cls));
      if (REPAIR_POLICY[cls].exhausted) expect(REPAIR_POLICY[cls].act, cls).toBe('try-again');
    }
  });

  it('answers a refused key by where the key came from', () => {
    expect(repairPolicy('auth')).toBe(REPAIR_POLICY.auth);
    expect(repairPolicy('auth', 'sign-in-expired')).toMatchObject({ act: 'sign-in', refusesOrders: true });
    // The new sign-in is in place, so the refused order may be sent again.
    expect(repairPolicy('auth', 'signed-in-again')).toMatchObject({ act: 'try-again', refusesOrders: false });
    // Only a refused key reads by its sign-in.
    expect(repairPolicy('quota', 'sign-in-expired')).toBe(REPAIR_POLICY.quota);
  });

  it('restores a key before any other repair while none is held', () => {
    for (const cls of CLASSES) expect(firstRepair(cls, { connected: false, refusal: 'key' }), cls).toBe('fix-key');
    expect(firstRepair('network', { connected: true, refusal: 'key' })).toBe('try-again');
    expect(firstRepair('auth', { connected: true, refusal: 'sign-in-expired' })).toBe('sign-in');
  });

  it('lets a job be set aside under every fault that refuses orders, so the next order has a way in', () => {
    const refusing = [...CLASSES.map((cls) => REPAIR_POLICY[cls]), repairPolicy('auth', 'sign-in-expired')].filter((row) => row.refusesOrders);
    for (const row of refusing) expect(row.actions, row.act).toContain('set-aside');
  });
});

describe('what a notice offers', () => {
  it('reads a refused sign-in under its own notice, and every other incident under its class', () => {
    expect(incidentNotice('auth', 'sign-in-expired')).toBe('sign-in-expired');
    expect(incidentNotice('auth', 'signed-in-again')).toBe('signed-in-again');
    expect(incidentNotice('auth', 'key')).toBe('auth');
    expect(incidentNotice('network', 'sign-in-expired')).toBe('network');
    expect(noticeOffer('sign-in-expired')).toMatchObject({ act: 'sign-in', actions: ['sign-in', 'set-aside'] });
    expect(noticeOffer('signed-in-again')).toMatchObject({ act: 'try-again' });
    expect(noticeOffer('quota')).toBe(REPAIR_POLICY.quota);
  });

  it('gives a cleared key and another map\'s records nothing to press, and storage trouble no repair', () => {
    for (const cls of ['key-cleared', 'key-clearing', 'other-map', 'unknown-map'] as const) expect(noticeOffer(cls).actions, cls).toEqual([]);
    expect(noticeOffer('storage-pruned')).toEqual({ actions: ['dismiss'] });
    expect(noticeOffer('storage-full')).toEqual({ actions: ['dismiss'] });
    expect(noticeOffer('storage-corrupt')).toEqual({ actions: ['dismiss', 'export-log'] });
  });

  it('keeps only the repairs of a notice put down, or its one answer where it has no other', () => {
    expect(standingActions(REPAIR_POLICY.auth.actions)).toEqual(['fix-key']);
    expect(standingActions(REPAIR_POLICY.unknown.actions)).toEqual(['try-again']);
    expect(standingActions(['dismiss'])).toEqual(['dismiss']);
    expect(standingActions([])).toEqual([]);
  });
});

describe('whether an order is taken', () => {
  const job = (over: Partial<JobView>): JobView => ({
    orderSeq: 1, orderText: 'build a village', orderAt: 1000, ops: [], asks: [], thought: undefined, checkpoints: [], skills: [], ...over,
  } as JobView);
  const incident = (cls: ErrorClass): PanelView => ({
    phase: 'incident', jobs: [job({ outcome: 'incident', errorCls: cls })], queuedSteers: [], lastEventAt: 0,
  } as unknown as PanelView);
  const idle = { phase: 'idle', jobs: [], queuedSteers: [], lastEventAt: 0 } as unknown as PanelView;
  const HELD = { connected: true };
  const NONE: ReadonlySet<number> = new Set();

  it('refuses one while the fault would fail it the same way, until the job is set aside', () => {
    expect(ordersRefused(idle, HELD, NONE)).toBe(false);
    expect(ordersRefused(incident('network'), HELD, NONE)).toBe(true);
    expect(ordersRefused(incident('quota'), HELD, NONE)).toBe(true);
    expect(ordersRefused(incident('overflow'), HELD, NONE)).toBe(false);
    expect(ordersRefused(incident('unknown'), HELD, NONE)).toBe(false);
    expect(ordersRefused(incident('network'), HELD, new Set([1]))).toBe(false);
  });

  it('reads a refused key by its sign-in: refused until a newer sign-in is in place', () => {
    expect(ordersRefused(incident('auth'), HELD, NONE)).toBe(true);
    expect(ordersRefused(incident('auth'), { connected: true, signedInAt: 500 }, NONE)).toBe(true);
    expect(ordersRefused(incident('auth'), { connected: true, signedInAt: 1500 }, NONE)).toBe(false);
  });

  it('refuses every order while no key is held', () => {
    expect(ordersRefused(idle, { connected: false }, NONE)).toBe(true);
    expect(ordersRefused(incident('auth'), { connected: false }, NONE)).toBe(true);
  });

  it('admits one under a notice the panel put down, and reads the notice it stands under', () => {
    const view = incident('auth');
    const standing = { owedJob: view.jobs[0]!, incident: { cls: 'auth' as const, seq: 1 }, keyCleared: false };
    expect(troubleStanding({ ...standing, standingTrouble: false }, { connected: true, signedInAt: 500 }))
      .toEqual({ keyRefusal: 'sign-in-expired', incidentCls: 'sign-in-expired', refusesOrders: true });
    expect(troubleStanding({ ...standing, standingTrouble: true }, HELD))
      .toEqual({ keyRefusal: 'key', incidentCls: 'auth', refusesOrders: false });
  });
});
