// src/__tests__/core/hash.test.ts
import { describe, it, expect } from 'vitest';
import { fnv1a, hashJSON } from '../../core/model/hash';

describe('hash', () => {
  it('is deterministic and stable for the same string', () => {
    expect(fnv1a('hello')).toBe(fnv1a('hello'));
    expect(fnv1a('hello')).toMatch(/^[0-9a-f]{8}$/);
  });
  it('differs for different strings', () => {
    expect(fnv1a('a')).not.toBe(fnv1a('b'));
  });
  it('hashJSON is key-order independent', () => {
    expect(hashJSON({ a: 1, b: 2 })).toBe(hashJSON({ b: 2, a: 1 }));
  });
});
