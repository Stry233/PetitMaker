import { describe, it, expect } from 'vitest';
import { concatBytes } from '../../../core/base/bytes';

describe('concatBytes', () => {
  it('joins chunks in order, with or without a counted total', () => {
    const parts = [Uint8Array.of(1, 2), new Uint8Array(0), Uint8Array.of(3)];
    expect([...concatBytes(parts)]).toEqual([1, 2, 3]);
    expect([...concatBytes(parts, 3)]).toEqual([1, 2, 3]);
    expect(concatBytes([]).length).toBe(0);
  });
});
