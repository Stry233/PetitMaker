/**
 * The multi-anchor curve's path.
 *
 * It runs THROUGH its anchors rather than being pulled toward control points — that is the property
 * that makes a long curve aimable, because a click lands the path where it was clicked.
 */
import { describe, it, expect } from 'vitest';
import { anchorHandles, splineCells, splinePath } from '../../../tools/paint/shapes';
import type { MacroCoord } from '../../../core/model/types';

const at = (path: MacroCoord[], p: MacroCoord) => path.some((c) => c.x === p.x && c.y === p.y);
/** Every step shares an EDGE with the last — never a diagonal-only link. */
const fourConnected = (path: MacroCoord[]) =>
  path.every((c, i) => i === 0 || Math.abs(c.x - path[i - 1]!.x) + Math.abs(c.y - path[i - 1]!.y) === 1);

describe('splinePath', () => {
  it('passes through every anchor it was given', () => {
    const anchors = [{ x: 0, y: 0 }, { x: 4, y: 5 }, { x: 9, y: -3 }, { x: 14, y: 4 }, { x: 20, y: 0 }];
    const path = splinePath(anchors);
    for (const a of anchors) expect(at(path, a), `missing anchor ${a.x},${a.y}`).toBe(true);
  });

  it('is 4-connected, like every other painted spine', () => {
    // A diagonal-only link reads as a broken trail, and for water it breaks containment.
    expect(fourConnected(splinePath([{ x: 0, y: 0 }, { x: 6, y: 9 }, { x: 13, y: 1 }]))).toBe(true);
    expect(fourConnected(splinePath([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 20, y: 6 }]))).toBe(true);
  });

  it('bends between anchors rather than running straight through them', () => {
    // Three points in an arc: a polyline would put the midpoint of each leg on the chord.
    const path = splinePath([{ x: 0, y: 0 }, { x: 10, y: 6 }, { x: 20, y: 0 }]);
    const straight = splinePath([{ x: 0, y: 0 }, { x: 20, y: 0 }]);
    expect(path.length).toBeGreaterThan(straight.length);
  });

  it('does not loop back on itself when one anchor pair is much closer than the next', () => {
    // The reason for centripetal knot spacing: uniform spacing overshoots here and paints a cusp.
    const path = splinePath([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 30, y: 2 }]);
    const xs = path.map((c) => c.x);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(-1);
    expect(Math.max(...xs)).toBeLessThanOrEqual(31);
  });

  it('degrades sanely: one anchor is a point, two are a straight line', () => {
    expect(splinePath([{ x: 3, y: 3 }])).toEqual([{ x: 3, y: 3 }]);
    const two = splinePath([{ x: 0, y: 0 }, { x: 5, y: 0 }]);
    expect(two).toHaveLength(6);
    expect(fourConnected(two)).toBe(true);
  });

  it('survives a repeated anchor rather than dividing by zero', () => {
    const path = splinePath([{ x: 3, y: 3 }, { x: 3, y: 3 }, { x: 10, y: 8 }]);
    expect(path.length).toBeGreaterThan(0);
    expect(path.every((c) => Number.isFinite(c.x) && Number.isFinite(c.y))).toBe(true);
  });

  it('follows a HANDLE where one is set, and only at that anchor', () => {
    // A direction line the user dragged replaces that anchor's tangent; its neighbours keep theirs,
    // so one adjustment stays local instead of reshaping the whole path.
    const plain = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }];
    const bent = [{ x: 0, y: 0 }, { x: 10, y: 0, hx: 0, hy: 6 }, { x: 20, y: 0 }];
    const a = splinePath(plain), b = splinePath(bent);
    expect(b).not.toEqual(a);
    for (const anchor of plain) expect(at(b, anchor), 'still through every anchor').toBe(true);
    expect(fourConnected(b)).toBe(true);
    // The bend is real: the handle pulls the path off the straight line.
    expect(b.some((c) => Math.abs(c.y) > 1)).toBe(true);
  });

  it('lets one anchor be a CORNER, with its two sides set apart', () => {
    // The default is one straight tangent through the anchor. An anchor whose incoming side is set
    // independently bends there instead, and the bend is local to it.
    const smooth = [{ x: 0, y: 0 }, { x: 10, y: 0, hx: 3, hy: -3 }, { x: 20, y: 0 }];
    const broken = [{ x: 0, y: 0 }, { x: 10, y: 0, hx: 3, hy: -3, ihx: -3, ihy: -3 }, { x: 20, y: 0 }];
    const a = splinePath(smooth), b = splinePath(broken);
    expect(b).not.toEqual(a);
    for (const anchor of broken) expect(at(b, anchor), 'still through every anchor').toBe(true);
    expect(fourConnected(b)).toBe(true);
    // Both sides now leave the corner the same way (up), where the smooth one arrived from below.
    const before = a.filter((c) => c.x < 10);
    const brokenBefore = b.filter((c) => c.x < 10);
    expect(Math.min(...before.map((c) => c.y))).toBeGreaterThanOrEqual(0);
    expect(Math.min(...brokenBefore.map((c) => c.y))).toBeLessThan(0);
  });
});

describe('anchorHandles', () => {
  it('mirrors the incoming side of a handle that was never broken', () => {
    const h = anchorHandles([{ x: 0, y: 0 }, { x: 10, y: 4 }, { x: 20, y: 0 }]);
    for (const t of h) {
      expect(t.ihx).toBeCloseTo(-t.hx, 6);
      expect(t.ihy).toBeCloseTo(-t.hy, 6);
    }
  });

  it('reports a broken side as it was set', () => {
    const h = anchorHandles([{ x: 0, y: 0 }, { x: 10, y: 0, hx: 2, hy: 0, ihx: 0, ihy: 5 }, { x: 20, y: 0 }]);
    expect(h[1]).toMatchObject({ hx: 2, hy: 0, ihx: 0, ihy: 5 });
  });
});

describe('splineCells', () => {
  it('widens the path with the brush, and a wider brush covers more', () => {
    const anchors = [{ x: 2, y: 2 }, { x: 8, y: 7 }, { x: 15, y: 3 }];
    const thin = splineCells(anchors, 1);
    const thick = splineCells(anchors, 3);
    expect(thick.length).toBeGreaterThan(thin.length);
    for (const a of anchors) expect(at(thin, a)).toBe(true);
  });

  it('emits no duplicate cells, so a stroke never paints one twice', () => {
    const cells = splineCells([{ x: 0, y: 0 }, { x: 6, y: 4 }, { x: 12, y: 0 }], 2);
    expect(new Set(cells.map((c) => `${c.x},${c.y}`)).size).toBe(cells.length);
  });
});
