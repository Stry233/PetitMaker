import { describe, expect, it } from 'vitest';
import { retryDelayMs, MAX_TURN_RETRIES } from '../../../agent/core/retry';

describe('retryable + delay', () => {
  it('honors retryAfterMs exactly', () => {
    expect(retryDelayMs(1, { cls: 'rate-limit', detail: '', retryAfterMs: 9000 })).toBe(9000);
  });
  it('backs off exponentially with jitter inside [0.75, 1] of the base, capped at 30s', () => {
    const noJitter = () => 1;
    expect(retryDelayMs(1, { cls: 'overloaded', detail: '' }, noJitter)).toBe(2000);
    expect(retryDelayMs(2, { cls: 'overloaded', detail: '' }, noJitter)).toBe(4000);
    expect(retryDelayMs(6, { cls: 'overloaded', detail: '' }, noJitter)).toBe(30000);
    const floor = () => 0;
    expect(retryDelayMs(1, { cls: 'overloaded', detail: '' }, floor)).toBe(1500);
  });
  it('caps attempts', () => { expect(MAX_TURN_RETRIES).toBe(5); });
});
