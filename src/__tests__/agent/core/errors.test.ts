import { describe, expect, it } from 'vitest';
import { classify, isRetryable } from '../../../agent/core/errors';

describe('classify', () => {
  it('maps statuses to classes', () => {
    expect(classify({ status: 401, message: 'unauthorized' }).cls).toBe('auth');
    expect(classify({ status: 403, message: 'billing hard limit reached' }).cls).toBe('quota');
    expect(classify({ status: 429, message: 'rate limited', retryAfterMs: 7000 })).toMatchObject({ cls: 'rate-limit', retryAfterMs: 7000 });
    expect(classify({ status: 529, message: 'overloaded' }).cls).toBe('overloaded');
    expect(classify({ status: 500, message: 'internal' }).cls).toBe('overloaded');
  });
  it('classifies by message when there is no status', () => {
    expect(classify({ message: 'Failed to fetch' }).cls).toBe('network');
    expect(classify({ message: 'context length exceeded: 210000 tokens > 200000' }).cls).toBe('overflow');
    expect(classify({ message: 'insufficient_quota' }).cls).toBe('quota');
  });
  it('Anthropic\'s max_tokens-vs-context wording reads as overflow, so the ladder compacts instead of an unknown incident', () => {
    expect(classify({ message: 'input length and max_tokens exceed context limit' }).cls).toBe('overflow');
  });
  it('abort wins over everything', () => {
    expect(classify({ status: 429, message: 'x', aborted: true }).cls).toBe('abort');
  });
  it('a custom-endpoint opaque failure reads as cors only with no status and a TypeError-shaped message', () => {
    expect(classify({ message: 'NetworkError when attempting to fetch resource.' }).cls).toBe('network');
  });
  it('a plain 403 with no billing words reads as auth, not quota', () => {
    expect(classify({ status: 403, message: 'forbidden' }).cls).toBe('auth');
  });
  it('a timed-out connection is a network fault: the SDK carries no status for one', () => {
    // `APIConnectionTimeoutError` (both SDKs) rejects with this wording and no status at all, so a
    // status-only ladder drops it into the unretryable `unknown` and a transient stall ends the job.
    expect(classify({ message: 'Request timed out.' }).cls).toBe('network');
    expect(classify({ message: 'The operation timed out' }).cls).toBe('network');
    expect(classify({ message: 'upstream timeout' }).cls).toBe('network');
    expect(isRetryable(classify({ message: 'Request timed out.' }).cls)).toBe(true);
  });
});

describe('retryable + delay', () => {
  it('never retries auth, quota, overflow, cors, abort', () => {
    for (const cls of ['auth', 'quota', 'overflow', 'cors', 'abort'] as const) expect(isRetryable(cls)).toBe(false);
  });
});
