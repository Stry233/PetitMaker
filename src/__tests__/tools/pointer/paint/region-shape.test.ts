/** A region figure with a minimum side keeps that side at the map's edges. */
import { describe, it, expect } from 'vitest';
import { regionShapeCells, type MapExtent } from '../../../../tools/pointer/paint/region-shape';
import type { MacroCoord } from '../../../../core/model/types';

/** The corners of the cells' bounding box. */
function bounds(cells: readonly MacroCoord[]): { anchor: MacroCoord; end: MacroCoord } {
  const xs = cells.map((c) => c.x), ys = cells.map((c) => c.y);
  return { anchor: { x: Math.min(...xs), y: Math.min(...ys) }, end: { x: Math.max(...xs), y: Math.max(...ys) } };
}
/** A box dragged from `anchor` to `end` with a floor already met: where the region brush lays it. */
const slideOnMap = (anchor: MacroCoord, end: MacroCoord, map: MapExtent) =>
  bounds(regionShapeCells('rect', end, 1, { anchor, constrain: false, minSide: 1, map }));
/** The centre a circle of `radius` drawn at `centre` on a `size`-wide map is laid around. */
const clampCentre = (centre: number, radius: number, size: number): number => {
  const map = { w: size, h: 4 * radius + 1 }, y = 2 * radius;
  const laid = bounds(regionShapeCells('circle', { x: centre + radius, y: y + radius }, 1, { anchor: { x: centre, y }, constrain: false, minSide: 1, map }));
  return (laid.anchor.x + laid.end.x) / 2;
};

/**
 * A minimum-size figure started at a margin still comes out the minimum size.
 *
 * The drag grows the figure in its own direction to reach the floor; at an edge that direction runs
 * off the map, the cells past it are dropped and the region arrives short of the very floor that
 * pushed it there — a drag that cannot satisfy its own minimum however far it is pulled. There is
 * only one direction left at an edge, so the whole figure slides that way instead.
 */
describe('a region with a floor, drawn at a margin', () => {
  const MAP = { w: 40, h: 30 };
  /** The box a slid pair spans, per axis, as [lo, hi] and its side lengths. */
  const box = (anchor: { x: number; y: number }, end: { x: number; y: number }) => ({
    x: [Math.min(anchor.x, end.x), Math.max(anchor.x, end.x)] as const,
    y: [Math.min(anchor.y, end.y), Math.max(anchor.y, end.y)] as const,
    w: Math.abs(end.x - anchor.x) + 1,
    h: Math.abs(end.y - anchor.y) + 1,
  });

  it('keeps the size the floor asked for at every margin', () => {
    // Each case is a drag whose grown end lies off one edge: the figure has to move, not shrink.
    const cases: [string, { x: number; y: number }, { x: number; y: number }][] = [
      ['left', { x: 2, y: 10 }, { x: -17, y: 29 }],
      ['right', { x: 37, y: 10 }, { x: 56, y: 29 }],
      ['top', { x: 10, y: 1 }, { x: 29, y: -18 }],
      ['bottom', { x: 10, y: 28 }, { x: 29, y: 47 }],
    ];
    for (const [edge, anchor, end] of cases) {
      const want = box(anchor, end);
      const slid = slideOnMap(anchor, end, MAP);
      const got = box(slid.anchor, slid.end);
      expect({ edge, w: got.w, h: got.h }).toEqual({ edge, w: want.w, h: want.h });
      expect(got.x[0], edge).toBeGreaterThanOrEqual(0);
      expect(got.y[0], edge).toBeGreaterThanOrEqual(0);
      expect(got.x[1], edge).toBeLessThanOrEqual(MAP.w - 1);
      expect(got.y[1], edge).toBeLessThanOrEqual(MAP.h - 1);
    }
  });

  it('does the same at a corner, where both directions are gone at once', () => {
    for (const [anchor, end] of [
      [{ x: 1, y: 1 }, { x: -18, y: -18 }],
      [{ x: 38, y: 28 }, { x: 57, y: 47 }],
      [{ x: 1, y: 28 }, { x: -18, y: 47 }],
      [{ x: 38, y: 1 }, { x: 57, y: -18 }],
    ] as const) {
      const slid = slideOnMap(anchor, end, MAP);
      const got = box(slid.anchor, slid.end);
      expect({ w: got.w, h: got.h }).toEqual({ w: 20, h: 20 });
      expect(got.x[0]).toBeGreaterThanOrEqual(0);
      expect(got.y[0]).toBeGreaterThanOrEqual(0);
      expect(got.x[1]).toBeLessThanOrEqual(MAP.w - 1);
      expect(got.y[1]).toBeLessThanOrEqual(MAP.h - 1);
    }
  });

  it('leaves a figure that already fits exactly where it was drawn', () => {
    const anchor = { x: 5, y: 5 }, end = { x: 24, y: 24 };
    expect(slideOnMap(anchor, end, MAP)).toEqual({ anchor, end });
    expect(slideOnMap(end, anchor, MAP)).toEqual({ anchor, end });
  });

  it('sits at the edge, clipped, where the figure is wider than the map itself', () => {
    // The one case the floor genuinely cannot be met: there is nowhere left to slide to.
    const slid = slideOnMap({ x: 10, y: 5 }, { x: 60, y: 10 }, MAP);
    expect(Math.min(slid.anchor.x, slid.end.x)).toBe(0);
  });

  it('moves a CENTRE in far enough that a radius fits either side of it', () => {
    expect(clampCentre(2, 10, 40)).toBe(10);
    expect(clampCentre(38, 10, 40)).toBe(29);
    expect(clampCentre(20, 10, 40)).toBe(20);
    // Wider than the map: centred, and the rim is clipped, since there is no answer that fits.
    expect(clampCentre(3, 30, 40)).toBe(19);
  });
});
