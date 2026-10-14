// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { planTiles } from '../../../io/export/tile-plan';

const WEBKIT = { maxDim: 4096, maxArea: 4096 * 4096 };

describe('planning tiles', () => {
  it('caps a band at the rows it is given, whatever the area leaves', () => {
    const plan = planTiles(4000, 900, { maxDim: 16384, maxArea: 16384 * 16384 }, 256);
    expect(plan.rows.map((r) => r.h)).toEqual([256, 256, 256, 132]);
  });

  it('cuts columns at the longest side allowed and bands at the area the columns leave', () => {
    const plan = planTiles(10848, 9838, WEBKIT);
    expect(plan.cols.map((c) => c.w)).toEqual([4096, 4096, 2656]);
    expect(plan.cols.map((c) => c.x)).toEqual([0, 4096, 8192]);
    // The area would allow 4096 rows; the band's read-back memory caps it well below that.
    expect(plan.rows[0]!.h).toBeLessThan(4096);
    expect(plan.rows.reduce((n, r) => n + r.h, 0)).toBe(9838);
    expect(plan.rows.every((r, i) => i === 0 || r.y === plan.rows[i - 1]!.y + plan.rows[i - 1]!.h)).toBe(true);
  });

  it('keeps one column where the width fits, and shortens bands to the area', () => {
    const plan = planTiles(3000, 5000, { maxDim: 16384, maxArea: 3000 * 300 });
    expect(plan.cols).toEqual([{ x: 0, w: 3000 }]);
    expect(plan.rows[0]!.h).toBe(300);
    expect(plan.rows.length).toBe(Math.ceil(5000 / 300));
  });
});

describe('planning tiles at the edges', () => {
  it('never plans an empty tile', () => {
    for (const [w, h, limits] of [
      [600, 240, { maxDim: 300, maxArea: 300 * 120 }],
      [1, 1, { maxDim: 0.5, maxArea: 0.1 }],
      [5000, 3, { maxDim: 4096, maxArea: 4096 * 4096 }],
    ] as const) {
      const plan = planTiles(w, h, limits);
      expect(plan.cols.every((c) => c.w > 0)).toBe(true);
      expect(plan.rows.every((r) => r.h > 0)).toBe(true);
      expect(plan.cols.reduce((n, c) => n + c.w, 0)).toBe(w);
      expect(plan.rows.reduce((n, r) => n + r.h, 0)).toBe(h);
    }
  });
});
