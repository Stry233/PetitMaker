import { describe, it, expect } from 'vitest';
import { makeRng, shuffled, weightedIndex, type Rng } from '../../../core/base/rng';

/** An rng that replays `floats` in order; `int(n)` floors `float() * n` as the real one does. */
function scripted(floats: number[]): Rng {
  let k = 0;
  const float = (): number => floats[k++]!;
  return {
    float, int: (n) => Math.floor(float() * n), range: (a, b) => a + float() * (b - a), pick: (arr) => arr[Math.floor(float() * arr.length)]!,
    gaussian: () => 0,
  };
}

describe('makeRng (mulberry32)', () => {
  it('is deterministic for a seed', () => {
    const a = makeRng(42); const b = makeRng(42);
    const seqA = [a.float(), a.float(), a.int(10), a.range(2, 5)];
    const seqB = [b.float(), b.float(), b.int(10), b.range(2, 5)];
    expect(seqA).toEqual(seqB);
  });
  it('draws the mulberry32 stream the procedural pictures are seeded by', () => {
    const r = makeRng(12345);
    expect(Array.from({ length: 5 }, () => r.float())).toEqual(
      [0.9797282677609473, 0.3067522644996643, 0.484205421525985, 0.817934412509203, 0.5094283693470061],
    );
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

describe('shuffled', () => {
  it('swaps from the top index down with one int draw each, on a copy', () => {
    const src = ['a', 'b', 'c', 'd'];
    // i=3 draws int(4)=0, i=2 draws int(3)=2, i=1 draws int(2)=1.
    expect(shuffled(scripted([0, 0.9, 0.6]), src)).toEqual(['d', 'b', 'c', 'a']);
    expect(src).toEqual(['a', 'b', 'c', 'd']);
  });
  it('draws nothing for fewer than two items', () => {
    expect(shuffled(scripted([]), [7])).toEqual([7]);
  });
});

describe('weightedIndex', () => {
  it('returns the first index whose running weight reaches the roll', () => {
    expect(weightedIndex(scripted([0]), [1, 2, 3])).toBe(0);
    expect(weightedIndex(scripted([0.5]), [1, 2, 3])).toBe(1);
    expect(weightedIndex(scripted([0.5]), [1, 2, 0])).toBe(1);
    expect(weightedIndex(scripted([0.99]), [1, 2, 3])).toBe(2);
  });
  it('skips zero weights and falls back to the last index', () => {
    expect(weightedIndex(scripted([0.2]), [0, 1])).toBe(1);
    expect(weightedIndex(scripted([0.2]), [])).toBe(-1);
  });
});
