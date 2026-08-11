/**
 * PURE decision for the grey hover-preview box: what a left-click would select
 * at this map cell, in the modes where a click selects (Hand, or ObjectPlacer
 * with nothing armed to place — the same predicate as the pointer machine's
 * block-selection path). The overlay draws the returned rect; null means no
 * preview (wrong mode, off the map, region selection active, or the target is
 * a member of the selection — its orange ring is feedback enough).
 *
 * Also home to `objectUnderPointer` (what is under the pointer, mesh pick preferred over the
 * footprint test) and `isDraggableObject` (whether that object can be picked up), the two
 * positional facts the hover preview and the press path both need.
 */
import { ToolType } from '../../core/model/types';
import type { GridState, MacroCoord, PlacedObject } from '../../core/model/types';
import type { BlockRef } from '../../state/store';
import { getCatalogItem } from '../../state/catalog';
import { getPlacedObjectSize } from '../../state/object-geometry';
import { getObjectIndex, objectAt } from '../../state/object-index';
import { inSelectMode } from '../../core/interaction/tool-modes';

/**
 * The object under the pointer: the view's mesh-precise pick when it landed on one (a tree's
 * canopy picks the tree), else the footprint test at the macro cell. ONE owner, so the hover
 * preview, the press, the right-tap and the cursor all hit-test the same way.
 */
export function objectUnderPointer(
  gs: GridState, macro: MacroCoord, meshHitId?: string,
): PlacedObject | null {
  return (meshHitId ? gs.objects.get(meshHitId) : undefined) ?? objectAt(getObjectIndex(gs), macro);
}

export interface HoverBox {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Terrain cells render on the micro grid (−HALF_TILE); objects on the macro grid. */
  terrainMode: boolean;
}

export function selectionHoverBox(
  gs: GridState,
  macro: MacroCoord,
  activeTool: ToolType,
  selectedItemId: string | null,
  selectingRegion: boolean,
  selection: readonly BlockRef[],
  /** A mesh-precise hit from the view (3D raycast), preferred over the
   *  footprint test so hover matches what a click would select. */
  meshHitId?: string,
): HoverBox | null {
  if (!inSelectMode(activeTool, selectedItemId) || selectingRegion) return null;
  if (macro.x < 0 || macro.y < 0 || macro.x >= gs.template.width || macro.y >= gs.template.height) return null;

  const hit = objectUnderPointer(gs, macro, meshHitId);
  if (hit) {
    if (selection.some((r) => r.kind === 'object' && r.id === hit.id)) return null;
    const size = getPlacedObjectSize(hit);
    return { x: hit.position.x, y: hit.position.y, w: size.w, h: size.h, terrainMode: false };
  }
  if (selection.some((r) => r.kind === 'terrain' && r.x === macro.x && r.y === macro.y)) return null;
  return { x: macro.x, y: macro.y, w: 1, h: 1, terrainMode: true };
}

/**
 * Can this object be picked up and dropped on an arbitrary cell? Locked objects (the plaza) must
 * be refused HERE: a move is a self-overlap-excluded PlaceObject, which V-LOCK-02 does not gate,
 * so waiting for a rejection would silently relocate it.
 *
 * Bridges (waterSpan) and ramps (heightDrop) CAN move: their drop goes through the same
 * trait-validated plan as a fresh placement, which SNAPS the command onto the nearest legal span
 * at the drop point — a drop with no span to snap to is refused and the object stays put. What
 * they cannot do is rotate (the span decides the facing), which is the rotate path's own gate.
 *
 * ONE owner of the fact: the press that ARMS a drag and the cursor that PROMISES one must agree.
 */
export function isDraggableObject(obj: PlacedObject): boolean {
  if (obj.locked) return false;
  return !!getCatalogItem(obj.catalogId);
}
