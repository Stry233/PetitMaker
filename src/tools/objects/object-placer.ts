import { CommandType, ToolType } from '../../core/model/types';
import { detectBridgeSpan } from '../../core/model/bridge-span';
import type { GridState, MacroCoord, MicroCoord, PlacedObject, PlaceObjectCommand, RemoveObjectCommand, ValidationError } from '../../core/model/types';
import type { CommandExecutor } from '../../core/commands/command-executor';
import type { Tool, ToolContext } from '../types';
import type { CursorId } from '../../core/runtime/cursor-spec';
import { useEditorStore } from '../../state/store';
import { getCatalogItem } from '../../state/catalog';
import { bumpObjectsVersion, cellKey, getCell, getFootprint } from '../../core/model/grid-model';
import { surfaceElevation } from '../../core/edge-cut/terrain-silhouette';
import { getPlacedObjectSize, getRotatedSize } from '../../state/object-geometry';
import { entriesNear, getObjectIndex } from '../../state/object-index';
import { generateObjectId } from '../utils';


export const GHOST_VALID = 0x22c55e;
export const GHOST_INVALID = 0xff6b6b;

/** The PlaceObject command that re-places a mutated copy of an object. Callers holding an object
 *  ALREADY off the map (a group transform lifts every member first) execute this directly; for the
 *  in-place case, where the original is still on the map, the `plan*` pair below validates first. */
export function objectPlacementCommand(candidate: PlacedObject): PlaceObjectCommand {
  const item = getCatalogItem(candidate.catalogId);
  return {
    type: CommandType.PlaceObject, timestamp: Date.now(),
    object: candidate, loadValue: item?.loadValue ?? 0,
  };
}

/** `obj` as it would be at (newX, newY): elevation tracks the destination cell's surface. */
export function movedObject(gs: GridState, obj: PlacedObject, newX: number, newY: number): PlacedObject {
  const cell = getCell(gs.cells, newX, newY);
  return { ...obj, position: { x: newX, y: newY }, elevation: surfaceElevation(cell?.terrain) };
}

/**
 * Validate the placement of a mutated copy of `original`, excluding `original` itself so an
 * in-place change isn't read as a self-overlap. Never mutates state (the temporary removal is
 * restored). Shared by move + rotate so both judge validity the same way — and so the object is
 * never removed before the new placement is known to be legal.
 */
function planObjectPlacement(
  exec: CommandExecutor, gs: GridState, original: PlacedObject, candidate: PlacedObject,
): { cmd: PlaceObjectCommand; errors: ValidationError[] } {
  const cmd = objectPlacementCommand(candidate);
  gs.objects.delete(original.id);
  bumpObjectsVersion(gs, { removed: [original] });
  const errors = exec.getRegistry().validatePreCommand(cmd, gs);
  gs.objects.set(original.id, original);
  bumpObjectsVersion(gs, { added: [original] });
  return { cmd, errors };
}

/** Plan moving `obj` to (newX, newY): validates the move (self excluded) and returns the
 *  PlaceObject command + errors. Elevation tracks the destination cell's terrain. */
export function planObjectMove(
  exec: CommandExecutor, gs: GridState, obj: PlacedObject, newX: number, newY: number,
): { cmd: PlaceObjectCommand; errors: ValidationError[] } {
  return planObjectPlacement(exec, gs, obj, movedObject(gs, obj, newX, newY));
}

/** Plan rotating `obj` to `newRotation`: validates the rotated footprint (self excluded)
 *  and returns the PlaceObject command + errors. Position and elevation are unchanged. */
export function planObjectRotation(
  exec: CommandExecutor, gs: GridState, obj: PlacedObject, newRotation: 0 | 90 | 180 | 270,
): { cmd: PlaceObjectCommand; errors: ValidationError[] } {
  return planObjectPlacement(exec, gs, obj, { ...obj, rotation: newRotation });
}

// Bridge ghost = the detected span's footprint (empty when no legal span). Uses
// the same detector as the placement rule so preview and validation never drift.
function computeBridgeGhost(
  coord: MacroCoord, width: number, min: number, max: number, ctx: import('../types').ToolContext,
): MacroCoord[] {
  return detectBridgeSpan(ctx.gridState, coord, width, min, max)?.cells ?? [];
}

function computeRampGhost(
  coord: MacroCoord, itemId: string, ctx: import('../types').ToolContext,
): MacroCoord[] {
  // Validate through the SAME rule the placement uses (V-PLACE-TRAIT heightDrop), so the ghost can NEVER be
  // green where the actual placement fails — e.g. when the lower terrace is shorter than the ramp's 3.5-block
  // bottom support, or the drop isn't exactly one layer. The rule SNAPS the probe's position/rotation/
  // elevation; we then draw the footprint from the snapped command. A cheaper check (just looking for a
  // 1-layer-drop neighbour) would skip the support check and show green on terraces too short to place.
  const item = getCatalogItem(itemId);
  if (!item) return [];
  const probe: PlaceObjectCommand = {
    type: CommandType.PlaceObject, timestamp: Date.now(),
    object: {
      id: '__ghost__', catalogId: itemId, position: { x: coord.x, y: coord.y },
      rotation: 0, elevation: surfaceElevation(getCell(ctx.gridState.cells, coord.x, coord.y)?.terrain),
    },
    loadValue: item.loadValue,
  };
  if (ctx.validateCommand(probe).length > 0) return [];
  const { w, h } = getPlacedObjectSize(probe.object);
  const { x: px, y: py } = probe.object.position;
  const cells: MacroCoord[] = [];
  for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) cells.push({ x: px + c, y: py + r });
  return cells;
}

/**
 * The coating (road/tile) objects covering any of `footprint`. Only objects NEAR the footprint can
 * overlap it, so this asks the spatial index rather than scanning all objects: the tile brush needs
 * it once per painted cell, and a scan would make a large fill cost (cells x objects).
 *
 * Shared by the coat-over removal below and the eraser's pre-click probe, so what the eraser says
 * it will remove is what a click removes.
 */
export function overlappingCoatings(gs: GridState, footprint: MacroCoord[]): PlacedObject[] {
  if (footprint.length === 0) return [];
  const cells = new Set(footprint.map(c => cellKey(c.x, c.y)));
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const c of footprint) {
    if (c.x < x0) x0 = c.x;
    if (c.x > x1) x1 = c.x;
    if (c.y < y0) y0 = c.y;
    if (c.y > y1) y1 = c.y;
  }
  const near = entriesNear(getObjectIndex(gs), { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 });
  const hits: PlacedObject[] = [];
  for (const entry of near) {
    if (!entry.coating) continue;
    const { x, y, w, h } = entry.rect;
    let hit = false;
    for (let dy = 0; dy < h && !hit; dy++) {
      for (let dx = 0; dx < w && !hit; dx++) hit = cells.has(cellKey(x + dx, y + dy));
    }
    if (hit) hits.push(entry.obj);
  }
  return hits;
}

/** The command that removes one object, shared so a probe validates exactly what a click runs. */
export function removeObjectCommand(obj: PlacedObject): RemoveObjectCommand {
  return {
    type: CommandType.RemoveObject,
    timestamp: Date.now(),
    objectId: obj.id,
    removedObject: obj,
  };
}

/**
 * Strip every coating (road/tile) object covering any of `footprint`, so the caller can coat
 * over it. The overlap set is resolved BEFORE the removals, so the commands cannot disturb
 * the iteration.
 */
export function removeOverlappingCoatings(
  footprint: MacroCoord[], ctx: ToolContext,
): void {
  for (const obj of overlappingCoatings(ctx.gridState, footprint)) {
    ctx.executeCommand(removeObjectCommand(obj));
  }
}

/** What the placement ghost draws for one hovered cell, and whether the click would be accepted. */
export interface PlacementGhostPlan {
  /** The cells to outline: the real footprint, a snapped bridge/ramp span, or (when a snapping
   *  item found no legal span here) just the hovered cell. */
  cells: MacroCoord[];
  valid: boolean;
  /** The surface the item's body ghost stands on, or null for the snapping items (whose body
   *  ghost is not drawn — the span outline is the preview). */
  bodyElevation: number | null;
  /** The rotation actually applied — 0 for a non-rotatable item or a snapping bridge/ramp
   *  (which decides its own orientation), else the requested pending rotation. The single place
   *  that decision is made, so the body-ghost sprite and the footprint it outlines never disagree. */
  rotation: 0 | 90 | 180 | 270;
}

/**
 * ONE computation of "what would placing the armed item here do", for the ghost AND for the
 * cursor's pre-click probe. Pure: it validates, never executes, and never mutates.
 *
 * `rotation` is the PENDING placement rotation (turned pre-placement by the rotate shortcuts,
 * `state.placementRotation`); ignored for bridges/ramps, which snap their own orientation from the
 * span they detect — rotating before placing one would just be overridden, so there is nothing
 * for the shortcut to do there.
 *
 * Returns null when there is nothing to place (an unknown item), which is not a refusal.
 */
export function planPlacementGhost(
  itemId: string, coord: MacroCoord, ctx: ToolContext, rotation: 0 | 90 | 180 | 270 = 0,
): PlacementGhostPlan | null {
  const item = getCatalogItem(itemId);
  if (!item) return null;

  const bridgeTrait = item.traits.find(t => t.type === 'waterSpan');
  const rampTrait = item.traits.find(t => t.type === 'heightDrop');
  // Bridges and ramps SNAP: the trait rule decides the span, so "is there a legal span from
  // here" IS the validity question, and the span it found is the footprint.
  if (bridgeTrait && bridgeTrait.type === 'waterSpan') {
    const span = computeBridgeGhost(coord, item.width, bridgeTrait.min, bridgeTrait.max, ctx);
    return { cells: span.length > 0 ? span : [coord], valid: span.length > 0, bodyElevation: null, rotation: 0 };
  }
  if (rampTrait && rampTrait.type === 'heightDrop') {
    const span = computeRampGhost(coord, item.id, ctx);
    return { cells: span.length > 0 ? span : [coord], valid: span.length > 0, bodyElevation: null, rotation: 0 };
  }
  // Everything else places at the hovered cell: the footprint is known (rotated, when the item
  // turns), only legality is open (overlap / zone / locked layer / trait).
  const cell = getCell(ctx.gridState.cells, coord.x, coord.y);
  const elevation = surfaceElevation(cell?.terrain);
  const appliedRotation = item.rotatable ? rotation : 0;
  const errors = ctx.validateCommand({
    type: CommandType.PlaceObject, timestamp: Date.now(),
    object: {
      id: '__ghost__', catalogId: item.id, position: { x: coord.x, y: coord.y },
      rotation: appliedRotation, elevation,
    },
    loadValue: item.loadValue,
  } as PlaceObjectCommand);
  const { w, h } = getRotatedSize(item, appliedRotation);
  return {
    cells: getFootprint(coord.x, coord.y, w, h),
    valid: errors.length === 0,
    bodyElevation: elevation,
    rotation: appliedRotation,
  };
}

export class ObjectPlacerTool implements Tool {
  readonly id = ToolType.ObjectPlacer;

  get cursor(): CursorId {
    if (useEditorStore.getState().selectedItemId) return 'place';
    // `move` is positional, not a mode: drag-to-move arms only on a press over the ALREADY-selected
    // object, so the controller upgrades `select` to it from the pointer machine's hover state.
    return 'select';
  }

  /** The armed item's placement validity at the hovered cell, from the same computation that tints
   *  the ghost, so the cursor's badge and the ghost's colour cannot disagree. True with nothing
   *  armed or an unplaceable item: the click is a no-op there, not a refusal. */
  canActAt(coord: MacroCoord, ctx: ToolContext): boolean {
    const { selectedItemId: itemId, placementRotation } = useEditorStore.getState();
    if (!itemId) return true;
    const plan = planPlacementGhost(itemId, coord, ctx, placementRotation);
    return plan === null || plan.valid;
  }

  onPointerDown(coord: MacroCoord, _micro: MicroCoord, ctx: ToolContext): void {
    const { selectedItemId: itemId, placementRotation } = useEditorStore.getState();

    // No item selected → hand/drag mode.
    if (!itemId) {
      return;
    }

    const item = getCatalogItem(itemId);
    if (!item || item.placementMode !== 'point') return;

    const cell = getCell(ctx.gridState.cells, coord.x, coord.y);
    const elevation = surfaceElevation(cell?.terrain);
    // Bridges/ramps snap their own rotation during validation below; a non-rotatable item never
    // reads the pending rotation (the shortcut already refuses to set it for non-rotatable items).
    const rotation = item.rotatable ? placementRotation : 0;

    const obj: PlacedObject = {
      id: generateObjectId(),
      catalogId: item.id,
      position: { x: coord.x, y: coord.y },
      rotation,
      elevation,
    };

    const cmd: PlaceObjectCommand = {
      type: CommandType.PlaceObject,
      timestamp: Date.now(),
      object: obj,
      loadValue: item.loadValue,
    };

    // Validate BEFORE touching the ground: an illegal placement (zone / locked layer / overlapping a real
    // object) must NOT strip the road it happens to hover over. A surface coating does not count as an
    // overlap (V-PLACE-OVERLAP exempts it — roads are coated OVER, and the placer strips overlapped
    // coatings before placing), so this validates the placement as if the coating were already gone —
    // exactly the state we're about to create. On rejection, execute() re-validates and fires the
    // validation-failed toast without removing anything.
    //
    // Validate a THROWAWAY CLONE: the bridge (waterSpan) and ramp (heightDrop) traits SNAP — i.e. MUTATE —
    // the command's position/rotation during validation. If we validated the real command here, then
    // executeCommand re-validates it, the second pass would re-detect from the already-snapped near end (a
    // raised cell) and wrongly reject a perfectly legal bridge/ramp. Validating a copy keeps the original
    // command unsnapped, so executeCommand validates + snaps it exactly once.
    const probe: PlaceObjectCommand = { ...cmd, object: { ...obj } };
    if (ctx.validateCommand(probe).length > 0) {
      ctx.executeCommand(cmd);
      return;
    }

    // Legal: strip the coatings this footprint covers and place, folded into ONE undo step so the road
    // removal and the placement undo together (and never leave the road gone without the object).
    const start = ctx.getUndoStackSize();
    const { w, h } = getRotatedSize(item, rotation);
    const fp = getFootprint(coord.x, coord.y, w, h);
    removeOverlappingCoatings(fp, ctx);
    // Request the plop BEFORE executing: executeCommand emits objects-changed synchronously, so
    // addObjects runs and consumes the pending plop in the same tick.
    ctx.plopObject?.(obj.id);
    ctx.executeCommand(cmd);
    ctx.collapseHistory(start);
  }

  onPointerMove(coord: MacroCoord, _micro: MicroCoord, ctx: ToolContext): void {
    const { selectedItemId: itemId, placementRotation } = useEditorStore.getState();
    if (!itemId) {
      ctx.overlay.clearGhost();
      return;
    }
    // Tint the ghost red BEFORE the click if the placement would be rejected. Validation only,
    // zero motion: the ghost tracks the cursor 1:1.
    const plan = planPlacementGhost(itemId, coord, ctx, placementRotation);
    if (!plan) {
      ctx.overlay.clearGhost();
      return;
    }
    ctx.overlay.showGhost(plan.cells, plan.valid ? GHOST_VALID : GHOST_INVALID, false);
    if (plan.bodyElevation !== null) {
      ctx.overlay.showPlacementGhost?.(itemId, coord.x, coord.y, plan.rotation, plan.valid, plan.bodyElevation);
    }
  }

  onPointerUp(_coord: MacroCoord, _micro: MicroCoord, _ctx: ToolContext): void {}

  onActivate(_ctx: ToolContext): void {}

  onDeactivate(ctx: ToolContext): void {
    ctx.overlay.clearGhost();
  }

}
