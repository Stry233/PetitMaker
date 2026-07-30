/**
 * Span merging and boundary derivation for the overlay ghost/flash: a filled
 * shape collapses to one rect per row, and the outline is exactly the edges
 * whose neighbour lies outside the set.
 */
import { describe, it, expect } from 'vitest';
import { mergeCellSpans, boundaryEdges } from '../../canvas/map2d/layers/ghost-geometry';

function rectCells(x0: number, y0: number, w: number, h: number, micro = false) {
  const out = [];
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) out.push({ x, y, micro });
  return out;
}

describe('mergeCellSpans', () => {
  it('collapses a filled rect to one span per row', () => {
    const spans = mergeCellSpans(rectCells(2, 3, 50, 4));
    expect(spans).toHaveLength(4);
    for (const s of spans) { expect(s.x).toBe(2); expect(s.w).toBe(50); }
  });

  it('covers exactly the input cells (gaps split spans, duplicates collapse)', () => {
    const cells = [
      { x: 1, y: 0, micro: false }, { x: 2, y: 0, micro: false }, { x: 2, y: 0, micro: false },
      { x: 5, y: 0, micro: false },
      { x: 1, y: 1, micro: true },
    ];
    const spans = mergeCellSpans(cells);
    const covered = new Set<string>();
    for (const s of spans) for (let i = 0; i < s.w; i++) covered.add(`${s.x + i},${s.y},${s.micro ? 1 : 0}`);
    expect(covered).toEqual(new Set(['1,0,0', '2,0,0', '5,0,0', '1,1,1']));
    expect(spans).toHaveLength(3);
  });

  it('keeps the two grids apart even at the same coordinates', () => {
    const spans = mergeCellSpans([{ x: 1, y: 1, micro: false }, { x: 2, y: 1, micro: true }]);
    expect(spans).toHaveLength(2);
  });
});

describe('boundaryEdges', () => {
  it('a filled rect yields exactly its four merged sides', () => {
    const edges = boundaryEdges(rectCells(0, 0, 10, 6));
    expect(edges).toHaveLength(4);
    const total = edges.reduce((n, e) => n + Math.abs(e.bx - e.ax) + Math.abs(e.by - e.ay), 0);
    expect(total).toBe(2 * (10 + 6));
  });

  it('an interior hole exposes its own boundary', () => {
    const cells = rectCells(0, 0, 3, 3).filter((c) => !(c.x === 1 && c.y === 1));
    const edges = boundaryEdges(cells);
    const total = edges.reduce((n, e) => n + Math.abs(e.bx - e.ax) + Math.abs(e.by - e.ay), 0);
    expect(total).toBe(12 + 4); // outer perimeter + the hole's four unit edges
  });
});

/* ── span-native shape pipeline ──────────────────────────────────────── */

import { boundaryEdgesFromSpans, type RowSpan } from '../../canvas/map2d/layers/ghost-geometry';
import { rectSpans, circleSpans, circleCells, rectCells as rectCellsReal } from '../../tools/paint/shapes';

function spanCoverage(spans: readonly RowSpan[]): Set<string> {
  const out = new Set<string>();
  for (const s of spans) for (let i = 0; i < s.w; i++) out.add(`${s.x + i},${s.y}`);
  return out;
}

function edgeCoverage(edges: readonly { ax: number; ay: number; bx: number; by: number }[]): Set<string> {
  const out = new Set<string>();
  for (const e of edges) {
    if (e.ay === e.by) for (let x = Math.min(e.ax, e.bx); x < Math.max(e.ax, e.bx); x++) out.add(`h${x},${e.ay}`);
    else for (let y = Math.min(e.ay, e.by); y < Math.max(e.ay, e.by); y++) out.add(`v${e.ax},${y}`);
  }
  return out;
}

describe('span-native shape builders', () => {
  it('rectSpans covers exactly rectCells', () => {
    const a = { x: 3, y: 4 }, b = { x: 40, y: 30 };
    const expected = new Set(rectCellsReal(a, b).map((c) => `${c.x},${c.y}`));
    expect(spanCoverage(rectSpans(a, b))).toEqual(expected);
    expect(rectSpans(a, b)).toHaveLength(27); // one span per row
  });

  it('circleSpans covers exactly circleCells across radii', () => {
    for (const [rx, ry] of [[0, 0], [1, 1], [3, 3], [7, 2], [2, 9], [25, 25], [60, 45]] as const) {
      const c = { x: 100, y: 100 };
      const expected = new Set(circleCells(c, rx, ry).map((p) => `${p.x},${p.y}`));
      expect(spanCoverage(circleSpans(c, rx, ry)), `rx=${rx} ry=${ry}`).toEqual(expected);
    }
  });
});

describe('boundaryEdgesFromSpans', () => {
  it('matches the cell-based boundary for a rect, an ellipse, and split rows', () => {
    const shapes: RowSpan[][] = [
      rectSpans({ x: 0, y: 0 }, { x: 9, y: 5 }),
      circleSpans({ x: 20, y: 20 }, 8, 5),
      [{ x: 0, y: 0, w: 3 }, { x: 5, y: 0, w: 2 }, { x: 1, y: 1, w: 6 }],
    ];
    for (const spans of shapes) {
      const cells = [...spanCoverage(spans)].map((k) => { const [x, y] = k.split(','); return { x: Number(x), y: Number(y) }; });
      expect(edgeCoverage(boundaryEdgesFromSpans(spans))).toEqual(edgeCoverage(boundaryEdges(cells)));
    }
  });
});
