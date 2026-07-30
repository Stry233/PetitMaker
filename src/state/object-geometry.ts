import type { GridState, PlacedObject } from '../core/model/types';
import { cellOverlapsRect, rectsOverlap, cellKey } from '../core/model/grid-model';
import { isCoating } from '../core/model/traits';
import { getCatalogItem } from './catalog';


export function getRotatedSize(item: { width: number; height: number }, rotation: 0 | 90 | 180 | 270): { w: number; h: number } {
  return (rotation === 90 || rotation === 270)
    ? { w: item.height, h: item.width }
    : { w: item.width, h: item.height };
}

export function getPlacedObjectSize(obj: import('../core/model/types').PlacedObject): { w: number; h: number } {
  // Self-described off-catalog objects (the plaza) carry their own footprint — honor it (matches objectRect).
  if (obj.width !== undefined && obj.height !== undefined) return { w: obj.width, h: obj.height };
  const item = getCatalogItem(obj.catalogId);
  if (!item) return { w: 1, h: 1 };
  if (obj.spanLength) {
    const perpW = item.width;
    return (obj.rotation === 0 || obj.rotation === 180)
      ? { w: obj.spanLength, h: perpW }
      : { w: perpW, h: obj.spanLength };
  }
  return getRotatedSize(item, obj.rotation);
}

/** The object's footprint as a macro rect: position + size, where size is the
 *  object's own width/height (off-catalog/fractional objects like the plaza) or
 *  the catalog/rotation-derived size. Used by the overlap rules so a fractional
 *  footprint and a normal integer one share one geometry path. */
export function objectRect(obj: PlacedObject): { x: number; y: number; w: number; h: number } {
  if (obj.width !== undefined && obj.height !== undefined) {
    return { x: obj.position.x, y: obj.position.y, w: obj.width, h: obj.height };
  }
  const { w, h } = getPlacedObjectSize(obj);
  return { x: obj.position.x, y: obj.position.y, w, h };
}

/** Precompute the set of object-covered terrain cells ("x,y" keys) in one pass —
 *  generators / region-brush use `occ.has("x,y")` to skip ground covered by ANY
 *  object's footprint (the plaza is just one such object now). Hoists the
 *  O(objects) scan out of per-cell loops where objects don't change during the pass. */
export function buildObjectOccupancy(state: GridState): Set<string> {
  const occ = new Set<string>();
  for (const [, obj] of state.objects) {
    const r = objectRect(obj);
    // Bound the candidate cells to the rect (± the −0.5 micro shift), then keep
    // exactly those cellOverlapsRect accepts.
    const x0 = Math.floor(r.x - 0.5), x1 = Math.ceil(r.x + r.w + 0.5);
    const y0 = Math.floor(r.y - 0.5), y1 = Math.ceil(r.y + r.h + 0.5);
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++)
        if (cellOverlapsRect(r, x, y, -0.5)) occ.add(cellKey(x, y));
  }
  return occ;
}

/** Surface-coating objects (roads/paths) whose footprint overlaps `rect`. The
 *  overlap rule exempts coatings so an object CAN be placed over a road; the
 *  intended editor behavior is to strip the covered road and place. Interactive
 *  placement (manual placer, agent place_object) uses this to remove the roads it
 *  covers (and to tell the user/agent it happened). Returns [] when clear. */
export function coatingsUnder(state: GridState, rect: { x: number; y: number; w: number; h: number }): PlacedObject[] {
  const hit: PlacedObject[] = [];
  for (const [, obj] of state.objects) {
    const item = getCatalogItem(obj.catalogId);
    if (!item || !isCoating(item)) continue;
    const r = objectRect(obj);
    if (rectsOverlap(rect, r)) hit.push(obj);
  }
  return hit;
}

// "Which object is at this cell?" lives in state/object-index (`objectAt`): the same question the
// index exists to answer without a scan, and this module is BELOW it (the index builds on
// objectRect).
