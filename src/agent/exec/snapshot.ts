/**
 * The assistant's map pictures, through the view host's 2D capture: agent tools call
 * `takeMapSnapshot` without reaching the renderer. Returns a PNG data URL at most 1024 px on its long
 * side, or null when no 2D view is mounted (headless tests) or extraction fails.
 */
import { host } from '../../editor/host/host';

/** The whole map in its capture frame, whatever the camera shows, without selection marks, ghosts
 *  or labels: the export capture, so the picture depends on the map alone. */
export function takeMapSnapshot(): Promise<string | null> {
  return Promise.resolve(host.capture2dImage({ maxPx: 1024 }));
}

/** The look-closer half: the same live renderer framed to one rect of macro cells (inclusive,
 *  clamped), so a region'd view_map answers with a picture instead of degrading to tokens. */
export function takeMapRegionSnapshot(rect: { x1: number; y1: number; x2: number; y2: number }): Promise<string | null> {
  return Promise.resolve(host.capture2dImage({ maxPx: 1024, rect }));
}
