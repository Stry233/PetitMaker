import type { CatalogItem, CategoryId, GridState, MacroCoord, PlacedObject, Rotation } from '../core/model/types';
import { getCell } from '../core/model/grid-model';
import { cellKey, onHalfGrid, straddledCells, snapHalf, type Rect } from '../core/grid/rect';
import { terrainCellsUnder, getFootprint, getRotatedSize, isQuarterTurn } from '../core/grid/footprint';
import { surfaceElevation } from '../core/domain/terrain/terrain-surface';
import { hasTrait, isSelfSnappingTrait } from '../core/model/traits';
import { CLEARANCE, DOOR } from '../core/game/profile';
import { getCatalogItem, itemRole } from './catalog';

/** A home large enough to have a door (smaller ones are street furniture). */
export const hasGate = (item: { category: CategoryId; width: number; height: number }): boolean =>
  itemRole(item) === 'home' && item.width * item.height >= CLEARANCE.gateMinArea;

/** A house's door: the cell at the centre of the footprint side that is its bottom at rotation 0,
 *  turned with the house (90 faces -x, 180 faces -y, 270 faces +x, as the sprite and mesh turn), and
 *  the unit step it faces. `r` is the turned footprint. */
export function doorOf(r: Rect, rotation: Rotation = 0): { gate: MacroCoord; facing: MacroCoord } {
  const x0 = Math.floor(r.x), y0 = Math.floor(r.y);
  const x1 = Math.ceil(r.x + r.w) - 1, y1 = Math.ceil(r.y + r.h) - 1;
  const midX = Math.floor(r.x + r.w / 2), midY = Math.floor(r.y + r.h / 2);
  if (rotation === 90) return { gate: { x: x0, y: midY }, facing: { x: -1, y: 0 } };
  if (rotation === 180) return { gate: { x: midX, y: y0 }, facing: { x: 0, y: -1 } };
  if (rotation === 270) return { gate: { x: x1, y: midY }, facing: { x: 1, y: 0 } };
  return { gate: { x: midX, y: y1 }, facing: { x: 0, y: 1 } };
}

/** The ground in front of a house's door side on the object grid: the whole footprint side that
 *  carries the door, and `depth` out from it. */
export function doorGroundRect(r: Rect, rotation: Rotation, depth: number): Rect {
  const { facing } = doorOf(r, rotation);
  if (facing.x !== 0) return { x: facing.x > 0 ? r.x + r.w : r.x - depth, y: r.y, w: depth, h: r.h };
  return { x: r.x, y: facing.y > 0 ? r.y + r.h : r.y - depth, w: r.w, h: depth };
}

/** The terrain cells in front of a house's door side that V-PLACE-DOOR reads, to the deeper of its two
 *  depths; empty for an object without a door. A terrain planner keeps them as they are. */
export function doorstepTerrain(obj: PlacedObject, item = getCatalogItem(obj.catalogId)): MacroCoord[] {
  if (!item || !hasGate(item)) return [];
  return terrainCellsUnder(doorGroundRect(objectRect(obj, item), obj.rotation, Math.max(DOOR.dropDepth, DOOR.riseDepth)));
}

/** Whether an item may anchor on the half-cell grid in both axes — the ramp/bridge
 *  exception to macro-only placement (see the `halfStep` trait). */
export function hasHalfStep(item: CatalogItem): boolean {
  return hasTrait(item, 'halfStep');
}

/** Whether coordinate `v` lies on `item`'s own anchor grid: the half grid for a halfStep item
 *  (ramps, bridges), whole cells for everything else. */
export function onItemGrid(item: CatalogItem, v: number): boolean {
  return hasHalfStep(item) ? onHalfGrid(v) : Number.isInteger(v);
}

/** Crossings follow their rotation even when the reserved footprint is square. */
export function crossingRunsAlongX(obj: PlacedObject): boolean {
  const item = getCatalogItem(obj.catalogId);
  const quarterTurn = isQuarterTurn(obj.rotation);
  return !!item && hasTrait(item, 'heightDrop') ? quarterTurn : !quarterTurn;
}

/**
 * Whether the item's own trait decides where it lands (`core/model/traits.ts:SELF_SNAPPING_TRAITS`):
 * the bridge (waterSpan) and the ramp (heightDrop) detect a gap/cliff near the position they are
 * handed and snap position, rotation and elevation onto it as the command resolves
 * (`RuleDispatcher.resolve`).
 *
 * So for these the `position` on an incoming command is a probe anchor — "look for a span
 * from here" — while the `position` an already-placed one carries is the snapped footprint's
 * top-left, and the two are a whole span apart wherever the trait subtracts one (a ramp facing
 * −x/−y: `px = highX − spanLen`). Anything that hands the trait an existing object's position as
 * if it were an anchor is off by that much.
 */
export function snapsOwnPlacement(item: CatalogItem | undefined | null): boolean {
  return !!item && item.traits.some((t) => isSelfSnappingTrait(t.type));
}

/**
 * The standable surface under a (possibly half) macro coordinate: the highest surface among the
 * cells it straddles, 0 where none of them is on the map.
 *
 * `getCell` indexes a plain array, so a fractional coordinate reads `undefined` and answers 0 —
 * ground level, whatever the terrain there. Anything drawn at that answer sinks into the hill it
 * is hovering over. The maximum is what a body must stand on so nothing buries it; the placement
 * rules read the same straddle at its minimum instead, since support counts only where every
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
 * `PlacedObject.elevation` is a placement-time cache, stale wherever the ground has moved since. An
 * object that sits on the surface, a landmark included, takes the surface's height; the share codec
 * derives it the same way and does not transmit the field. A spanning object (a bridge, a ramp)
 * keeps what it stored: the high end it reaches, which no cell beneath it holds.
 */
export function objectElevation(state: GridState, obj: PlacedObject): number {
  const item = getCatalogItem(obj.catalogId);
  if (!item || snapsOwnPlacement(item)) return obj.elevation;
  return surfaceElevationAt(state, obj.position.x, obj.position.y);
}

/** Where a click/drop anchor snaps to: the half-cell grid for a halfStep item, the whole-cell
 *  grid otherwise. */
function snapAnchor(item: CatalogItem, x: number, y: number): MacroCoord {
  return hasHalfStep(item)
    ? { x: snapHalf(x), y: snapHalf(y) }
    : { x: Math.round(x), y: Math.round(y) };
}

/**
 * The anchor seam: where the pointer puts `item`'s anchor, given the pointer already read at
 * both grid resolutions — `whole` (the tool's placement cell, always a floored int) and `half`
 * (`core/grid/pointer.ts:halfPoint` of the map point, undefined without one). Picks the item's own
 * granularity (half for a halfStep item, whole otherwise), adds `offset` in that same unit, and
 * snaps once through `snapAnchor`. `offset` is {0,0} for a fresh placement; a drag captures its
 * grab offset through this same function (`view/interaction/pointer/object-drag.ts`), so the
 * press, the live ghost and the drop resolve one anchor for one pointer read.
 *
 * It takes resolved readings, not a `ViewProjection`, so `tools/` and `view/interaction/` share it.
 */
export function resolveAnchor(
  item: CatalogItem, whole: MacroCoord, half: MacroCoord | undefined, offset: MacroCoord = { x: 0, y: 0 },
): MacroCoord {
  const raw = hasHalfStep(item) ? (half ?? whole) : whole;
  return snapAnchor(item, raw.x + offset.x, raw.y + offset.y);
}

/** The placement-grid cells `obj`'s drawn footprint names (`getFootprint` at its placed size). */
export function placedFootprint(obj: PlacedObject): MacroCoord[] {
  const { w, h } = getPlacedObjectSize(obj);
  return getFootprint(obj.position.x, obj.position.y, w, h);
}

/** Whether the object carries its own footprint (an off-catalog object such as a landmark). */
export function isSelfSized(obj: PlacedObject): obj is PlacedObject & { width: number; height: number } {
  return obj.width !== undefined && obj.height !== undefined;
}


export function getPlacedObjectSize(obj: PlacedObject, item = getCatalogItem(obj.catalogId)): { w: number; h: number } {
  // A self-sized object carries its own footprint, as in objectRect.
  if (isSelfSized(obj)) return { w: obj.width, h: obj.height };
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
 *  object's own width/height (off-catalog or fractional objects such as a landmark) or
 *  the catalog/rotation-derived size. Used by the overlap rules so a fractional
 *  footprint and a normal integer one share one geometry path. */
export function objectRect(obj: PlacedObject, item?: CatalogItem): { x: number; y: number; w: number; h: number } {
  if (isSelfSized(obj)) {
    return { x: obj.position.x, y: obj.position.y, w: obj.width, h: obj.height };
  }
  const { w, h } = item ? getPlacedObjectSize(obj, item) : getPlacedObjectSize(obj);
  return { x: obj.position.x, y: obj.position.y, w, h };
}

/** Precompute the set of object-covered terrain cells ("x,y" keys) in one pass —
 *  generators / region-brush use `occ.has("x,y")` to skip ground covered by any
 *  object's footprint, landmarks included. Hoists the
 *  O(objects) scan out of per-cell loops where objects don't change during the pass. */
export function buildObjectOccupancy(state: GridState): Set<string> {
  const occ = new Set<string>();
  for (const [, obj] of state.objects) {
    for (const c of terrainCellsUnder(objectRect(obj))) occ.add(cellKey(c.x, c.y));
  }
  return occ;
}

// "Which object is at this cell?" lives in state/object-index (`objectAt`): the same question the
// index exists to answer without a scan, and this module is below it (the index builds on
// objectRect).
