/*
 * The placer with Paint chosen (EDIT-65 to EDIT-67): the brush shapes' own gesture lays the armed items
 * along a path or over an area, each spot placed as one placement is and a spot the rules refuse
 * skipped, the whole stroke one undo step. A freehand drag lays as it goes; a line, rectangle or
 * circle on release; a curve once a double-click finishes it.
 */
import type { Stroke } from '../../../core/commands/command-executor';
import { placeObjectCommand, removeObjectCommand } from '../../../core/model/command-build';
import type { CatalogItem, MacroCoord, PlacedObject, Rotation, ValidationError } from '../../../core/model/types';
import { cellSet } from '../../../core/grid/grids';
import { getFootprint, getRotatedSize } from '../../../core/grid/footprint';
import { dragShapeCells, splineCells, type DragShapeKind } from '../../../core/grid/shapes';
import { PLACEMENT_GRID } from '../../../core/game/profile';
import { getCatalogItem } from '../../../state/catalog';
import type { ToolArming } from '../../../state/editing/arming';
import type { BuildShape } from '../../../state/editing/vocabulary';
import { placesOneAtATime } from '../../../state/object-geometry';
import { violationToast } from '../../../i18n/terms/rule-copy';
import { BatchSlots, type BatchLayout, type BatchSlot } from '../../objects/batch-slots';
import { candidateObject } from '../../objects/candidate';
import { coatingStripFor } from '../../placement/coatings';
import { ShapeGesture } from '../paint/gestures';
import type { ToolContext } from '../runtime/types';

/** Whether a press under `arming` paints: Paint chosen with every armed item one that may be laid
 *  many at a time (EDIT-69). */
export function paintsUnder(arming: ToolArming): boolean {
  return arming.objectBrush === 'paint' && arming.picks.length > 0
    && arming.picks.every((id) => !placesOneAtATime(getCatalogItem(id)));
}

/** The armed items a stroke cycles through, in the order they were picked. */
function kindsOf(arming: ToolArming): CatalogItem[] {
  return arming.picks.map((id) => getCatalogItem(id)).filter((item): item is CatalogItem => !!item);
}

/** What placing one spot came to: the object placed, or the rules' refusal. */
type Landing = { placed: PlacedObject } | { refused: ValidationError[] };

/** Lays `obj` as a click places it: refused before anything changes, else the coatings its footprint
 *  replaces come off and it is placed, the two undoing together inside the caller's stroke. */
export function landPlacement(ctx: ToolContext, obj: PlacedObject, item: CatalogItem): Landing {
  const cmd = placeObjectCommand(obj);
  const errors = ctx.validateCommand(cmd);
  if (errors.length > 0) return { refused: errors };
  const spot = ctx.beginStroke();
  try {
    for (const coating of coatingStripFor(ctx.state, obj, item)) ctx.execute(removeObjectCommand(coating));
    // Requested before the command runs: `objects-changed` fires inside it and takes the plop.
    ctx.plopObject(obj.id);
    const result = ctx.execute(cmd);
    if (!result.success) { spot.rollback(); return { refused: result.errors }; }
  } catch (err) {
    spot.rollback();
    throw err;
  }
  spot.collapse();
  return { placed: obj };
}

/** A spot's object, standing on the ground under its anchor; `id` names a preview's. */
const slotObject = (slot: BatchSlot, ctx: ToolContext, id?: string): PlacedObject =>
  candidateObject(slot.item, slot.anchor, slot.rotation, ctx.state, id ? { id } : {});

const slotCells = (slot: BatchSlot): MacroCoord[] => {
  const { w, h } = getRotatedSize(slot.item, slot.rotation);
  return getFootprint(slot.anchor.x, slot.anchor.y, w, h);
};

/** Where an area figure lays from: a rectangle's dragged corner, a circle's top-left. */
function areaLayout(shape: DragShapeKind, origin: MacroCoord, cells: readonly MacroCoord[]): BatchLayout {
  if (shape === 'line') return { kind: 'path' };
  if (shape === 'rect') return { kind: 'area', from: origin };
  return { kind: 'area', from: { x: Math.min(...cells.map((c) => c.x)), y: Math.min(...cells.map((c) => c.y)) } };
}

export class ObjectPaint {
  private readonly gesture = new ShapeGesture();
  /** The figure's press, for the area's starting corner. */
  private origin: MacroCoord | null = null;
  /** The open stroke and what it has laid and skipped so far. */
  private stroke: Stroke | null = null;
  private slots: BatchSlots | null = null;
  private placed = 0;
  private refusals: ValidationError[][] = [];
  /** The last figure previewed, so a pointer resting on one cell plans it once. */
  private previewed: string | null = null;

  /** Whether a stroke is being drawn: a press down, or a curve's anchors standing. */
  drawing(ctx: ToolContext): boolean {
    return this.gesture.freehand || this.gesture.drag.active || this.pending(ctx);
  }

  /** Whether a curve's anchors stand unfinished. */
  pending(ctx: ToolContext): boolean {
    return ctx.arming.objectPaintShape === 'curve' && this.gesture.chain.length > 0;
  }

  down(coord: MacroCoord, ctx: ToolContext): void {
    const shape = ctx.arming.objectPaintShape;
    this.previewed = null;
    if (shape === 'free') {
      this.open(ctx, { kind: 'path' });
      this.gesture.beginFree(coord);
      this.lay([coord], ctx);
      return;
    }
    if (shape === 'curve') {
      this.gesture.chain.down(coord);
      if (!this.gesture.chain.dragging) this.previewPath(splineCells([...this.gesture.chain.points, coord], 1), ctx);
      return;
    }
    this.origin = coord;
    this.gesture.drag.begin(coord);
  }

  move(coord: MacroCoord, ctx: ToolContext): void {
    const shape = ctx.arming.objectPaintShape;
    if (shape === 'free') {
      const swept = this.gesture.sweep(coord, 1);
      if (swept) this.lay(swept, ctx);
      return;
    }
    if (shape === 'curve') {
      const chain = this.gesture.chain;
      chain.move(coord);
      if (chain.length > 0) this.previewPath(splineCells(chain.dragging ? chain.points : [...chain.points, coord], 1), ctx);
      return;
    }
    if (!this.gesture.drag.active || !this.origin) return;
    const end = this.gesture.drag.end(coord, shape, ctx.modifiers.constrain);
    const key = `${shape}|${end.x},${end.y}`;
    if (key === this.previewed) return;
    this.previewed = key;
    const cells = dragShapeCells(shape, this.origin, end, 1);
    this.preview(this.slotsFor(ctx, areaLayout(shape, this.origin, cells)).add(cells), ctx);
  }

  up(coord: MacroCoord, ctx: ToolContext): void {
    const shape: BuildShape = ctx.arming.objectPaintShape;
    if (shape === 'free') {
      if (this.gesture.endFree()) this.finish(ctx);
      return;
    }
    if (shape === 'curve') {
      const chain = this.gesture.chain;
      if (chain.up(coord, ctx.eventTime, ctx.doubleTapMs) !== 'finish') {
        this.previewPath(splineCells([...chain.points, coord], 1), ctx);
        return;
      }
      const cells = splineCells(chain.points, 1);
      chain.clear();
      ctx.overlay.clearGhost();
      this.open(ctx, { kind: 'path' });
      this.lay(cells, ctx);
      this.finish(ctx);
      return;
    }
    const origin = this.origin;
    const figure = this.gesture.releaseFigure(coord, shape, 1, ctx.modifiers.constrain);
    this.origin = null;
    this.previewed = null;
    if (!figure || !origin) return;
    ctx.overlay.clearGhost();
    this.open(ctx, areaLayout(shape, origin, figure.cells));
    this.lay(figure.cells, ctx);
    this.finish(ctx);
  }

  /** The press never happened: what it laid goes without a redo step, and a curve keeps the anchors
   *  it had before the press. */
  cancel(ctx: ToolContext): void {
    if (this.gesture.endFree()) this.stroke?.rollback();
    this.gesture.chain.cancelPress();
    this.gesture.drag.clear();
    this.origin = null;
    this.reset();
    ctx.overlay.clearGhost();
  }

  /** Escape: an unfinished curve goes, having laid nothing. */
  cancelPending(ctx: ToolContext): boolean {
    if (!this.pending(ctx)) return false;
    this.gesture.chain.clear();
    ctx.overlay.clearGhost();
    return true;
  }

  /** Delete: the curve's newest anchor goes. */
  undoPendingStep(ctx: ToolContext): boolean {
    if (ctx.arming.objectPaintShape !== 'curve' || !this.gesture.chain.undoStep()) return false;
    if (this.gesture.chain.length === 0) ctx.overlay.clearGhost();
    else this.previewPath(splineCells(this.gesture.chain.points, 1), ctx);
    return true;
  }

  clear(ctx: ToolContext): void {
    this.gesture.clear();
    this.origin = null;
    this.reset();
    ctx.overlay.clearGhost();
  }

  private open(ctx: ToolContext, layout: BatchLayout): void {
    this.stroke = ctx.beginStroke();
    this.slots = this.slotsFor(ctx, layout);
    this.placed = 0;
    this.refusals = [];
  }

  /** A fresh run of spots under the arming: its picked items, spacing and pending turn. */
  private slotsFor(ctx: ToolContext, layout: BatchLayout): BatchSlots {
    return new BatchSlots(kindsOf(ctx.arming), ctx.arming.objectPaintSpacing, ctx.arming.placementRotation, layout);
  }

  private lay(cells: readonly MacroCoord[], ctx: ToolContext): void {
    if (!this.slots) return;
    for (const slot of this.slots.add(cells)) {
      const landing = landPlacement(ctx, slotObject(slot, ctx), slot.item);
      if ('placed' in landing) this.placed++;
      else this.refusals.push(landing.refused);
    }
  }

  /** Closes the stroke into one undo step under the map's post-stroke rules and says what it skipped:
   *  how many spots, or, where nothing was laid, why the first was refused. */
  private finish(ctx: ToolContext): void {
    const stroke = this.stroke;
    if (!stroke) return;
    const violations = this.placed > 0 ? stroke.commit() : [];
    if (this.placed === 0) stroke.rollback();
    const first = this.refusals[0]?.[0] ?? violations[0];
    if (this.placed === 0 && first) ctx.notify(violationToast(ctx.t, first), 'warning');
    else if (this.refusals.length > 0) ctx.notify(ctx.t('objects.paint_skipped', { n: this.refusals.length }), 'info');
    this.reset();
  }

  private reset(): void {
    this.stroke = null;
    this.slots = null;
    this.placed = 0;
    this.refusals = [];
  }

  private previewPath(cells: readonly MacroCoord[], ctx: ToolContext): void {
    this.preview(this.slotsFor(ctx, { kind: 'path' }).add(cells), ctx);
  }

  /** The figure's spots over the map: the ones the rules take washed and standing, the refused ones
   *  in the warning tint. */
  private preview(slots: readonly BatchSlot[], ctx: ToolContext): void {
    const taken: PlacedObject[] = [];
    const refused: MacroCoord[] = [];
    for (const slot of slots) {
      const obj = slotObject(slot, ctx, `__paint_${taken.length + refused.length}__`);
      if (ctx.validateCommand(placeObjectCommand(obj)).length === 0) taken.push(obj);
      else refused.push(...slotCells(slot));
    }
    const cells = taken.flatMap((obj) => slotCells({ item: getCatalogItem(obj.catalogId)!, anchor: obj.position, rotation: obj.rotation as Rotation }));
    if (taken.length === 0) {
      ctx.overlay.showGhost(cellSet(PLACEMENT_GRID, refused), { wash: 'placement', valid: false });
      ctx.overlay.showGroupPlacementGhost([], false);
      return;
    }
    ctx.overlay.showGhost(cellSet(PLACEMENT_GRID, cells), { wash: 'placement', valid: true }, undefined,
      refused.map((c) => ({ ...c, grid: PLACEMENT_GRID })));
    ctx.overlay.showGroupPlacementGhost(taken.map((obj) => ({
      catalogId: obj.catalogId, x: obj.position.x, y: obj.position.y, rotation: obj.rotation, elevation: obj.elevation,
    })), true);
  }
}
