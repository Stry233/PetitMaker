import type { MacroCoord } from '../../core/model/types';
import type { RowSpan } from '../../canvas/map2d/layers/ghost-geometry';

export function bresenham(x0: number, y0: number, x1: number, y1: number): MacroCoord[] {
  const points: MacroCoord[] = [];
  let dx = Math.abs(x1 - x0);
  let dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  let cx = x0, cy = y0;
  while (true) {
    points.push({ x: cx, y: cy });
    if (cx === x1 && cy === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; cx += sx; }
    if (e2 < dx) { err += dx; cy += sy; }
  }
  return points;
}

/** A 4-connected ("supercover") line: every cell the segment passes through, stepping ONE axis at a time so
 *  consecutive cells always share an EDGE — never just a diagonal corner. Use for continuous freehand
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

export function expandLine(points: MacroCoord[], brushSize: number): MacroCoord[] {
  if (brushSize <= 1) return points;
  const set = new Set<string>();
  const result: MacroCoord[] = [];
  // Match the free brush's footprint (brushCells): a brushSize x brushSize block
  // anchored the same way, so a stroke's actual width equals the brush size for
  // every size. `floor((brushSize - 1) / 2)` centres the block on the point for
  // odd sizes and biases it top-left for even ones, exactly like the free brush.
  const offset = Math.floor((brushSize - 1) / 2);
  for (const p of points) {
    for (let dy = 0; dy < brushSize; dy++) {
      for (let dx = 0; dx < brushSize; dx++) {
        const x = p.x - offset + dx;
        const y = p.y - offset + dy;
        const key = `${x},${y}`;
        if (!set.has(key)) { set.add(key); result.push({ x, y }); }
      }
    }
  }
  return result;
}

export function interpolateBezier(p0: MacroCoord, p1: MacroCoord, p2: MacroCoord, steps: number): MacroCoord[] {
  const set = new Set<string>();
  const result: MacroCoord[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const it = 1 - t;
    const x = Math.round(it * it * p0.x + 2 * it * t * p1.x + t * t * p2.x);
    const y = Math.round(it * it * p0.y + 2 * it * t * p1.y + t * t * p2.y);
    const key = `${x},${y}`;
    if (!set.has(key)) { set.add(key); result.push({ x, y }); }
  }
  return result;
}

/** rectCells as one span per row — the drag-shape ghost never expands to cells. */
export function rectSpans(start: MacroCoord, end: MacroCoord): RowSpan[] {
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
  const cells: MacroCoord[] = [];
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++)
      cells.push({ x, y });
  return cells;
}

/** circleCells as one span per row: the ellipse row extent solves the same
 *  half-cell-biased inclusion test analytically, then the exact predicate
 *  corrects the boundary cell so coverage can never drift from circleCells. */
export function circleSpans(center: MacroCoord, rx: number, ry: number): RowSpan[] {
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
  // Test each cell against a radius biased out by a HALF-CELL, i.e. include a cell when it OVERLAPS the
  // radius-r disc, not only when its centre is inside. A centre test collapses the extreme row/column to a
  // single cell (only dx=0 passes at |dy|=r), leaving a 1-cell spike at each cardinal that auto-trim then
  // rounds into a sharp point. The half-cell bias keeps the same outer extent (|dy| ≤ r) but fills the
  // cardinal rows flat, so the disc reads round and auto-trim smooths it instead of pointing it.
  const ax = rxi + 0.5, ay = ryi + 0.5;
  for (let dy = -ryi; dy <= ryi; dy++) {
    for (let dx = -rxi; dx <= rxi; dx++) {
      if ((dx / ax) ** 2 + (dy / ay) ** 2 <= 1) {
        const key = `${center.x + dx},${center.y + dy}`;
        if (!set.has(key)) { set.add(key); cells.push({ x: center.x + dx, y: center.y + dy }); }
      }
    }
  }
  return cells;
}

export function lineCells(start: MacroCoord, end: MacroCoord, width: number): MacroCoord[] {
  // line4, not bresenham: a straight line must be 4-CONNECTED (cells share an
  // edge, never only a diagonal corner) so a painted line / laid road / carved
  // channel actually links up instead of leaving diagonal gaps.
  return expandLine(line4(start.x, start.y, end.x, end.y), width);
}

/** A quadratic-bezier spine that is 4-CONNECTED: interpolateBezier rounds each
 *  sample, so consecutive samples can jump a diagonal (joined only at a corner)
 *  or skip a cell on a steep bend. Stitching them with line4 makes the width-1
 *  spine share an edge between every step, exactly like the free brush — no
 *  diagonal-only links that read as a broken trail (and, for water, no diagonal
 *  gaps that break containment). */
export function bezier4(p0: MacroCoord, p1: MacroCoord, p2: MacroCoord, steps: number): MacroCoord[] {
  const samples = interpolateBezier(p0, p1, p2, steps);
  const spine: MacroCoord[] = [];
  const seen = new Set<string>();
  const push = (c: MacroCoord) => { const k = `${c.x},${c.y}`; if (!seen.has(k)) { seen.add(k); spine.push(c); } };
  if (samples.length) push(samples[0]!);
  for (let i = 1; i < samples.length; i++) {
    const seg = line4(samples[i - 1]!.x, samples[i - 1]!.y, samples[i]!.x, samples[i]!.y);
    for (let j = 1; j < seg.length; j++) push(seg[j]!);
  }
  return spine;
}

export function curveCells(p0: MacroCoord, p1: MacroCoord, p2: MacroCoord, width: number): MacroCoord[] {
  const steps = Math.max(20, Math.hypot(p2.x - p0.x, p2.y - p0.y) * 2);
  return expandLine(bezier4(p0, p1, p2, steps), width);
}

/**
 * One anchor of a curve: where it sits, plus an optional HANDLE that overrides how the path leaves
 * it. The handle is an offset in cells from the anchor, in the cubic-Bezier sense (the control
 * point is `anchor + handle`), so the direction line the user drags and the shape of the curve are
 * the same quantity.
 */
export interface CurveAnchor {
  x: number;
  y: number;
  /** Outgoing handle offset in cells. Absent = derived from the neighbours (see `anchorHandles`). */
  hx?: number;
  hy?: number;
  /** Incoming handle offset in cells. Absent = the mirror of the outgoing one, which is what makes
   *  the path smooth THROUGH the anchor; set independently, the two sides turn apart and the anchor
   *  becomes a corner. */
  ihx?: number;
  ihy?: number;
}

/** An anchor's two handle offsets, both measured FROM the anchor. */
export interface AnchorTangent {
  hx: number;
  hy: number;
  ihx: number;
  ihy: number;
}

/** Centripetal knot spacing: |Δp|^0.5. The floor keeps a repeated anchor from dividing by zero. */
function knots(a: readonly CurveAnchor[]): number[] {
  const t = [0];
  for (let i = 1; i < a.length; i++) {
    t.push(t[i - 1]! + Math.max(1e-4, Math.pow(Math.hypot(a[i]!.x - a[i - 1]!.x, a[i]!.y - a[i - 1]!.y), 0.5)));
  }
  return t;
}

/**
 * Each anchor's handle offset in cells — the user's where they set one, otherwise the one the
 * curve is actually using. The UI draws the direction lines from this, so an untouched anchor shows
 * the tangent the path already has rather than a straight stub that lies about it.
 *
 * The derived value is the non-uniform (centripetal) Catmull-Rom tangent, scaled by a third of the
 * outgoing knot span — the Bezier convention that makes `anchor + handle` a control point.
 */
export function anchorHandles(anchors: readonly CurveAnchor[]): AnchorTangent[] {
  const n = anchors.length;
  const t = knots(anchors);
  /** The incoming side mirrors the outgoing one unless it was set apart from it. */
  const both = (a: CurveAnchor, hx: number, hy: number): AnchorTangent => ({
    hx, hy,
    ihx: a.ihx !== undefined ? a.ihx : -hx,
    ihy: a.ihy !== undefined ? a.ihy : -hy,
  });
  return anchors.map((a, i) => {
    if (a.hx !== undefined && a.hy !== undefined) return both(a, a.hx, a.hy);
    if (n < 2) return both(a, 0, 0);
    const prev = anchors[Math.max(0, i - 1)]!;
    const next = anchors[Math.min(n - 1, i + 1)]!;
    const span = t[Math.min(n - 1, i + 1)]! - t[Math.max(0, i - 1)]!;
    // Scaled by the SHORTER adjacent span, not the outgoing one. The handle is symmetric — it is
    // the control point for the segment on either side — so sizing it from a long neighbour lets
    // that tangent overrun a short segment and swing the path back past its own anchor.
    const inSpan = i > 0 ? t[i]! - t[i - 1]! : Infinity;
    const outSpan = i < n - 1 ? t[i + 1]! - t[i]! : Infinity;
    const k = Math.min(inSpan, outSpan) / (3 * Math.max(1e-4, span));
    return both(a, (next.x - prev.x) * k, (next.y - prev.y) * k);
  });
}

/**
 * A smooth path THROUGH every anchor, sampled to a 4-connected spine.
 *
 * Through, not toward: a Bezier control point sits off the curve, so a user aiming at one targets a
 * place the line never reaches. The anchors are interpolated, which means a click lands the path
 * where it was clicked.
 *
 * Each segment is a cubic Hermite between two anchors, using their handles. With no handles set
 * those come from `anchorHandles` and the result is centripetal Catmull-Rom — CENTRIPETAL rather
 * than uniform because with uniform spacing two anchors close together next to one far away make
 * the segment overshoot and loop back, painting a cusp nobody asked for. Dragging a direction line
 * replaces that anchor's handle and nothing else, so one adjustment stays local.
 */
export function splinePath(anchors: readonly CurveAnchor[]): MacroCoord[] {
  if (anchors.length === 0) return [];
  if (anchors.length === 1) return [{ x: anchors[0]!.x, y: anchors[0]!.y }];

  const h = anchorHandles(anchors);
  const samples: MacroCoord[] = [];
  for (let i = 0; i < anchors.length - 1; i++) {
    const p0 = anchors[i]!, p1 = anchors[i + 1]!;
    // Bezier control points: out of p0, and into p1 along p1's own incoming handle.
    const c0 = { x: p0.x + h[i]!.hx, y: p0.y + h[i]!.hy };
    const c1 = { x: p1.x + h[i + 1]!.ihx, y: p1.y + h[i + 1]!.ihy };
    const steps = Math.max(8, Math.ceil(Math.hypot(p1.x - p0.x, p1.y - p0.y) * 2));
    for (let s = 0; s <= steps; s++) {
      const u = s / steps, v = 1 - u;
      const b0 = v * v * v, b1 = 3 * v * v * u, b2 = 3 * v * u * u, b3 = u * u * u;
      samples.push({
        x: Math.round(p0.x * b0 + c0.x * b1 + c1.x * b2 + p1.x * b3),
        y: Math.round(p0.y * b0 + c0.y * b1 + c1.y * b2 + p1.y * b3),
      });
    }
  }

  // Rounded samples can jump a diagonal or skip a cell on a tight bend, and a spine that links only
  // at a corner reads as a broken trail (and breaks water containment). Same stitch as bezier4.
  const spine: MacroCoord[] = [];
  const seen = new Set<string>();
  const push = (c: MacroCoord) => { const k = `${c.x},${c.y}`; if (!seen.has(k)) { seen.add(k); spine.push(c); } };
  if (samples.length) push(samples[0]!);
  for (let i = 1; i < samples.length; i++) {
    const seg = line4(samples[i - 1]!.x, samples[i - 1]!.y, samples[i]!.x, samples[i]!.y);
    for (let j = 1; j < seg.length; j++) push(seg[j]!);
  }
  return spine;
}

/** The spline as painted cells at the brush width. */
export function splineCells(anchors: readonly CurveAnchor[], width: number): MacroCoord[] {
  return expandLine(splinePath(anchors), width);
}

/** The drag shapes a tool can lay or take back by dragging a box out. */
export type DragShape = 'line' | 'rect' | 'circle';

/**
 * The cells a drag shape covers — ONE builder, so a ghost and the commit behind it cannot draw
 * different figures, and so the eraser takes back exactly the shape the brush lays.
 *
 * `brushSize` widens a LINE only: a rectangle and a circle are the size they were dragged out to.
 */
export function dragShapeCells(
  shape: DragShape, origin: MacroCoord, end: MacroCoord, brushSize: number,
): MacroCoord[] {
  switch (shape) {
    case 'line': return expandLine(line4(origin.x, origin.y, end.x, end.y), brushSize);
    case 'rect': return rectCells(origin, end);
    case 'circle': return circleCells(origin, Math.abs(end.x - origin.x), Math.abs(end.y - origin.y));
  }
}

/** The same figure as row spans, for a preview that must not expand a map-size drag to a cell list.
 *  A LINE has no span form (it is not row-convex), so it is built as cells and left to the caller. */
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
  mode: 'line' | 'rect' | 'circle',
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
