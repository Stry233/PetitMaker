/**
 * Export sizing: the map's native pixel size at the renderer's tile density (`mapNativePx`), the
 * largest capture this device can request (`clampedCaptureRequestPx`), and the uniform shrink that
 * keeps a composition inside the canvas ceiling (`canvasFitScale`). What a capture actually came
 * back at is read from its own width and height.
 */
import { TILE_SIZE } from '../../view/map2d/geometry/world';
import { bandGeometry } from '../../core/grid/map-chunks';
import type { MapTemplate } from '../../core/model/types';

export interface PixelSize { w: number; h: number }

type CaptureTemplate = Pick<MapTemplate, 'width' | 'height' | 'chunkGrid'>;

/** Native pixel size of the 2D map capture region. At capture resolution 1.0 this is 64 px/cell. */
export function mapNativePx(t: CaptureTemplate): PixelSize {
  const band = bandGeometry(t);
  return { w: band.widthCells * TILE_SIZE, h: band.heightCells * TILE_SIZE };
}

/** What one 2D canvas may be: its longest side and its total pixel count. */
export interface CanvasLimits { maxDim: number; maxArea: number }

/** Desktop Chrome's ceilings, and the answer wherever the device cannot be probed. `canvas-limits.ts`
 *  measures the real one, which on WebKit is about a sixteenth of this area. */
export const CANVAS_LIMITS: CanvasLimits = { maxDim: 16384, maxArea: 16384 * 16384 };

/** Largest scale ≤ 1 that keeps a (w×h) canvas within the limits. 1 ⇒ no fallback needed. */
export function canvasFitScale(w: number, h: number, limits: CanvasLimits = CANVAS_LIMITS): number {
  if (w <= 0 || h <= 0) return 1;
  const byDim = Math.min(limits.maxDim / w, limits.maxDim / h);
  const byArea = Math.sqrt(limits.maxArea / (w * h));
  return Math.min(1, byDim, byArea);
}

/** Capture request (long side, px) that asks for native resolution, held inside what this device's
 *  canvas can allocate: the capture lands in a 2D canvas, so a request past the ceiling comes back
 *  blank rather than large. The renderer clamps this further to its GPU MAX_TEXTURE_SIZE, so the
 *  achieved capture may still be smaller — read it back from the loaded image. */
export function clampedCaptureRequestPx(t: CaptureTemplate, limits: CanvasLimits): number {
  const n = mapNativePx(t);
  return Math.max(1, Math.floor(Math.max(n.w, n.h) * canvasFitScale(n.w, n.h, limits)));
}
