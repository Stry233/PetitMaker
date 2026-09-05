import type { CatalogItem, GridState, MacroCoord, PlacedObject } from '../core/model/types';
import { cellOverlapsRect, cellKey, getCell, straddledCells } from '../core/model/grid-model';
import { surfaceElevation } from '../core/edge-cut/terrain-silhouette';
import { hasTrait } from '../core/model/traits';
import { getCatalogItem } from './catalog';

/** Whether an item may anchor on the half-cell grid in both axes — the ramp/bridge
 *  exception to macro-only placement (see the `halfStep` trait). */
export function hasHalfStep(item: CatalogItem): boolean {
  return hasTrait(item, 'halfStep');
}

/**
 * Whether the item's own trait decides where it lands: the bridge (waterSpan) and the ramp
 * (heightDrop) DETECT a gap/cliff near the position they are handed and snap position, rotation
 * and elevation onto it during validation.
 *
 * So for these two the `position` on an incoming command is a PROBE ANCHOR — "look for a span
 * from here" — while the `position` an already-placed one carries is the snapped footprint's
 * top-left, and the two are a whole span apart wherever the trait subtracts one (a ramp facing
 * −x/−y: `px = highX − spanLen`). Anything that hands the trait an existing object's position as
 * if it were an anchor is off by that much.
 */
export function snapsOwnPlacement(item: CatalogItem | undefined | null): boolean {
  return !!item && item.traits.some((t) => t.type === 'waterSpan' || t.type === 'heightDrop');
}

/**
 * The standable surface under a (possibly half) macro coordinate: the HIGHEST surface among the
 * cells it straddles, 0 where none of them is on the map.
 *
 * `getCell` indexes a plain array, so a fractional coordinate reads `undefined` and answers 0 —
 * ground level, whatever the terrain there. Anything drawn at that answer sinks into the hill it
 * is hovering over. The MAXIMUM is what a body must stand on so nothing buries it; the placement
 * rules read the same straddle at its MINIMUM instead, since support counts only where every
 * straddled cell holds it.
 */
export function surfaceElevationAt(state: GridState, x: number, y: number): number {
  const xs = straddledCells(x), ys = straddledCells(y);
  let elev = 0;
  for (let cy = ys.lo; cy <= ys.hi; cy++)
    for (let cx = xs.lo; cx <= xs.hi; cx++)
      elev = Math.max(elev, surfaceElevation(getCell(state.cells, cx, cy)?.terrain));
  return elev;
}

/**
 * The elevation an object is at.
 *
 * `PlacedObject.elevation` is a placement-time cache: written from the terrain the placement found
 * and never re-derived, so it is stale wherever the ground has moved since. An object that SITS on
 * the surface takes the surface's height, which is the live answer this returns. The share codec
 * derives it the same way and so does not transmit the field.
 *
 * A SPANNING object keeps what it stored: a bridge and a ramp are placed across a gap or a step by
 * their own traits, so their elevation is the high end they reach and no cell beneath them holds it.
 *
 * A TERRAIN-BASE object (the plaza) keeps what it stored too: its footprint IS a structural base
 * at that elevation (see base-support, which reads the same field), so its height is its own fact
 * — authored by the map template — not a reading of the ground beneath.
 */
export function objectElevation(state: GridState, obj: PlacedObject): number {
  const item = getCatalogItem(obj.catalogId);
  if (!item || snapsOwnPlacement(item) || hasTrait(item, 'terrainBase')) return obj.elevation;
  return surfaceElevationAt(state, obj.position.x, obj.position.y);
}

/** The macro cell indices covered along one axis by the span [pos, pos + size) —
 *  floor/ceil expansion, so a half-integer origin (a halfStep item) still names
 *  every cell it partially occupies. A whole-integer origin/size reduces to the
 *  plain [pos, pos+size) integer run. */
export function coveredCells(pos: number, size: number): number[] {
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos + size);
  const cells: number[] = [];
  for (let i = lo; i < hi; i++) cells.push(i);
  return cells;
}

/** Where a click/drop anchor snaps to: the half-cell grid (`round(p*2)/2`) for a
 *  halfStep item, the whole-cell grid otherwise. */
export function snapAnchor(item: CatalogItem, x: number, y: number): MacroCoord {
  return hasHalfStep(item)
    ? { x: Math.round(x * 2) / 2, y: Math.round(y * 2) / 2 }
    : { x: Math.round(x), y: Math.round(y) };
}

/**
 * THE ANCHOR SEAM: where the pointer puts `item`'s anchor, given the pointer already read at
 * BOTH grid resolutions — `whole` (a view's `screenToMacro`, always a floored int) and `half`
 * (its optional `screenToHalf`, undefined when the view/mock has none). Picks the item's OWN
 * granularity (half for a halfStep item, whole otherwise), adds `offset` in THAT SAME unit, and
 * snaps once through `snapAnchor`. `offset` defaults to {0,0} for a fresh placement (nothing was
 * grabbed); a drag's grab offset is captured through this SAME function too (see
 * `canvas/interaction/usePointerInteraction.ts`), with offset {0,0} at press time — so the press,
 * the live ghost and the drop can never resolve a different anchor for the same pointer read.
 *
 * Deliberately PROJECTION-FREE: it takes the two already-resolved readings, not a live
 * `ViewProjection` — reading the projection stays the caller's job (`ToolManager` populates
 * `ToolContext.halfCoord` for `tools/objects/object-placer.ts`; the pointer machine calls
 * `screenToHalf` directly), since only the caller knows whether it even HAS a screen
 * coordinate to read one from. This is what lets a `tools/` consumer and a `canvas/interaction/`
 * consumer share the one function without either importing the other's layer.
 */
export function resolveAnchor(
  item: CatalogItem, whole: MacroCoord, half: MacroCoord | undefined, offset: MacroCoord = { x: 0, y: 0 },
): MacroCoord {
  const raw = hasHalfStep(item) ? (half ?? whole) : whole;
  return snapAnchor(item, raw.x + offset.x, raw.y + offset.y);
}

/** The macro cells an (x, y, w, h) footprint covers on the UNSHIFTED macro grid, floor/ceil-
 *  expanded on both axes (`coveredCells`) rather than `pos + integer offset` — a half-integer
 *  origin (a halfStep item) names every cell it partially covers instead of probing a
 *  fractional, nonexistent cell key. Reduces to `getFootprint`'s cells for a whole-integer
 *  origin. Shared by the trait sweeps and every other whole-cell-keyed consumer of an object's
 *  footprint (the region lock, the layer-number mask). */
export function footprintCells(x: number, y: number, w: number, h: number): MacroCoord[] {
  const cells: MacroCoord[] = [];
  for (const cy of coveredCells(y, h))
    for (const cx of coveredCells(x, w))
      cells.push({ x: cx, y: cy });
  return cells;
}

export function getRotatedSize(item: { width: number; height: number }, rotation: 0 | 90 | 180 | 270): { w: number; h: number } {
  return (rotation === 90 || rotation === 270)
    ? { w: item.height, h: item.width }
    : { w: item.width, h: item.height };
}

export function getPlacedObjectSize(obj: import('../core/model/types').PlacedObject, item = getCatalogItem(obj.catalogId)): { w: number; h: number } {
  // Self-described off-catalog objects (the plaza) carry their own footprint — honor it (matches objectRect).
  if (obj.width !== undefined && obj.height !== undefined) return { w: obj.width, h: obj.height };
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
export function objectRect(obj: PlacedObject, item?: CatalogItem): { x: number; y: number; w: number; h: number } {
  if (obj.width !== undefined && obj.height !== undefined) {
    return { x: obj.position.x, y: obj.position.y, w: obj.width, h: obj.height };
  }
  const { w, h } = item ? getPlacedObjectSize(obj, item) : getPlacedObjectSize(obj);
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

// "Which object is at this cell?" lives in state/object-index (`objectAt`): the same question the
// index exists to answer without a scan, and this module is BELOW it (the index builds on
// objectRect).
