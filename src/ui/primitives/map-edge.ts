/**
 * Frame surfaces that stand over the map at one of its edges mark themselves, so controls anchored
 * to something on the map (which draw UNDER the frame) can keep to the map area left clear.
 */
import { visualRect } from '../design/visual-rect';

const MAP_EDGE_ATTR = 'data-map-edge';
type MapEdge = 'top' | 'bottom' | 'right';

export function mapEdgeAttr(edge: MapEdge): { [MAP_EDGE_ATTR]: MapEdge } {
  return { [MAP_EDGE_ATTR]: edge };
}

interface MapArea { left: number; top: number; right: number; bottom: number }

/** The viewport area clear of every visible marked surface, in visual px. With nothing marked (a
 *  hidden interface, or a shell that marks nothing) it is the whole viewport. */
export function clearMapArea(viewport: { width: number; height: number }): MapArea {
  const area = { left: 0, top: 0, right: viewport.width, bottom: viewport.height };
  if (typeof document === 'undefined') return area;
  for (const el of document.querySelectorAll<HTMLElement>(`[${MAP_EDGE_ATTR}]`)) {
    const r = visualRect(el);
    if (r.width <= 0 || r.height <= 0 || getComputedStyle(el).visibility === 'hidden') continue;
    const edge = el.getAttribute(MAP_EDGE_ATTR) as MapEdge;
    if (edge === 'top') area.top = Math.max(area.top, r.bottom);
    else if (edge === 'bottom') area.bottom = Math.min(area.bottom, r.top);
    else area.right = Math.min(area.right, r.left);
  }
  // A frame too crowded to leave a usable map area falls back to the window.
  if (area.bottom - area.top < 120 || area.right - area.left < 200) return { left: 0, top: 0, right: viewport.width, bottom: viewport.height };
  return area;
}
