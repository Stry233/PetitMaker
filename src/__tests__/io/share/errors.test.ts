import { describe, it, expect } from 'vitest';
import { ShareError, DEFAULT_LIMITS } from '../../../io/share/errors';

describe('ShareError', () => {
  it('carries a code and message', () => {
    const e = new ShareError('future-version', 'Saved by a newer version.');
    expect(e).toBeInstanceOf(Error);
    expect(e.code).toBe('future-version');
    expect(e.name).toBe('ShareError');
  });
});

describe('DEFAULT_LIMITS', () => {
  it('caps by decompressed canonical size and ratio, generous enough for a large map', () => {
    expect(DEFAULT_LIMITS.maxCanonicalBytes).toBeGreaterThanOrEqual(16 * 1024 * 1024);
    expect(DEFAULT_LIMITS.maxInflateRatio).toBeGreaterThan(0);
  });
});
