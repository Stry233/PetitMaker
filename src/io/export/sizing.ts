// src/io/export/sizing.ts
// Export sizing — keeps four distinct concepts separate:
//   - mapNativePx   : the 2D map at the renderer's native tile density (64 px/cell).
//   - mapCapturePx  : what the map was ACTUALLY captured at (≤ native; GPU MAX_TEXTURE_SIZE
//                     may clamp it). Read from the loaded capture image's width/height.
//   - mapPreviewRect: where the map is drawn in the composition. Original mode = capture size
//                     1:1 (no resample); presets letterbox into a layout band.
//   - compositionPx : the final export image, bounded by browser canvas limits.
import { TILE_SIZE } from '../../core/model/constants';

export interface PixelSize { w: number; h: number }

/** Native pixel size of the 2D map capture region (matches MapRenderer.captureMapImage:
 *  a half-tile border is added on top/left). At capture resolution 1.0 this is 64 px/cell. */
export function mapNativePx(t: { width: number; height: number }): PixelSize {
  const half = TILE_SIZE / 2;
  return { w: t.width * TILE_SIZE + half, h: t.height * TILE_SIZE + half };
}

/** Capture request (long side, px) that asks for native resolution. The renderer clamps this
 *  to its GPU MAX_TEXTURE_SIZE, so the achieved capture may be smaller — read it back from the
 *  loaded image. */
export function originalCaptureRequestPx(t: { width: number; height: number }): number {
  const n = mapNativePx(t);
  return Math.max(n.w, n.h);
}

/** Conservative cross-browser canvas ceilings. The fallback scale below keeps a huge Original
 *  composition within these instead of silently failing/black. */
export const CANVAS_LIMITS = { maxDim: 16384, maxArea: 16384 * 16384 };

/** Largest scale ≤ 1 that keeps a (w×h) canvas within the limits. 1 ⇒ no fallback needed. */
export function canvasFitScale(w: number, h: number, limits = CANVAS_LIMITS): number {
  if (w <= 0 || h <= 0) return 1;
  const byDim = Math.min(limits.maxDim / w, limits.maxDim / h);
  const byArea = Math.sqrt(limits.maxArea / (w * h));
  return Math.min(1, byDim, byArea);
}
