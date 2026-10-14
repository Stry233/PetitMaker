/*
 * The figures the paint tools, the region brush, Smart Build, the agent's terraform tools and the
 * Help figures lay, as cells: the brush footprint, 4-connected lines, rectangles, circles and the
 * anchor-chain spline's spine. Pure and map-free.
 */
import { splineSamples, type CurveAnchor } from '../base/spline';
import type { MacroCoord } from '../base/coords';
import type { RowSpan } from './cell-spans';
import { getFootprint } from './footprint';
import { cellKey } from './rect';

/** A 4-connected ("supercover") line: every cell the segment passes through, stepping one axis at a time so
 *  consecutive cells always share an edge — never just a diagonal corner. Use for continuous freehand
 *  strokes (filling the gap between two cursor samples): Bresenham steps diagonally and leaves cells joined
 *  only at a point, which reads as a broken, diagonally-linked trail. Total cells = |dx| + |dy| + 1. */
export function line4(x0: number, y0: number, x1: number, y1: number): MacroCoord[] {
  const pts: MacroCoord[] = [{ x: x0, y: y0 }];
  const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let cx = x0, cy = y0, ix = 0, iy = 0;
  while (ix < dx || iy < dy) {
    // step the axis whose next cell boundary is nearer (compare normalized progress); ties step x
    if ((1 + 2 * ix) * dy < (1 + 2 * iy) * dx) { cx += sx; ix++; } else { cy += sy; iy++; }
    pts.push({ x: cx, y: cy });
  }
  return pts;
}

/** The brush's footprint at (cx, cy): a `size` x `size` block, centred on the cell for odd sizes and
 *  biased up and left for even ones, row by row. Every widened figure is this block swept along it. */
export function brushCells(cx: number, cy: number, size: number): MacroCoord[] {
  const offset = Math.floor((size - 1) / 2);
  return getFootprint(cx - offset, cy - offset, size, size);
}

/** The brush footprint swept along `points`, each cell once, in first-reached order. */
export function expandLine(points: MacroCoord[], brushSize: number): MacroCoord[] {
  if (brushSize <= 1) return points;
  const set = new Set<string>();
  const result: MacroCoord[] = [];
  for (const p of points) {
    for (const c of brushCells(p.x, p.y, brushSize)) {
      const key = cellKey(c.x, c.y);
      if (!set.has(key)) { set.add(key); result.push(c); }
    }
  }
  return result;
}

/** rectCells as one span per row — the drag-shape ghost never expands to cells. */
function rectSpans(start: MacroCoord, end: MacroCoord): RowSpan[] {
  const x0 = Math.min(start.x, end.x);
  const x1 = Math.max(start.x, end.x);
  const y0 = Math.min(start.y, end.y);
  const y1 = Math.max(start.y, end.y);
  const spans: RowSpan[] = [];
  for (let y = y0; y <= y1; y++) spans.push({ x: x0, y, w: x1 - x0 + 1 });
  return spans;
}

export function rectCells(start: MacroCoord, end: MacroCoord): MacroCoord[] {
  const x0 = Math.min(start.x, end.x);
  const x1 = Math.max(start.x, end.x);
  const y0 = Math.min(start.y, end.y);
  const y1 = Math.max(start.y, end.y);
  return getFootprint(x0, y0, x1 - x0 + 1, y1 - y0 + 1);
}

/** circleCells as one span per row: the ellipse row extent solves the same
 *  half-cell-biased inclusion test analytically, then the exact predicate
 *  corrects the boundary cell so coverage can never drift from circleCells. */
function circleSpans(center: MacroCoord, rx: number, ry: number): RowSpan[] {
  if (rx === 0 && ry === 0) return [{ x: center.x, y: center.y, w: 1 }];
  const rxi = Math.max(1, Math.round(rx));
  const ryi = Math.max(1, Math.round(ry));
  const ax = rxi + 0.5, ay = ryi + 0.5;
  const inside = (dx: number, dy: number): boolean => (dx / ax) ** 2 + (dy / ay) ** 2 <= 1;
  const spans: RowSpan[] = [];
  for (let dy = -ryi; dy <= ryi; dy++) {
    let d = Math.min(rxi, Math.floor(ax * Math.sqrt(Math.max(0, 1 - (dy / ay) ** 2))));
    while (d + 1 <= rxi && inside(d + 1, dy)) d++;
    while (d > 0 && !inside(d, dy)) d--;
    if (!inside(d, dy)) continue;
    spans.push({ x: center.x - d, y: center.y + dy, w: 2 * d + 1 });
  }
  return spans;
}

export function circleCells(center: MacroCoord, rx: number, ry: number): MacroCoord[] {
  if (rx === 0 && ry === 0) return [{ x: center.x, y: center.y }];
  const cells: MacroCoord[] = [];
  const set = new Set<string>();
  const rxi = Math.max(1, Math.round(rx));
  const ryi = Math.max(1, Math.round(ry));
  // Test each cell against a radius biased out by a half-cell, i.e. include a cell when it overlaps the
  // radius-r disc, not only when its centre is inside. A centre test collapses the extreme row/column to a
  // single cell (only dx=0 passes at |dy|=r), leaving a 1-cell spike at each cardinal that auto-trim then
  // rounds into a sharp point. The half-cell bias keeps the same outer extent (|dy| ≤ r) but fills the
  // cardinal rows flat, so the disc reads round and auto-trim smooths it instead of pointing it.
  const ax = rxi + 0.5, ay = ryi + 0.5;
  for (let dy = -ryi; dy <= ryi; dy++) {
    for (let dx = -rxi; dx <= rxi; dx++) {
      if ((dx / ax) ** 2 + (dy / ay) ** 2 <= 1) {
        const key = cellKey(center.x + dx, center.y + dy);
        if (!set.has(key)) { set.add(key); cells.push({ x: center.x + dx, y: center.y + dy }); }
      }
    }
  }
  return cells;
}

export function lineCells(start: MacroCoord, end: MacroCoord, width: number): MacroCoord[] {
  // line4, not bresenham: a straight line must be 4-connected (cells share an
  // edge, never only a diagonal corner) so a painted line / laid road / carved
  // channel actually links up instead of leaving diagonal gaps.
  return expandLine(line4(start.x, start.y, end.x, end.y), width);
}

/** Rounded curve samples joined by `line4`, each cell once: rounding can jump a diagonal or skip a
 *  cell on a tight bend, and a spine that links only at a corner reads as a broken trail (and breaks
 *  water containment). */
function stitch4(samples: readonly MacroCoord[]): MacroCoord[] {
  const spine: MacroCoord[] = [];
  const seen = new Set<string>();
  const push = (c: MacroCoord) => { const k = cellKey(c.x, c.y); if (!seen.has(k)) { seen.add(k); spine.push(c); } };
  if (samples.length) push(samples[0]!);
  for (let i = 1; i < samples.length; i++) {
    const seg = line4(samples[i - 1]!.x, samples[i - 1]!.y, samples[i]!.x, samples[i]!.y);
    for (let j = 1; j < seg.length; j++) push(seg[j]!);
  }
  return spine;
}

/**
 * A smooth path through every anchor, sampled to a 4-connected spine. Anchors are interpolated, so
 * a click lands the path where it was clicked. Each segment is a cubic Hermite between two anchors
 * using their handles; unset handles come from `anchorHandles` as centripetal Catmull-Rom, since
 * uniform spacing overshoots into a cusp where two close anchors sit beside a far one. Dragging a
 * direction line replaces only that anchor's handle.
 */
export function splinePath(anchors: readonly CurveAnchor[]): MacroCoord[] {
  return stitch4(splineSamples(anchors).map(([x, y]) => ({ x: Math.round(x), y: Math.round(y) })));
}

/** The spline as painted cells at the brush width. */
export function splineCells(anchors: readonly CurveAnchor[], width: number): MacroCoord[] {
  return expandLine(splinePath(anchors), width);
}

/** The drag shapes a tool can lay or take back by dragging a box out. */
export type DragShapeKind = 'line' | 'rect' | 'circle';

/**
 * The cells a drag shape covers — one builder, so a ghost and the commit behind it cannot draw
 * different figures, and so the eraser takes back exactly the shape the brush lays.
 *
 * `brushSize` widens a line only: a rectangle and a circle are the size they were dragged out to.
 */
export function dragShapeCells(
  shape: DragShapeKind, origin: MacroCoord, end: MacroCoord, brushSize: number,
): MacroCoord[] {
  switch (shape) {
    case 'line': return expandLine(line4(origin.x, origin.y, end.x, end.y), brushSize);
    case 'rect': return rectCells(origin, end);
    case 'circle': return circleCells(origin, Math.abs(end.x - origin.x), Math.abs(end.y - origin.y));
  }
}

/** The same figure as row spans, for a preview that must not expand a map-size drag to a cell list.
 *  A line has no span form (it is not row-convex), so it is built as cells and left to the caller. */
export function dragShapeSpans(
  shape: 'rect' | 'circle', origin: MacroCoord, end: MacroCoord,
): RowSpan[] {
  return shape === 'rect'
    ? rectSpans(origin, end)
    : circleSpans(origin, Math.abs(end.x - origin.x), Math.abs(end.y - origin.y));
}

/** Shift-constrained shape endpoint (relative to the drag origin):
 *  - 'line'  snaps to the nearest of horizontal, vertical, or 45-degree diagonal
 *  - 'rect' / 'circle' snap to a perfect square / round circle (equal extents)
 *  Pure and unit-tested; the tools call it only while Shift is held. */
export function snapShapeEnd(
  origin: MacroCoord,
  end: MacroCoord,
  mode: DragShapeKind,
): MacroCoord {
  const dx = end.x - origin.x, dy = end.y - origin.y;
  const adx = Math.abs(dx), ady = Math.abs(dy);
  const sx = dx < 0 ? -1 : 1, sy = dy < 0 ? -1 : 1;
  if (mode === 'line') {
    // octant snap: within ~22.5 degrees of an axis -> that axis, else diagonal.
    // tan(22.5) ~= 0.4142, so the shorter leg must be under 0.4142x the longer.
    const T = 0.4142;
    if (ady <= adx * T) return { x: end.x, y: origin.y };          // horizontal
    if (adx <= ady * T) return { x: origin.x, y: end.y };          // vertical
    const d = Math.max(adx, ady);
    return { x: origin.x + sx * d, y: origin.y + sy * d };         // diagonal
  }
  // rect + circle: equal extents on both axes, following the drag direction
  const d = Math.max(adx, ady);
  return { x: origin.x + sx * d, y: origin.y + sy * d };
}
