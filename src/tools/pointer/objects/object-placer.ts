import { placeObjectCommand } from '../../../core/model/command-build';
import type { Stroke } from '../../../core/commands/command-executor';
import { type Rotation } from '../../../core/model/types';
import { ToolType } from '../../../state/editing/vocabulary';
import type { CatalogItem, MacroCoord, PlacedObject, PlaceObjectCommand } from '../../../core/model/types';
import type { Tool, ToolContext } from '../runtime/types';
import type { ToolOverlay } from '../runtime/view-seam';
import type { ToolArming } from '../../../state/editing/arming';
import type { CursorId } from '../../../assets/cursors/cursor-spec';
import { getCatalogItem } from '../../../state/catalog';
import { getFootprint } from '../../../core/grid/footprint';
import { getPlacedObjectSize, placementGrab, resolveAnchor, snapsOwnPlacement } from '../../../state/object-geometry';
import { PLACEMENT_GRID } from '../../../core/game/profile';
import { candidateObject } from '../../objects/candidate';
import type { GridCell, MapPoint } from '../../../core/grid/grids';
import { halfPoint } from '../../../core/grid/pointer';
import { cellSet } from '../../../core/grid/grids';
import { ObjectPaint, landPlacement, paintsUnder } from './paint-stroke';


/** What the placement ghost draws for one hovered cell, and whether the click would be accepted. */
export interface PlacementGhostPlan {
  /** The cells to outline: the real footprint, a snapped bridge/ramp span, or (when a snapping
   *  item found no legal span here) just the hovered cell. */
  cells: MacroCoord[];
  valid: boolean;
  /** Supporting elevation, or null when no body can be placed here. */
  bodyElevation: number | null;
  /** The resolved span carries its snapped anchor, orientation and length. */
  span?: PlacedObject;
  /** Applied orientation, including the direction resolved by span placement rules. */
  rotation: Rotation;
}

/** The half-cell point nearest the pointer. With no map point (a headless caller) an item that
 *  centres on it reads the centre of `coord`, so it centres on the cell it names, and a bridge or
 *  ramp probes from `coord` itself. */
function halfReading(item: CatalogItem, coord: MacroCoord, ctx: Pick<ToolContext, 'point'>): MacroCoord | undefined {
  if (ctx.point) return halfPoint(ctx.point);
  return snapsOwnPlacement(item) ? undefined : halfPoint({ x: coord.x + 0.5, y: coord.y + 0.5 } as MapPoint);
}

/** What a placement probe reads of a tool context: the map, the rules and the pointer's point. */
type PlacementProbe = Pick<ToolContext, 'state' | 'registry' | 'validateCommand' | 'point'>;

/**
 * One computation of "what would placing the armed item here do", for the ghost and for the
 * cursor's pre-click probe. Pure: it validates, never executes, and never mutates.
 *
 * `rotation` is the pending placement rotation (turned pre-placement by the rotate shortcuts,
 * `state.placementRotation`); ignored for bridges/ramps, which snap their own orientation from the
 * span they detect — rotating before placing one would just be overridden, so there is nothing
 * for the shortcut to do there.
 *
 * Returns null when there is nothing to place (an unknown item), which is not a refusal.
 */
function planPlacementGhost(
  itemId: string, coord: MacroCoord, ctx: PlacementProbe, rotation: Rotation = 0,
): PlacementGhostPlan | null {
  const item = getCatalogItem(itemId);
  if (!item) return null;

  // A halfStep item (ramp/bridge) probes at the half-cell point nearest the pointer, not the whole
  // cell `coord` names (see resolveAnchor); the pointer holds the footprint by its centre.
  const appliedRotation = item.rotatable ? rotation : 0;
  const anchor = resolveAnchor(item, coord, halfReading(item, coord, ctx), placementGrab(item, appliedRotation));

  if (snapsOwnPlacement(item)) {
    const requested = placeObjectCommand(candidateObject(item, anchor, 0, ctx.state, { id: '__ghost__' }));
    const landed = ctx.registry.resolve(requested, ctx.state);
    const object = landed.object;
    const errors = ctx.validateCommand(landed);
    if (errors.length > 0) return { cells: [anchor], valid: false, bodyElevation: null, rotation: 0 };
    const { w, h } = getPlacedObjectSize(object, item);
    return {
      cells: getFootprint(object.position.x, object.position.y, w, h), valid: true,
      bodyElevation: object.elevation, rotation: object.rotation, span: object,
    };
  }
  // Everything else places where the pointer holds it: the footprint is known (rotated, when the
  // item turns), only legality is open (overlap / zone / locked layer / trait).
  const obj = candidateObject(item, anchor, appliedRotation, ctx.state, { id: '__ghost__' });
  const errors = ctx.validateCommand(placeObjectCommand(obj));
  const { w, h } = getPlacedObjectSize(obj, item);
  return {
    cells: getFootprint(anchor.x, anchor.y, w, h),
    valid: errors.length === 0,
    // A self-sized object (a landmark) has no catalog-sized sprite to ride the ghost; its outline is the preview.
    bodyElevation: obj.width === undefined ? obj.elevation : null,
    rotation: appliedRotation,
  };
}

/**
 * The placer's hover with `itemId` armed at `coord`: the plan, drawn on `overlay` as the cell wash
 * and, where a body stands, the translucent sprite, both tinted red before the click when it would
 * be refused. Validation only, so the ghost tracks the pointer 1:1. Returns the plan, or null with
 * the ghost cleared for an unknown item.
 */
export function showPlacementHover(
  overlay: ToolOverlay, itemId: string, coord: MacroCoord, ctx: PlacementProbe, rotation: Rotation,
): PlacementGhostPlan | null {
  const plan = planPlacementGhost(itemId, coord, ctx, rotation);
  if (!plan) {
    overlay.clearGhost();
    return null;
  }
  if (plan.bodyElevation === null) overlay.clearGhost();
  overlay.showGhost(cellSet(PLACEMENT_GRID, plan.cells), { wash: 'placement', valid: plan.valid });
  if (plan.bodyElevation !== null) {
    // plan.cells[0] is the resolved anchor (the pointer's cell or half point moved by the grab, or a
    // bridge or ramp's snapped end); `coord` alone would draw the body ghost at the pointer's cell.
    const anchor = plan.cells[0] ?? coord;
    overlay.showPlacementGhost({
      catalogId: itemId, x: anchor.x, y: anchor.y, rotation: plan.rotation, elevation: plan.bodyElevation, spanLength: plan.span?.spanLength,
    }, plan.valid);
  }
  return plan;
}

export class ObjectPlacerTool implements Tool<typeof PLACEMENT_GRID> {
  readonly id = ToolType.ObjectPlacer;
  grid(): typeof PLACEMENT_GRID { return PLACEMENT_GRID; }
  /** With nothing armed the placer selects; armed, its press places. */
  selectMode(arming: ToolArming): boolean { return !arming.armedItem; }
  /** Paint draws a stroke, so a finger's press acts at once and its drag is the stroke. */
  strokes(ctx: Pick<ToolContext, 'arming'>): boolean { return paintsUnder(ctx.arming); }
  magnifies(ctx: ToolContext): boolean { return paintsUnder(ctx.arming); }

  /** The Paint stroke, for a press under Paint. */
  private readonly paint = new ObjectPaint();
  /** Which of several picked items the next Place lays (EDIT-70), and the picks it counts through. */
  private turn = { picks: '', at: 0 };

  /** The item the next Place lays: the armed one, or the next of several picked in turn. */
  private placeKind(arming: ToolArming): string | null {
    const { picks } = arming;
    if (picks.length < 2) return arming.armedItem;
    const key = picks.join('|');
    if (this.turn.picks !== key) this.turn = { picks: key, at: 0 };
    return picks[this.turn.at % picks.length]!;
  }

  /** `place` with a card armed, `select` without. `move` is positional, not a mode: drag-to-move
   *  arms only on a press over an object already selected, so the controller upgrades `select` to
   *  it from the pointer machine's hover state. */
  cursor(ctx: ToolContext): CursorId {
    return ctx.arming.armedItem ? 'place' : 'select';
  }

  /** The armed item's placement validity at the hovered cell, from the same computation that tints
   *  the ghost, so the cursor's badge and the ghost's colour cannot disagree. True with nothing
   *  armed or an unplaceable item: the click is a no-op there, not a refusal. */
  canActAt(coord: MacroCoord, ctx: ToolContext): boolean {
    const { placementRotation } = ctx.arming;
    const itemId = this.placeKind(ctx.arming);
    if (!itemId) return true;
    const plan = planPlacementGhost(itemId, coord, ctx, placementRotation);
    return plan === null || plan.valid;
  }

  /** The stroke of the press in progress: a press commits on the way down, so a cancelled one (a
   *  second finger landing, the browser taking the pointer) rolls it back. */
  private press: Stroke | null = null;

  onPointerDown(coord: GridCell<typeof PLACEMENT_GRID>, _point: MapPoint, ctx: ToolContext): void {
    if (paintsUnder(ctx.arming)) { this.paint.down(coord, ctx); return; }
    this.press = ctx.beginStroke();
    const { placementRotation } = ctx.arming;
    const itemId = this.placeKind(ctx.arming);

    // No item selected → hand/drag mode.
    if (!itemId) {
      return;
    }

    const item = getCatalogItem(itemId);
    if (!item || item.placementMode !== 'point') return;

    // The same anchor resolution the ghost/canActAt probe uses (via planPlacementGhost), or the
    // click and the badge could disagree about where a halfStep item would land.
    // Bridges/ramps snap their own rotation when the command resolves; a non-rotatable item never
    // reads the pending rotation (the shortcut already refuses to set it for non-rotatable items).
    const rotation = item.rotatable ? placementRotation : 0;
    const anchor = resolveAnchor(item, coord, halfReading(item, coord, ctx), placementGrab(item, rotation));
    const obj = candidateObject(item, anchor, rotation, ctx.state);

    const cmd: PlaceObjectCommand = placeObjectCommand(obj);

    // Validate before touching the ground: an illegal placement (zone / locked layer / overlapping a real
    // object) must not strip the road it happens to hover over. A surface coating does not count as an
    // overlap (V-PLACE-OVERLAP exempts it — roads are coated over, and the placer strips overlapped
    // coatings before placing), so this validates the placement as if the coating were already gone —
    // exactly the state we're about to create. On rejection, execute() re-validates and fires the
    // validation-failed toast without removing anything.
    if (ctx.validateCommand(cmd).length > 0) {
      ctx.execute(cmd);
      return;
    }

    // Legal: strip the coatings this footprint covers and place, folded into one undo step so the road
    // removal and the placement undo together (and never leave the road gone without the object).
    if ('placed' in landPlacement(ctx, obj, item)) this.turn.at++;
  }

  onPointerMove(coord: GridCell<typeof PLACEMENT_GRID>, _point: MapPoint, ctx: ToolContext): void {
    if (paintsUnder(ctx.arming) && this.paint.drawing(ctx)) { this.paint.move(coord, ctx); return; }
    const { placementRotation } = ctx.arming;
    const itemId = this.placeKind(ctx.arming);
    if (!itemId) {
      ctx.overlay.clearGhost();
      return;
    }
    showPlacementHover(ctx.overlay, itemId, coord, ctx, placementRotation);
  }

  onPointerUp(coord: GridCell<typeof PLACEMENT_GRID>, _point: MapPoint, ctx: ToolContext): void {
    if (paintsUnder(ctx.arming)) this.paint.up(coord, ctx);
    this.press = null;
  }

  /** The press never happened: what it committed is taken back without a redo step. */
  onPointerCancel(ctx: ToolContext): void {
    this.paint.cancel(ctx);
    this.press?.rollback();
    this.press = null;
  }

  cancelPending(ctx: ToolContext): boolean { return this.paint.cancelPending(ctx); }
  undoPendingStep(ctx: ToolContext): boolean { return this.paint.undoPendingStep(ctx); }
  hasPending(ctx: ToolContext): boolean { return this.paint.pending(ctx); }

  onActivate(ctx: ToolContext): void { this.paint.clear(ctx); }

  onDeactivate(ctx: ToolContext): void {
    this.paint.clear(ctx);
    ctx.overlay.clearGhost();
  }

}
