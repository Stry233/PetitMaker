/**
 * Reads the live 2D renderer through `canvas/map2d/renderer-registry` (same singleton pattern as
 * render-scheduler): agent tools call `takeMapSnapshot` without importing the renderer directly.
 * Returns a PNG data URL downscaled to <=1024px, or null when no renderer is mounted (headless
 * tests) or extraction fails.
 */
import { getMapRenderer } from '../canvas/map2d/renderer-registry';

export function takeMapSnapshot(): Promise<string | null> {
  return Promise.resolve(getMapRenderer()?.captureFullMap(1024) ?? null);
}

/** The look-closer half: the same live renderer framed to one rect of macro cells (inclusive,
 *  clamped), so a region'd view_map answers with a picture instead of degrading to tokens. */
export function takeMapRegionSnapshot(rect: { x1: number; y1: number; x2: number; y2: number }): Promise<string | null> {
  return Promise.resolve(getMapRenderer()?.captureMapImage(1024, false, rect) ?? null);
}
