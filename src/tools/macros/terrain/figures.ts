/**
 * Iconic ground figures (a heart, a ring, a crescent) as cell sets, symmetric by construction, and
 * the ring of positions that frames one.
 */
import type { MacroCoord } from '../../../core/model/types';
import { cellKey } from '../../../core/grid/rect';

export const FIGURE_SHAPES = ['heart', 'ring', 'crescent'] as const;
export type FigureShape = (typeof FIGURE_SHAPES)[number];

/** The figure's cells, mirror-symmetric where the shape is (heart, ring): the right half is the
 *  left half reflected, so no freehand lobe can bulge. All shapes are centered on (cx,cy). */
export function figureCells(shape: FigureShape, cx: number, cy: number, size: number): MacroCoord[] {
  const r = size / 2;
  const out: MacroCoord[] = [];
  const push = (dx: number, dy: number) => { out.push({ x: cx + dx, y: cy + dy }); };
  if (shape === 'heart') {
    // The classic implicit heart, sampled on the half-plane and mirrored. v points up (screen -dy);
    // the curve spans u in [-1.15,1.15], v in [-1,1.25], so the scale maps size to the lobes' width.
    const s = r / 1.15;
    for (let dy = -Math.ceil(r * 1.15); dy <= Math.ceil(r * 1.15); dy++) {
      for (let dx = 0; dx <= Math.ceil(r); dx++) {
        const u = dx / s;
        const v = (-dy + r * 0.12) / s;
        const a = u * u + v * v - 1;
        if (a * a * a - u * u * v * v * v <= 0) { push(dx, dy); if (dx > 0) push(-dx, dy); }
      }
    }
  } else if (shape === 'ring') {
    const band = Math.max(2, Math.round(size / 6));
    for (let dy = -Math.ceil(r); dy <= Math.ceil(r); dy++) {
      for (let dx = 0; dx <= Math.ceil(r); dx++) {
        const d = Math.hypot(dx, dy);
        if (d <= r && d > r - band) { push(dx, dy); if (dx > 0) push(-dx, dy); }
      }
    }
  } else {
    // Crescent: the disc minus a same-size disc shifted toward the opening (east).
    for (let dy = -Math.ceil(r); dy <= Math.ceil(r); dy++) {
      for (let dx = -Math.ceil(r); dx <= Math.ceil(r); dx++) {
        const d0 = Math.hypot(dx, dy);
        const d1 = Math.hypot(dx - r * 0.55, dy);
        if (d0 <= r && d1 > r * 0.85) push(dx, dy);
      }
    }
  }
  return out;
}

/**
 * Positions 2 cells off the outline of `cells`, one every `gap` cells of shoreline, cast radially
 * from the centroid so a heart's ring follows its lobes. Trees want a wide gap; a flower ring traces
 * the shore continuously, or it reads as a speckle halo.
 */
export function figureRing(cells: readonly MacroCoord[], shape: FigureShape, cx: number, gap: number): MacroCoord[] {
  const inside = new Set(cells.map((c) => cellKey(c.x, c.y)));
  const outline = cells.filter((c) =>
    !inside.has(cellKey(c.x + 1, c.y)) || !inside.has(cellKey(c.x - 1, c.y)) || !inside.has(cellKey(c.x, c.y + 1)) || !inside.has(cellKey(c.x, c.y - 1)));
  let mx = 0, my = 0;
  for (const c of cells) { mx += c.x; my += c.y; }
  mx /= cells.length; my /= cells.length;
  // Walked by arc length: equal-angle sampling starves the stretches far from the centroid, such as
  // a heart lobe's long flank.
  const byAngle = outline
    .map((c) => ({ c, a: Math.atan2(c.y - my, c.x - mx) }))
    .sort((p, q) => p.a - q.a);
  const ringPos: MacroCoord[] = [];
  let walked = gap; // place at the first outline cell too
  for (let i = 0; i < byAngle.length; i++) {
    const { c } = byAngle[i]!;
    const prev = byAngle[(i - 1 + byAngle.length) % byAngle.length]!.c;
    walked += Math.hypot(c.x - prev.x, c.y - prev.y);
    if (walked < gap) continue;
    walked = 0;
    const d = Math.hypot(c.x - mx, c.y - my) || 1;
    ringPos.push({
      x: Math.round(mx + (c.x - mx) * (1 + 2.2 / d) + (c.x - mx) / d * 2),
      y: Math.round(my + (c.y - my) * (1 + 2.2 / d) + (c.y - my) / d * 2),
    });
  }
  if (shape === 'crescent') return ringPos;
  // The left half reflected across the figure's axis, so the ring stays symmetric whatever the walk order.
  const left = ringPos.filter((p) => p.x <= cx);
  return [...left, ...left.map((p) => ({ x: 2 * cx - p.x, y: p.y }))];
}
