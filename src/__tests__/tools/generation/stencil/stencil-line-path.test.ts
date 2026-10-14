import { describe, expect, it } from 'vitest';
import { simplifyLinePaths, routeLineExtrema, walkLinePath, type LinePath, type LinePoint } from '../../../../tools/generation/stencil/stencil-line-path';

const pointsOf = (paths: readonly LinePath[]): LinePoint[] => {
  const points: LinePoint[] = [];
  for (const path of paths) walkLinePath(path, point => points.push(point));
  return points;
};

describe('diagonal stroke simplification', () => {
  it('preserves alternating peaks and valleys under a broad glyph-wide tolerance', () => {
    const source: LinePath = [[0, 0], [6, 24], [12, 10], [18, 24], [24, 0]];
    const paths = simplifyLinePaths([source], 4, () => true);
    const points = pointsOf(paths);
    for (const anchor of source) expect(points).toContainEqual(anchor);
    for (let leg = 0; leg < paths.length; leg++) for (const [x, y] of pointsOf([paths[leg]!])) {
      const a = source[leg]!, b = source[leg + 1]!;
      const referenceX = a[0] + (y - a[1]) * (b[0] - a[0]) / (b[1] - a[1]);
      expect(Math.abs(x - referenceX)).toBeLessThanOrEqual(2.5);
    }
  });

  it('keeps narrow legs diagonal even when the glyph is tall', () => {
    const paths = simplifyLinePaths([[[0, 0], [4, 28]]], 5, () => true);
    for (const [x, y] of pointsOf(paths)) expect(Math.abs(x - y / 7)).toBeLessThanOrEqual(2);
    expect(paths.flat().length).toBeLessThanOrEqual(8);
  });

  it('balances the terminal runs of a diagonal staircase', () => {
    const paths = simplifyLinePaths([[[0, 0], [8, 24]]], 2, () => true);
    const points = pointsOf(paths);
    const keys = new Set(points.map(([x, y]) => `${x},${y}`));
    for (const [x, y] of points) expect(keys.has(`${8 - x},${24 - y}`)).toBe(true);
  });

  it('joins diagonal valleys across their tip without overlapping a terminal stem', () => {
    for (const source of [
      [[0, 0], [3, 6], [6, 0]], [[0, 6], [3, 0], [6, 6]],
      [[0, 0], [6, 3], [0, 6]], [[6, 0], [0, 3], [6, 6]],
    ] as const) {
      const points = pointsOf([routeLineExtrema(source)]);
      expect(new Set(points.map(p => p.join())).size).toBe(points.length);
      expect(points).toContainEqual(source[1]);
      expect(points[0]).toEqual(source[0]);
      expect(points[points.length - 1]).toEqual(source[2]);
    }
  });

  it('preserves isolated dots and rejects shortcuts that would violate the caller topology', () => {
    expect(simplifyLinePaths([[[2, 3]]], 4, () => true)).toEqual([[[2, 3]]]);
    const source: LinePath[] = [[[0, 0], [5, 10]]];
    expect(pointsOf(simplifyLinePaths(source, 4, () => false))).toEqual(pointsOf(source));
  });
});
