import { describe, it, expect } from 'vitest';
import { cellKey, fitAspect, inflateRect, parseCellKey, rectsOverlap, regionBounds, uniqueCells, type Rect } from '../../../core/grid/rect';
import type { MacroCoord } from '../../../core/model/types';

describe('inflateRect', () => {
  it('grows a rect by the pad on every side', () => {
    expect(inflateRect({ x: 4, y: 5, w: 2, h: 3 }, 1)).toEqual({ x: 3, y: 4, w: 4, h: 5 });
  });
  it('shrinks it for a negative pad', () => {
    expect(inflateRect({ x: 4, y: 5, w: 4, h: 4 }, -1)).toEqual({ x: 5, y: 6, w: 2, h: 2 });
  });
  it('turns edge contact into overlap at pad 1', () => {
    const a = { x: 0, y: 0, w: 2, h: 2 }, b = { x: 2, y: 0, w: 2, h: 2 };
    expect(rectsOverlap(a, b)).toBe(false);
    expect(rectsOverlap(inflateRect(a, 1), b)).toBe(true);
  });
});

describe('fitAspect (letterbox, never stretch)', () => {
  const rect: Rect = { x: 10, y: 20, w: 200, h: 100 };
  it('wider source → fit to width, centered vertically (pillar/letterbox top+bottom)', () => {
    const f = fitAspect(rect, 4);
    expect(f.w).toBe(rect.w);
    expect(f.h).toBeLessThan(rect.h);
    expect(f.x).toBe(rect.x);
    expect(f.y).toBeGreaterThan(rect.y);
    expect(f.w / f.h).toBeCloseTo(4, 5);
  });
  it('taller source → fit to height, centered horizontally', () => {
    const f = fitAspect(rect, 1);
    expect(f.h).toBe(rect.h);
    expect(f.w).toBeLessThan(rect.w);
    expect(f.y).toBe(rect.y);
    expect(f.x).toBeGreaterThan(rect.x);
    expect(f.w / f.h).toBeCloseTo(1, 5);
  });
  it('matching aspect → fills the rect exactly', () => {
    const f = fitAspect(rect, 2);
    expect(f).toEqual(rect);
  });
});

/** The three shapes a painted region comes in: a filled rect, a scatter of loose cells, and the
 *  single cell a stray tap leaves. */
const FIXTURES: { name: string; cells: MacroCoord[]; expect: ReturnType<typeof regionBounds> }[] = [
  {
    name: 'a filled 3x2 rect',
    cells: [
      { x: 4, y: 7 }, { x: 5, y: 7 }, { x: 6, y: 7 },
      { x: 4, y: 8 }, { x: 5, y: 8 }, { x: 6, y: 8 },
    ],
    expect: { count: 6, x1: 4, y1: 7, x2: 6, y2: 8 },
  },
  {
    name: 'a scatter whose extremes are on different cells',
    cells: [{ x: 5, y: 9 }, { x: 2, y: 3 }, { x: 8, y: 1 }, { x: 12, y: 4 }],
    expect: { count: 4, x1: 2, y1: 1, x2: 12, y2: 9 },
  },
  {
    name: 'one cell',
    cells: [{ x: 31, y: 17 }],
    expect: { count: 1, x1: 31, y1: 17, x2: 31, y2: 17 },
  },
];

describe('regionBounds', () => {
  it('answers null for an empty region: [] is the whole map, not a box of no cells', () => {
    expect(regionBounds([])).toBeNull();
  });

  for (const f of FIXTURES) {
    it(`reads ${f.name}`, () => {
      expect(regionBounds(f.cells)).toEqual(f.expect);
    });
  }
});

describe('cell keys', () => {
  it('parse back to the cell they name, negative coordinates included', () => {
    for (const c of [{ x: 0, y: 0 }, { x: 12, y: 7 }, { x: -1, y: 40 }]) expect(parseCellKey(cellKey(c.x, c.y))).toEqual(c);
  });

  it('keep each cell once, at its first place', () => {
    expect(uniqueCells([{ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 1, y: 1 }, { x: 0, y: 3 }])).toEqual([{ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 0, y: 3 }]);
  });
});
