import { describe, it, expect } from 'vitest';
import { makeRng } from '../../../core/model/rng';

describe('makeRng (mulberry32)', () => {
  it('is deterministic for a seed', () => {
    const a = makeRng(42); const b = makeRng(42);
    const seqA = [a.float(), a.float(), a.int(10), a.range(2, 5)];
    const seqB = [b.float(), b.float(), b.int(10), b.range(2, 5)];
    expect(seqA).toEqual(seqB);
  });
  it('differs across seeds and stays in range', () => {
    const a = makeRng(1); const b = makeRng(2);
    expect(a.float()).not.toBe(b.float());
    for (let i = 0; i < 100; i++) { const v = a.int(7); expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThan(7); }
  });
  it('pick returns an element deterministically', () => {
    const r = makeRng(5); const arr = ['a', 'b', 'c', 'd'];
    expect(makeRng(5).pick(arr)).toBe(r.pick(arr));
    expect(arr).toContain(r.pick(arr));
  });
});
