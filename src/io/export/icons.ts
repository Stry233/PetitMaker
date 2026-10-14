/** The small icons the share picture's band headings wear, drawn in terrain and brand colours. */
import { EXPORT_CODE_TILES, EXPORT_SOIL } from '../../assets/brand-palette';
import { PALETTE } from '../../core/game/profile';
import { rrPath } from '../../view/shared/viewport/round-rect';

/** Draw a stacked-layers icon (3 offset rounded rects), centered on (cx, cy). */
export function drawLayersStackIcon(ctx: CanvasRenderingContext2D, cx: number, cy: number, sz: number): void {
  const rw = sz, rh = sz * 0.42, step = sz * 0.27;
  const colors = [PALETTE.water, PALETTE.elevation[4], EXPORT_SOIL];  // back (bottom) → front (top)
  for (let i = 0; i < 3; i++) {
    const dy = step - i * step;  // +step (bottom), 0 (middle), -step (top)
    ctx.fillStyle = colors[i]!;
    rrPath(ctx, { x: cx - rw / 2, y: cy + dy - rh / 2, w: rw, h: rh }, 2);
    ctx.fill();
  }
}

/** Draw the share code's 2x2 tile icon with its top-left corner at (x, y). */
export function drawMosaicIcon(ctx: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  const gap = size * 0.12, cell = (size - gap) / 2;
  for (let row = 0; row < 2; row++) for (let col = 0; col < 2; col++) {
    ctx.fillStyle = EXPORT_CODE_TILES[row * 2 + col]!;
    ctx.fillRect(x + col * (cell + gap), y + row * (cell + gap), cell, cell);
  }
}

/** Draw a tiny iso-cube icon — for the 3D card header. */
export function drawIsoCubeIcon(ctx: CanvasRenderingContext2D, x: number, y: number, sz: number): void {
  const mx = x + sz / 2, my = y;
  const pts = {
    top: [[mx, my], [mx + sz / 2, my + sz * 0.3], [mx, my + sz * 0.6], [mx - sz / 2, my + sz * 0.3]] as [number, number][],
    left: [[mx - sz / 2, my + sz * 0.3], [mx, my + sz * 0.6], [mx, my + sz], [mx - sz / 2, my + sz * 0.7]] as [number, number][],
    right: [[mx + sz / 2, my + sz * 0.3], [mx, my + sz * 0.6], [mx, my + sz], [mx + sz / 2, my + sz * 0.7]] as [number, number][],
  };
  const drawPoly = (poly: [number, number][], fill: string) => {
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.moveTo(poly[0]![0], poly[0]![1]);
    for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i]![0], poly[i]![1]);
    ctx.closePath();
    ctx.fill();
  };
  drawPoly(pts.top, PALETTE.elevation[3]);
  drawPoly(pts.left, PALETTE.elevation[6]);
  drawPoly(pts.right, PALETTE.elevation[7]);
}
