/**
 * The region-selection channel is a channel, not a global: the screen that arms it registers what
 * to do with a painted cell and with the two whole-region edits, and the pointer machine reports
 * cells without knowing who is listening.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  clampCentre, clearRegionSelection, finishRegionStroke, paintRegionCell,
  setRegionBrushHandler, slideOnMap, type RegionBrushHandler,
} from '../../core/runtime/region-brush';

const handler = (): RegionBrushHandler => ({
  paint: vi.fn(), done: vi.fn(), clear: vi.fn(),
});

describe('region selection channel', () => {
  it('painting with nothing registered is a no-op', () => {
    expect(() => paintRegionCell({ x: 1, y: 1 })).not.toThrow();
    expect(() => clearRegionSelection()).not.toThrow();
  });

  it('delivers painted cells to the registered handler', () => {
    const h = handler();
    const off = setRegionBrushHandler(h);
    paintRegionCell({ x: 3, y: 4 });
    finishRegionStroke();
    expect(h.paint).toHaveBeenCalledWith({ x: 3, y: 4 });
    expect(h.done).toHaveBeenCalled();
    off();
  });

  /** The whole-region edit goes the same way, and it has to: the collector owns the buffer AND
   *  its own undo stack, so a screen that wrote the store directly would leave both behind. */
  it('delivers the whole-region clear to the same handler', () => {
    const h = handler();
    const off = setRegionBrushHandler(h);
    clearRegionSelection();
    expect(h.clear).toHaveBeenCalled();
    off();
  });

  it('a stale unregister cannot revoke a newer handler', () => {
    const offFirst = setRegionBrushHandler(handler());
    const second = handler();
    setRegionBrushHandler(second);
    offFirst();
    paintRegionCell({ x: 0, y: 0 });
    expect(second.paint).toHaveBeenCalled();
  });
});

/**
 * A MINIMUM-SIZE FIGURE STARTED AT A MARGIN STILL COMES OUT THE MINIMUM SIZE.
 *
 * The drag grows the figure in its own direction to reach the floor; at an edge that direction runs
 * off the map, the cells past it are dropped and the region arrives SHORT of the very floor that
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
