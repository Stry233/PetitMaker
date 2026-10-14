/**
 * Day headers follow the reader's calendar, where the day before a clock change is 23 or 25 hours.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dayOf } from '../../../../ui/agent/derive/days';

const savedTz = process.env.TZ;
beforeAll(() => { process.env.TZ = 'America/New_York'; });
afterAll(() => { if (savedTz === undefined) delete process.env.TZ; else process.env.TZ = savedTz; });

const local = (y: number, m: number, d: number, h: number, min = 0) => new Date(y, m - 1, d, h, min).getTime();

describe('dayOf across a clock change', () => {
  it('reads the 23-hour day before spring forward as yesterday, and nothing earlier', () => {
    const now = local(2026, 3, 9, 10);
    expect(dayOf(local(2026, 3, 8, 0, 30), now)).toBe('yesterday');
    expect(dayOf(local(2026, 3, 7, 23, 30), now)).toBe('earlier');
  });

  it('reads the whole 25-hour day before fall back as yesterday', () => {
    const now = local(2026, 11, 2, 10);
    expect(dayOf(local(2026, 11, 1, 0, 30), now)).toBe('yesterday');
    expect(dayOf(local(2026, 10, 31, 23, 30), now)).toBe('earlier');
    expect(dayOf(local(2026, 11, 2, 0, 30), now)).toBe('today');
  });
});
