/**
 * PURE decision for the grey hover-preview box: what a left-click would select
 * at this map cell, in the modes where a click selects (Hand, or ObjectPlacer
 * with nothing armed to place — the same predicate as the pointer machine's
 * block-selection path). The overlay draws the returned rect; null means no
 * preview (wrong mode, off the map, region selection active, or the target is
 * a member of the selection — its orange ring is feedback enough).
 *
 * Also home to the PURE facts about what a press at a cell would do — what is under the pointer,
 * whether that object is draggable, whether the pointer is over a selected one, and whether an
 * armed placer's press selects instead of places — so the press path and the cursor read one
 * answer. The selection-taking predicates take the WHOLE selection: a press on any member picks
 * the group up.
 */
import { ToolType } from '../../core/model/types';
import type { GridState, MacroCoord, PlacedObject } from '../../core/model/types';
import type { BlockRef } from '../../state/store';
import { getCatalogItem } from '../../state/catalog';
import { getPlacedObjectSize } from '../../state/object-geometry';
import { getObjectIndex, objectAt } from '../../state/object-index';

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

/**
 * Modes where an UNMODIFIED click selects whatever is under it (and a press on the already-selected
 * object arms a drag): the Hand tool, and the object placer with nothing armed.
 */
export function inSelectMode(activeTool: ToolType, selectedItemId: string | null): boolean {
  return activeTool === ToolType.Hand
    || (activeTool === ToolType.ObjectPlacer && !selectedItemId);
}

/**
 * Modes where a selection can EXIST. Wider than `inSelectMode`: with an item armed, Ctrl still
 * selects and a click on an existing object selects it for an ad-hoc rotate/delete, so the placer
 * keeps a selection armed or not. The paint tools cannot select, so they drop it.
 */
export function canHoldSelection(activeTool: ToolType): boolean {
  return activeTool === ToolType.Hand || activeTool === ToolType.ObjectPlacer;
}

/**
 * The terrain-editing tools: a build brush (mountain/river/tile — one ToolType, DrawingTool
 * multiplexes the material), the eraser, and the edge cutter. None of these can normally hold a
 * selection (`canHoldSelection` excludes them, so switching TO one drops whatever was selected) —
 * but Ctrl reaches the selection path from them too, exactly as it does from an armed placer, so
 * the pointer machine and its cursor hint both need to name this set.
 */
export function isBrushTool(activeTool: ToolType): boolean {
  return activeTool === ToolType.TerrainBrush || activeTool === ToolType.Eraser || activeTool === ToolType.EdgeCut;
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
 * so waiting for a rejection would silently relocate it. Bridges (waterSpan) and ramps
 * (heightDrop) snap to a detected span, so they cannot move either.
 *
 * ONE owner of the fact: the press that ARMS a drag and the cursor that PROMISES one must agree.
 */
export function isDraggableObject(obj: PlacedObject): boolean {
  if (obj.locked) return false;
  const item = getCatalogItem(obj.catalogId);
  return !!item && !item.traits.some((tr) => tr.type === 'waterSpan' || tr.type === 'heightDrop');
}

/**
 * Is the pointer over a SELECTED object, i.e. exactly where a press arms drag-to-move (of that
 * object, or of the whole group it belongs to)? A drag from anywhere else pans the camera.
 *
 * Costs one footprint test per SELECTED object, never a "what is under the pointer" search.
 * `meshHitId` is the view's mesh-precise pick (3D), preferred over the footprint test exactly as
 * the press path prefers it.
 */
export function overSelectedObject(
  gs: GridState, macro: MacroCoord, selection: readonly BlockRef[], meshHitId?: string,
): boolean {
  const meshHit = meshHitId !== undefined && gs.objects.has(meshHitId) ? meshHitId : null;
  for (const ref of selection) {
    if (ref.kind !== 'object') continue;
    const obj = gs.objects.get(ref.id);
    if (!obj || !isDraggableObject(obj)) continue;
    if (meshHit !== null) {
      if (meshHit === ref.id) return true;
      continue;
    }
    const size = getPlacedObjectSize(obj);
    if (macro.x >= obj.position.x && macro.x < obj.position.x + size.w
      && macro.y >= obj.position.y && macro.y < obj.position.y + size.h) return true;
  }
  return false;
}

/**
 * With an item armed in the object placer, does a PLAIN press at this cell select the object under
 * it instead of placing? The point is ad-hoc editing: select, rotate or delete via the handles,
 * and carry on placing with the item still armed.
 *
 * Gated on the placement being REFUSED there (`placementAllowed` = the placer's own `canActAt`),
 * so only the click that could not have placed anything changes meaning. A legal placement still
 * places: that is what keeps coating over a road, and a bridge/ramp snapping from a cell that
 * carries a decoration, working exactly as before.
 *
 * The multi-select modifier is excluded because it owns its own gesture (membership toggle /
 * rubber band), which reaches the selection path with an item armed on its own terms.
 *
 * ONE owner of the fact: the press that SELECTS and the cursor that promises it must agree.
 */
export function armedPressSelects(
  activeTool: ToolType,
  selectedItemId: string | null,
  selectingRegion: boolean,
  multiSelectHeld: boolean,
  hit: PlacedObject | null,
  placementAllowed: boolean,
): boolean {
  return activeTool === ToolType.ObjectPlacer && !!selectedItemId
    && !selectingRegion && !multiSelectHeld
    && !!hit && !placementAllowed;
}
