import { describe, expect, it } from 'vitest';
import { MaxFlow } from '../../../core/base/max-flow';

describe('MaxFlow', () => {
  it('finds the maximum flow and the minimum cut of a small network', () => {
    // s->a 16, s->b 13, a->c 12, b->a 4, c->b 9, b->d 14, d->c 7, c->t 20, d->t 4: value 23, cut {s, a, b, d}.
    const g = new MaxFlow(4, 5);
    g.terminal(0, 16, 0);
    g.terminal(1, 13, 0);
    g.edge(0, 2, 12, 0);
    g.edge(1, 0, 4, 0);
    g.edge(2, 1, 9, 0);
    g.edge(1, 3, 14, 0);
    g.edge(3, 2, 7, 0);
    g.terminal(2, 0, 20);
    g.terminal(3, 0, 4);
    expect(g.solve()).toBeCloseTo(23, 9);
    expect([0, 1, 2, 3].map((v) => g.sourceSide(v))).toEqual([true, true, false, true]);
  });

  it('finds the same cut when every capacity is a trillion times smaller', () => {
    const k = 1e-12;
    const g = new MaxFlow(4, 5);
    g.terminal(0, 16 * k, 0);
    g.terminal(1, 13 * k, 0);
    g.edge(0, 2, 12 * k, 0);
    g.edge(1, 0, 4 * k, 0);
    g.edge(2, 1, 9 * k, 0);
    g.edge(1, 3, 14 * k, 0);
    g.edge(3, 2, 7 * k, 0);
    g.terminal(2, 0, 20 * k);
    g.terminal(3, 0, 4 * k);
    expect(g.solve() / k).toBeCloseTo(23, 6);
    expect([0, 1, 2, 3].map((v) => g.sourceSide(v))).toEqual([true, true, false, true]);
  });

  it('keeps a node on the side whose terminal is dearer to cut', () => {
    const g = new MaxFlow(2, 0);
    g.terminal(0, 5, 2);
    g.terminal(1, 1, 3);
    g.solve();
    expect(g.sourceSide(0)).toBe(true);
    expect(g.sourceSide(1)).toBe(false);
  });

  it('pushes flow along a path as long as the graph', () => {
    const n = 200_000;
    const g = new MaxFlow(n, n - 1);
    g.terminal(0, 1, 0);
    for (let i = 0; i + 1 < n; i++) g.edge(i, i + 1, 1, 0);
    g.terminal(n - 1, 0, 1);
    expect(g.solve()).toBe(1);
  });
});
