/**
 * Pure decision for the grey hover-preview box, in the modes where a click selects (Hand, or
 * ObjectPlacer with nothing armed to place — the same predicate as the pointer machine's
 * block-selection path): over an object, the footprint a click selects; over ground, a 1×1 box that
 * slides under the pointer in half-cell steps, a click selecting the terrain cell holding its centre
 * (the selection ring then marks that whole cell). The overlay draws the returned rect; null means
 * no preview (wrong mode, off the map, or region selection active). A selected target
 * previews too, so the pointer always shows what it is over.
 *
 * Also home to `pointerTarget` (what a press lands on: the one answer the hover preview, the press,
 * the right-tap and the cursor share) and `isDraggableObject` (whether that object can be picked up).
 */
import type { GridState, MacroCoord, PlacedObject } from '../../core/model/types';
import { getCatalogItem } from '../../state/catalog';
import { getPlacedObjectSize } from '../../state/object-geometry';
import { getObjectIndex, objectAtPoint } from '../../state/object-index';
import { GRIDS, PLACEMENT_GRID, TERRAIN_GRID } from '../../core/game/profile';
import { mapPoint, type GridCell, type GridId, type MapPoint } from '../../core/grid/grids';
import { cellAtPoint, halfPoint } from '../../core/grid/pointer';

/** What a press with nothing armed lands on at a map point. */
export interface PointerTarget {
  /** The object under the pointer: the view's mesh-precise pick when it landed on one (a tree's
   *  canopy picks the tree), else the object whose footprint holds the point. */
  hit: PlacedObject | null;
  /** The half-cell lattice point nearest the pointer: the centre of the 1×1 box that slides under
   *  the pointer in half-cell steps over ground. */
  centre: MacroCoord;
  /** The terrain cell holding `centre`, the one the box overlaps most: what a press selects where it
   *  hits no object. Terrain selections name terrain cells, so this is read on the terrain grid. */
  terrain: GridCell<typeof TERRAIN_GRID>;
}

export function pointerTarget(gs: GridState, point: MapPoint, meshHitId?: string): PointerTarget {
  const meshHit = meshHitId && (!gs.unsettled || gs.unsettled.has(meshHitId)) ? gs.objects.get(meshHitId) : undefined;
  const hit = meshHit ?? objectAtPoint(getObjectIndex(gs), point, gs.unsettled);
  const centre = halfPoint(point);
  return { hit, centre, terrain: cellAtPoint(mapPoint(centre), TERRAIN_GRID) };
}

export interface HoverBox {
  x: number;
  y: number;
  w: number;
  h: number;
  /** The grid the box's coordinates are on: an object's footprint and the sliding ground box are
   *  both drawn on the placement grid. */
  grid: GridId;
}

/** The box a press's target shows: the object's footprint, else the 1×1 box centred on the
 *  half-cell point nearest the pointer, its corner on the half-cell lattice. Null when the terrain
 *  cell it selects is off the map. */
function targetBox(gs: GridState, target: PointerTarget): HoverBox | null {
  if (target.hit) {
    const size = getPlacedObjectSize(target.hit);
    return { x: target.hit.position.x, y: target.hit.position.y, w: size.w, h: size.h, grid: PLACEMENT_GRID };
  }
  const { x, y } = target.terrain;
  if (gs.unsettled) return null;
  if (x < 0 || y < 0 || x >= gs.template.width || y >= gs.template.height) return null;
  const offset = GRIDS[PLACEMENT_GRID].offset;
  return { x: target.centre.x - 0.5 - offset.x, y: target.centre.y - 0.5 - offset.y, w: 1, h: 1, grid: PLACEMENT_GRID };
}

export function selectionHoverBox(
  gs: GridState,
  target: PointerTarget,
  selectMode: boolean,
  selectingRegion: boolean,
): HoverBox | null {
  if (!selectMode || selectingRegion) return null;
  return targetBox(gs, target);
}

/**
 * Can this object be picked up and dropped on an arbitrary cell? Locked objects (landmarks) must
 * be refused here: a move is a self-overlap-excluded PlaceObject, which the locked-object rule does not gate,
 * so waiting for a rejection would silently relocate it.
 *
 * Bridges (waterSpan) and ramps (heightDrop) can move: their drop goes through the same
 * trait-validated plan as a fresh placement, which snaps the command onto the nearest legal span
 * at the drop point — a drop with no span to snap to is refused and the object stays put. What
 * they cannot do is rotate (the span decides the facing), which is the rotate path's own gate.
 *
 * One owner of the fact: the press that arms a drag and the cursor that promises one must agree.
 */
export function isDraggableObject(obj: PlacedObject): boolean {
  if (obj.locked) return false;
  return !!getCatalogItem(obj.catalogId);
}
