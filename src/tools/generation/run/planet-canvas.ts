/** The planet editor's scratch canvas ids carry this prefix and a per-session number, so a cache
 *  keyed by template id (a worker's template store) never serves one session's canvas to the next. */
export const PLANET_CANVAS_ID_PREFIX = 'planet-canvas-';

export function isPlanetCanvasId(id: string): boolean {
  return id.startsWith(PLANET_CANVAS_ID_PREFIX);
}
