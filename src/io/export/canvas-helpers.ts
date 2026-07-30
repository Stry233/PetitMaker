// Shared Canvas-2D helpers for the export painters (composition painter + per-layer thumbnails).
// Kept separate so both can reuse the same rounded-rect path and text-ellipsis logic.

/** Trace a rounded-rectangle path (caller fills/strokes/clips). Radius is clamped to half the box. */
export function rrPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Load an image URL (data URL or object URL) into an HTMLImageElement. Browser-only. */
export function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = rej;
    img.src = url;
  });
}

/** Trim `text` (in the current ctx.font) to fit `maxW`, adding an ellipsis. With `force`, always
 *  appends the ellipsis (used to mark text dropped by line-clamping). */
export function ellipsize(ctx: CanvasRenderingContext2D, text: string, maxW: number, force = false): string {
  if (!force && ctx.measureText(text).width <= maxW) return text;
  const E = '…';
  let lo = 0, hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ctx.measureText(text.slice(0, mid) + E).width <= maxW) lo = mid; else hi = mid - 1;
  }
  return (text.slice(0, lo).trimEnd() || text.slice(0, 1)) + E;
}
