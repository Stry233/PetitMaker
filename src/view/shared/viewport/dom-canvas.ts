/**
 * Canvas 2D surfaces drawn outside the map renderers (map pictures, the import picture, the preview
 * cell's rasters): a fresh raster, a canvas sized to its css box at the render scale, and a box of
 * cells fitted into that css box.
 */
import { maxRenderScale } from '../../../platform/device/device-quality';
import type { Rect } from '../../../core/grid/rect';

export interface Raster2d { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D }

/** A `w` by `h` px raster, rounded to whole px and at least one each way, with its 2D context; null
 *  where there is no document or no 2D context (a jsdom run). */
export function makeCanvas(w: number, h: number): Raster2d | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w));
  canvas.height = Math.max(1, Math.round(h));
  const ctx = canvas.getContext('2d');
  return ctx ? { canvas, ctx } : null;
}

/** A canvas's css size and the device px its backing store holds per css px. */
interface CssBox { cssW: number; cssH: number; scale: number }

/** `canvas`'s css box at the render scale, read without resizing it; an unlaid canvas reads its
 *  backing store. */
export function cssBoxOf(canvas: HTMLCanvasElement): CssBox {
  const scale = maxRenderScale();
  return { cssW: canvas.clientWidth || canvas.width / scale, cssH: canvas.clientHeight || canvas.height / scale, scale };
}

/** Sizes `canvas`'s backing store to its css box at the render scale and resets its transform; null
 *  without a 2D context. */
export function sizeToCssBox(canvas: HTMLCanvasElement): (CssBox & { ctx: CanvasRenderingContext2D }) | null {
  const box = cssBoxOf(canvas);
  const backW = Math.max(1, Math.round(box.cssW * box.scale)), backH = Math.max(1, Math.round(box.cssH * box.scale));
  if (canvas.width !== backW) canvas.width = backW;
  if (canvas.height !== backH) canvas.height = backH;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  return { ...box, ctx };
}

/** `box`, in cells, scaled to fit `cssW` by `cssH` css px and centred, keeping `marginPx` css px clear
 *  on every side and `marginCells` cells around the box: css px per cell and the css position of cell
 *  (0, 0). The tighter axis meets its margins exactly. */
export function fitCells(cssW: number, cssH: number, box: Rect, marginPx = 0, marginCells = 0): { cell: number; x: number; y: number } {
  const bw = Math.max(1e-6, box.w), bh = Math.max(1e-6, box.h);
  const room = (side: number): number => Math.max(1, side - 2 * marginPx);
  const cell = Math.min(room(cssW) / (bw + 2 * marginCells), room(cssH) / (bh + 2 * marginCells));
  return { cell, x: (cssW - bw * cell) / 2 - box.x * cell, y: (cssH - bh * cell) / 2 - box.y * cell };
}
