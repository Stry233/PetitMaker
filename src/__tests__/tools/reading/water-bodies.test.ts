import { describe, expect, it } from 'vitest';
import type { MapMasks, WaterBody } from '../../../tools/reading';
import { bodiesTouch } from '../../_support/design-eval/water-shapes';

const W = 6;
const body = (cells: number[]): WaterBody => {
  const xs = cells.map((i) => i % W), ys = cells.map((i) => (i / W) | 0);
  return {
    cells, x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys),
    tiers: new Set([0]), holes: 0, faced: false, fill: 1,
  };
};
const masks = { W, H: 4 } as MapMasks;

describe('bodiesTouch', () => {
  it('reads bodies within a cell of each other as touching', () => {
    expect(bodiesTouch(masks, body([2 * W + 1]), body([2 * W + 3]))).toBe(false);
    expect(bodiesTouch(masks, body([2 * W + 1]), body([3 * W + 2]))).toBe(true);
  });

  it('does not wrap from the last column of one row to the first column of the next', () => {
    // (5,1) and (0,2) are flat indices 11 and 12, adjacent in memory but a map width apart; the run
    // (0,2)..(3,2) stops two columns short of (5,1).
    expect(bodiesTouch(masks, body([W + 5]), body([2 * W, 2 * W + 1, 2 * W + 2, 2 * W + 3]))).toBe(false);
  });
});
