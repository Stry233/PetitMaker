import type { Rect } from '../../../core/grid/rect';

/** Trace a rounded-rectangle path (caller fills/strokes/clips). Radius is clamped to half the box. */
export function rrPath(ctx: CanvasRenderingContext2D, box: Rect, r: number): void {
  const { x, y, w, h } = box;
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
