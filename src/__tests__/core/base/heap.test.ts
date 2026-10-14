import { describe, expect, it } from 'vitest';
import { IndexHeap } from '../../../core/base/heap';
import { makeRng } from '../../../core/base/rng';

describe('IndexHeap', () => {
  it('pops by priority, then by lowest index, whatever the push order', () => {
    const entries: Array<[number, number]> = [];
    const rng = makeRng(3);
    for (let i = 0; i < 200; i++) entries.push([rng.int(8), i]);
    const expected = [...entries].sort((a, b) => a[0] - b[0] || a[1] - b[1]).map(([, i]) => i);
    for (let trial = 0; trial < 5; trial++) {
      const order = [...entries];
      for (let k = order.length - 1; k > 0; k--) { const j = rng.int(k + 1); [order[k], order[j]] = [order[j]!, order[k]!]; }
      const heap = new IndexHeap();
      for (const [f, i] of order) heap.push(f, i);
      const popped: number[] = [];
      while (heap.size > 0) popped.push(heap.pop());
      expect(popped).toEqual(expected);
    }
  });

  it('keeps a repeated index as a separate entry', () => {
    const heap = new IndexHeap();
    heap.push(5, 1); heap.push(2, 1); heap.push(3, 0);
    expect([heap.pop(), heap.pop(), heap.pop()]).toEqual([1, 0, 1]);
    expect(heap.size).toBe(0);
  });
});
