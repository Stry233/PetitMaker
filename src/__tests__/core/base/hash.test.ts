import { describe, it, expect } from 'vitest';
import { FNV_BASIS, fnv1a, fnv1a32, fnv1aInts, fnv1aStep, hashJSON, hashJSON32 } from '../../../core/base/hash';

describe('hash', () => {
  it('is deterministic and stable for the same string', () => {
    expect(fnv1a('hello')).toBe(fnv1a('hello'));
    expect(fnv1a('hello')).toMatch(/^[0-9a-f]{8}$/);
  });
  it('differs for different strings', () => {
    expect(fnv1a('a')).not.toBe(fnv1a('b'));
  });
  it('fnv1a32 matches the published FNV-1a 32-bit vectors and fnv1a is its hex form', () => {
    expect(fnv1a32('')).toBe(0x811c9dc5);
    expect(fnv1a32('a')).toBe(0xe40c292c);
    expect(fnv1a32('foobar')).toBe(0xbf9cf968);
    expect(fnv1a('foobar')).toBe('bf9cf968');
  });
  it('fnv1a32 takes a replacement offset basis and stays unsigned', () => {
    expect(fnv1a32('', 0x1234)).toBe(0x1234);
    expect(fnv1a32('x', -1)).toBeGreaterThanOrEqual(0);
    expect(fnv1a32('abc', 7)).not.toBe(fnv1a32('abc'));
  });
  it('fnv1aInts folds bytes and integers as fnv1a32 folds code units', () => {
    expect(fnv1aInts(new TextEncoder().encode('foobar'))).toBe(0xbf9cf968);
    expect(fnv1aInts([])).toBe(FNV_BASIS);
    expect(fnv1aInts([1, 70000, -3])).toBe(fnv1aStep(fnv1aStep(fnv1aStep(FNV_BASIS, 1), 70000), -3));
    expect(fnv1aInts([-1])).toBeGreaterThanOrEqual(0);
  });
  it('hashJSON refuses a Set or a Map, which would hash as an empty object', () => {
    expect(() => hashJSON({ allow: new Set([1]) })).toThrow(TypeError);
    expect(() => hashJSON([new Map([[1, 2]])])).toThrow(TypeError);
  });

  it('hashJSON is key-order independent', () => {
    expect(hashJSON({ a: 1, b: 2 })).toBe(hashJSON({ b: 2, a: 1 }));
  });

  it('hashJSON32 is the unsigned integer hashJSON spells in hex', () => {
    const value = { zones: [[1, 2]], id: 'map' };
    expect(hashJSON32(value)).toBe(parseInt(hashJSON(value), 16));
  });
});
