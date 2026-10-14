import { describe, it, expect } from 'vitest';
import { DEFAULT_LIMITS, ShareTooLargeError } from '../../../io/share/errors';

describe('ShareTooLargeError', () => {
  it('is an error named for the share code it could not hold', () => {
    const e = new ShareTooLargeError('Map payload exceeds the densest PetitGlyph profile.');
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe('ShareTooLargeError');
  });
});

describe('DEFAULT_LIMITS', () => {
  it('caps by decompressed canonical size and ratio, generous enough for a large map', () => {
    expect(DEFAULT_LIMITS.maxCanonicalBytes).toBeGreaterThanOrEqual(16 * 1024 * 1024);
    expect(DEFAULT_LIMITS.maxInflateRatio).toBeGreaterThan(0);
  });
});
