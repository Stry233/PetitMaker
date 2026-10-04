// Export sizing — keeps four distinct concepts separate:
//   - mapNativePx   : the 2D map at the renderer's native tile density (64 px/cell).
//   - mapCapturePx  : what the map was ACTUALLY captured at (≤ native; GPU MAX_TEXTURE_SIZE
//                     may clamp it). Read from the loaded capture image's width/height.
//   - mapPreviewRect: where the map is drawn in the composition. Original mode = capture size
//                     1:1 (no resample); presets letterbox into a layout band.
//   - compositionPx : the final export image, bounded by browser canvas limits.
import { TILE_SIZE } from '../../core/model/constants';
import { mapCaptureFrame } from '../../core/model/map-chunks';
import type { MapTemplate } from '../../core/model/types';

export interface PixelSize { w: number; h: number }

/** The same cell frame as the 2D capture, so separately rendered maps, grids and annotations align. */
export interface BandGeometry {
  /** Top-left of the capture in saved cell coordinates, including surrounding sea or terrain bleed. */
  originX: number;
  originY: number;
  widthCells: number;
  heightCells: number;
}
type CaptureTemplate = Pick<MapTemplate, 'width' | 'height' | 'chunkGrid'>;

export function bandGeometry(t: CaptureTemplate): BandGeometry {
  const frame = mapCaptureFrame(t);
  return { originX: frame.x, originY: frame.y, widthCells: frame.width, heightCells: frame.height };
}

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
