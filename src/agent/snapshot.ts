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
