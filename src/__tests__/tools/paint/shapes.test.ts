import { describe, it, expect } from 'vitest';
import { rectCells, circleCells, lineCells, curveCells, bresenham, line4, snapShapeEnd } from '../../../tools/paint/shapes';

/** Every cell reachable from the first via edge-adjacent steps (a width-1
 *  spine must form ONE 4-connected trail — no diagonal-only links). */
function isFourConnected(cells: { x: number; y: number }[]): boolean {
  if (cells.length <= 1) return true;
  const set = new Set(cells.map((c) => `${c.x},${c.y}`));
  const seen = new Set<string>([`${cells[0]!.x},${cells[0]!.y}`]);
  const stack = [cells[0]!];
  while (stack.length) {
    const c = stack.pop()!;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const k = `${c.x + dx},${c.y + dy}`;
      if (set.has(k) && !seen.has(k)) { seen.add(k); stack.push({ x: c.x + dx, y: c.y + dy }); }
    }
  }
  return seen.size === set.size;
}

describe('shapes', () => {
  describe('rectCells', () => {
    it('fills a 3x2 rectangle', () => {
      const cells = rectCells({ x: 2, y: 3 }, { x: 4, y: 4 });
      expect(cells).toHaveLength(6);
      expect(cells).toContainEqual({ x: 2, y: 3 });
      expect(cells).toContainEqual({ x: 4, y: 4 });
    });
    it('works with inverted corners', () => {
      expect(rectCells({ x: 4, y: 4 }, { x: 2, y: 3 })).toHaveLength(6);
    });
    it('handles single cell', () => {
      expect(rectCells({ x: 5, y: 5 }, { x: 5, y: 5 })).toHaveLength(1);
    });
  });

  describe('circleCells', () => {
    it('fills a circle with radius 2', () => {
      const cells = circleCells({ x: 5, y: 5 }, 2, 2);
      expect(cells.length).toBeGreaterThan(0);
      expect(cells).toContainEqual({ x: 5, y: 5 });
      expect(cells.every(c => Math.hypot(c.x - 5, c.y - 5) <= 2.6)).toBe(true);
    });
    it('handles ellipse', () => {
      const cells = circleCells({ x: 5, y: 5 }, 3, 1);
      const xs = cells.map(c => c.x);
      const ys = cells.map(c => c.y);
      expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(Math.max(...ys) - Math.min(...ys));
    });
    it('radius 0 returns single cell', () => {
      expect(circleCells({ x: 5, y: 5 }, 0, 0)).toHaveLength(1);
    });
    it('has no 1-cell cardinal tip — extreme rows/cols stay flat so auto-trim rounds them smoothly', () => {
      // A 1-cell cardinal extreme gets rounded by auto-trim into a sharp point on all 4 sides,
      // so every cardinal band must be wider than 1.
      for (const r of [2, 3, 4, 5, 6]) {
        const cells = circleCells({ x: 0, y: 0 }, r, r);
        const xs = cells.map((c) => c.x), ys = cells.map((c) => c.y);
        const widthAt = (yy: number) => cells.filter((c) => c.y === yy).length;
        const heightAt = (xx: number) => cells.filter((c) => c.x === xx).length;
        expect(widthAt(Math.min(...ys)), `top row flat (r=${r})`).toBeGreaterThan(1);   // N
        expect(widthAt(Math.max(...ys)), `bottom row flat (r=${r})`).toBeGreaterThan(1); // S
        expect(heightAt(Math.min(...xs)), `left col flat (r=${r})`).toBeGreaterThan(1);  // W
        expect(heightAt(Math.max(...xs)), `right col flat (r=${r})`).toBeGreaterThan(1); // E
        // ...without growing the disc: the extent still matches the requested radius.
        expect(Math.max(...xs)).toBe(r);
        expect(Math.max(...ys)).toBe(r);
      }
    });
  });

  describe('lineCells', () => {
    it('draws a horizontal line', () => {
      expect(lineCells({ x: 0, y: 0 }, { x: 4, y: 0 }, 1)).toHaveLength(5);
    });
    it('expands with brush width 3', () => {
      const cells = lineCells({ x: 0, y: 5 }, { x: 4, y: 5 }, 3);
      expect(cells.length).toBeGreaterThan(5);
      expect(cells).toContainEqual({ x: 2, y: 4 });
      expect(cells).toContainEqual({ x: 2, y: 6 });
    });
    it('a diagonal line is 4-connected — no diagonal-only links (matches the free brush)', () => {
      const cells = lineCells({ x: 0, y: 0 }, { x: 5, y: 5 }, 1);
      expect(isFourConnected(cells)).toBe(true);
      // line4 staircase, not bresenham's 6-cell diagonal
      expect(cells.length).toBe(11);
    });
  });

  describe('curveCells', () => {
    it('generates cells along a quadratic bezier', () => {
      const cells = curveCells({ x: 0, y: 0 }, { x: 5, y: 10 }, { x: 10, y: 0 }, 1);
      expect(cells.length).toBeGreaterThan(5);
      expect(cells).toContainEqual({ x: 0, y: 0 });
      expect(cells).toContainEqual({ x: 10, y: 0 });
    });
    it('the width-1 curve spine is 4-connected — no diagonal gaps on a steep bend', () => {
      const cells = curveCells({ x: 0, y: 0 }, { x: 10, y: 12 }, { x: 2, y: 20 }, 1);
      expect(isFourConnected(cells)).toBe(true);
    });
  });

  describe('bresenham', () => {
    it('draws a diagonal line', () => {
      const points = bresenham(0, 0, 3, 3);
      expect(points).toHaveLength(4);
      expect(points[0]).toEqual({ x: 0, y: 0 });
      expect(points[3]).toEqual({ x: 3, y: 3 });
    });
  });

  describe('line4 (4-connected freehand interpolation)', () => {
    const adjacent = (a: { x: number; y: number }, b: { x: number; y: number }) =>
      Math.abs(a.x - b.x) + Math.abs(a.y - b.y) === 1; // shares an EDGE (Manhattan 1), never a diagonal

    it('every consecutive pair shares an edge — no diagonal-only links (the brush-break fix)', () => {
      for (const [x0, y0, x1, y1] of [[0, 0, 5, 3], [0, 0, 3, 5], [2, 7, 9, 1], [4, 4, 4, 4]] as const) {
        const pts = line4(x0, y0, x1, y1);
        expect(pts[0]).toEqual({ x: x0, y: y0 });
        expect(pts[pts.length - 1]).toEqual({ x: x1, y: y1 });
        for (let i = 1; i < pts.length; i++) expect(adjacent(pts[i - 1]!, pts[i]!)).toBe(true);
      }
    });

    it('contrasts with bresenham: a steep diagonal stays connected where bresenham would jump diagonally', () => {
      const b = bresenham(0, 0, 2, 2);   // [(0,0),(1,1),(2,2)] — diagonal corners only
      expect(b.some((p, i) => i > 0 && Math.abs(p.x - b[i - 1]!.x) + Math.abs(p.y - b[i - 1]!.y) === 2)).toBe(true);
      const l = line4(0, 0, 2, 2);       // inserts the orthogonal cells between
      expect(l.length).toBe(5); // |dx|+|dy|+1
      for (let i = 1; i < l.length; i++) expect(adjacent(l[i - 1]!, l[i]!)).toBe(true);
    });
  });
});

describe('snapShapeEnd (Shift constraint)', () => {
  const O = { x: 10, y: 10 };
  it('line snaps to horizontal / vertical / 45 diagonal', () => {
    expect(snapShapeEnd(O, { x: 20, y: 12 }, 'line')).toEqual({ x: 20, y: 10 }); // near-horizontal -> horizontal
    expect(snapShapeEnd(O, { x: 12, y: 2 }, 'line')).toEqual({ x: 10, y: 2 });   // near-vertical -> vertical
    expect(snapShapeEnd(O, { x: 17, y: 3 }, 'line')).toEqual({ x: 17, y: 3 });   // ~45 up-right -> equal legs (d=7)
    expect(snapShapeEnd(O, { x: 4, y: 17 }, 'line')).toEqual({ x: 3, y: 17 });   // ~45 down-left
  });
  it('rect and circle snap to equal extents (square / round), keeping drag direction', () => {
    expect(snapShapeEnd(O, { x: 18, y: 13 }, 'rect')).toEqual({ x: 18, y: 18 });   // dx8>dy3 -> side 8 down-right
    expect(snapShapeEnd(O, { x: 4, y: 16 }, 'circle')).toEqual({ x: 4, y: 16 });   // dx6=dy6 already
    expect(snapShapeEnd(O, { x: 15, y: 2 }, 'rect')).toEqual({ x: 18, y: 2 });     // dy8>dx5 -> up-right side 8
  });
  it('a shift-snapped rect end yields a true square via rectCells', () => {
    const e = snapShapeEnd(O, { x: 18, y: 13 }, 'rect');
    const cells = rectCells(O, e);
    const xs = cells.map(c => c.x), ys = cells.map(c => c.y);
    const w = Math.max(...xs) - Math.min(...xs), h = Math.max(...ys) - Math.min(...ys);
    expect(w).toBe(h); // square
  });
});
