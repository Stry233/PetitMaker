import { removeObjectCommand } from '../../../core/model/command-build';
import type { Stroke } from '../../../core/commands/command-executor';
import { coatingLayer } from '../../../core/model/traits';
import { getCatalogItem } from '../../../state/catalog';
import { TerrainType } from '../../../core/model/types';
import { ToolType } from '../../../state/editing/vocabulary';
import type { Command, GridState, MacroCell, MacroCoord } from '../../../core/model/types';
import type { Tool } from '../runtime/types';
import type { CurveToolContext } from './curve-session';
import type { PreviewCell } from '../runtime/view-seam';
import type { CursorId } from '../../../assets/cursors/cursor-spec';
import { brushCells, expandLine, line4, splineCells } from '../../../core/grid/shapes';
import { ShapeGesture } from './gestures';
import { violationToast } from '../../../i18n/terms/rule-copy';
import { getCell } from '../../../core/model/grid-model';
import type { ContentType } from '../../../state/editing/edit-mode';
import { peelCommand } from '../../placement/terrain-peel';
import { eraseTileCells } from './tile-coating';
import { overlappingCoatings } from '../../placement/coatings';
import { adjustErasedCurve } from './eraser-curve';
import { StrokePreimage } from './restore';
import { finishEraserStroke } from './eraser-stroke';
import type { GridId, GridCell, MapPoint } from '../../../core/grid/grids';
import { CONTENT_GRID } from '../../../state/editing/edit-mode';
import { cellSet } from '../../../core/grid/grids';
import { cellKey } from '../../../core/grid/rect';
import { surfaceElevation } from '../../../core/domain/terrain/terrain-surface';
import { strokeThickness, surfaceLayerAt } from './paint-plan';
import { showStrokeLayer } from './display-layer';

/** Whether the eraser for `ctx`'s surface takes terrain of `type`. In the planet session the terrain
 *  eraser also takes a pond, so it clears the water before it turns that ground to sea. */
function erasesHere(type: TerrainType, ctx: CurveToolContext): boolean {
  if (ctx.arming.contentType === 'water') return type === TerrainType.Water;
  if (ctx.arming.contentType === 'mountain') return type === TerrainType.Mountain || (ctx.arming.groundEditable && type === TerrainType.Water);
  return true;
}

/** The planet session's layer-0 peel for a cell with no terrain: the terrain eraser turns bare ground
 *  to sea. Undefined when the session is off or the cell holds terrain, so the ordinary peel decides;
 *  null when layer 0 has nothing to peel here. */
function groundPeel(coord: MacroCoord, cell: MacroCell | null, ctx: CurveToolContext): Command | null | undefined {
  if (!ctx.arming.groundEditable || !cell || cell.terrain) return undefined;
  return peelCommand(coord.x, coord.y, cell, { waterEraser: ctx.arming.contentType === 'water', groundEditable: true });
}

/** How many layers a stroke takes off a cell: the stroke's thickness for mountain, one for water. */
const depthOf = (ctx: CurveToolContext): number => (ctx.arming.contentType === 'mountain' ? strokeThickness(ctx) : 1);

/** The height a stroke started on `start` lowers its cells to, never below the ground. */
const bottomOf = (start: number, ctx: CurveToolContext): number => Math.max(0, start - depthOf(ctx));

/** Whether a stroke started on `start` takes from `cell`: its top stands on the start, or below it and
 *  above the stroke's bottom. A top on the ground is layer 0, which only water at ground level, and in
 *  the planet session bare ground, give up. */
function reaches(cell: MacroCell | null, start: number, ctx: CurveToolContext): boolean {
  const top = surfaceElevation(cell?.terrain);
  return top === start || (top < start && top > bottomOf(start, ctx));
}

/** Erases only the selected surface, from the layer the press starts on down by the armed thickness,
 *  with one undo entry per gesture. */
export class EraserTool implements Tool<GridId, CurveToolContext> {
  readonly id = ToolType.Eraser;
  magnifies(): boolean { return true; }
  cursor(): CursorId { return 'eraser'; }
  grid(ctx: Pick<CurveToolContext, 'arming'>): GridId { return CONTENT_GRID[ctx.arming.contentType]; }

  canActAt(coord: MacroCoord, ctx: CurveToolContext): boolean {
    if (ctx.arming.contentType === 'road') {
      return overlappingCoatings(
        ctx.state, [coord], coatingLayer(getCatalogItem(ctx.arming.tileMaterial)),
      ).every(obj => ctx.validateCommand(removeObjectCommand(obj)).length === 0);
    }
    const cell = getCell(ctx.state.cells, coord.x, coord.y);
    if (this.start !== null && !reaches(cell, this.start, ctx)) return true;
    const ground = groundPeel(coord, cell, ctx);
    if (ground !== undefined) return !ground || ctx.validateCommand(ground).length === 0;
    if (!cell?.terrain || ctx.arming.layerVisibility[cell.terrain.elevation] === false || !erasesHere(cell.terrain.type, ctx)) return true;
    const cmd = peelCommand(coord.x, coord.y, cell, { waterEraser: ctx.arming.contentType === 'water' });
    return !cmd || ctx.validateCommand(cmd).length === 0;
  }

  private card(coord: MacroCoord, ctx: CurveToolContext): PreviewCell {
    return { icon: 'eraser', valid: this.canActAt(coord, ctx) };
  }

  private erasing = false;
  /** The open stroke, begun at each press. */
  private stroke: Stroke | null = null;
  /** The top of the cell the gesture in progress started on (its press, a curve's first anchor), the
   *  highest layer it takes; null between gestures, when a probe asks as a fresh press would. */
  private start: number | null = null;
  private strokeCells = new Set<string>();
  /** The press in progress: a freehand drag, a dragged figure, or the curve's anchor chain. */
  private readonly gesture = new ShapeGesture();
  private draftContext: { state: GridState; content: ContentType } | null = null;
  private get chain() { return this.gesture.chain; }

  onPointerDown(coord: GridCell, _point: MapPoint, ctx: CurveToolContext): void {
    this.refreshDraft(ctx);
    if (ctx.curve.isOpen()) { ctx.curve.end(); if (ctx.arming.eraserShape === 'curve') return; }
    if (ctx.arming.eraserShape !== 'curve' || this.chain.length === 0) {
      this.start = surfaceLayerAt(coord, ctx);
      showStrokeLayer(this.start, ctx);
    }
    if (ctx.arming.eraserShape === 'curve') {
      this.draftContext = { state: ctx.state, content: ctx.arming.contentType };
      this.erasing = true;
      this.chain.down(coord);
      this.previewCurve(coord, ctx);
      return;
    }
    this.erasing = true;
    this.stroke = ctx.beginStroke();
    this.strokeCells.clear();
    if (ctx.arming.eraserShape !== 'free') {
      this.gesture.drag.begin(coord);
      return;
    }
    this.gesture.beginFree(coord);
    this.eraseAt(brushCells(coord.x, coord.y, ctx.arming.brushSize), ctx);
  }

  onPointerMove(coord: GridCell, _point: MapPoint, ctx: CurveToolContext): void {
    this.refreshDraft(ctx);
    if (ctx.curve.isOpen()) { ctx.overlay.clearGhost(); return; }
    const shape = ctx.arming.eraserShape;
    const shown = this.gesture.ghost(coord, shape, ctx.arming.brushSize, ctx.modifiers.constrain);
    if ('cells' in shown) ctx.overlay.showGhost(cellSet(this.grid(ctx), shown.cells), this.card(shown.at, ctx));
    else ctx.overlay.showGhostSpans(shown.spans, this.card(shown.at, ctx), this.grid(ctx));
    if (shape !== 'free') return;
    const band = this.gesture.sweep(coord, ctx.arming.brushSize);
    if (band) this.eraseAt(band, ctx);
  }

  onPointerUp(coord: GridCell, _point: MapPoint, ctx: CurveToolContext): void {
    this.refreshDraft(ctx);
    if (!this.erasing) return;
    if (ctx.arming.eraserShape === 'curve') {
      this.erasing = false;
      if (this.chain.up(coord, ctx.eventTime, ctx.doubleTapMs) === 'finish') this.commitCurve(ctx);
      else this.previewCurve(coord, ctx);
      return;
    }
    const shape = ctx.arming.eraserShape;
    const figure = shape === 'line' || shape === 'rect' || shape === 'circle'
      ? this.gesture.releaseFigure(coord, shape, ctx.arming.brushSize, ctx.modifiers.constrain) : null;
    const last = this.gesture.endFree();
    if (figure) this.eraseAt(figure.cells, ctx);
    else if (last) this.eraseAt(expandLine(line4(last.x, last.y, coord.x, coord.y), ctx.arming.brushSize), ctx);
    const violations = this.stroke ? finishEraserStroke(ctx, this.stroke) : [];
    if (violations[0]) ctx.notify(violationToast(ctx.t, violations[0]), 'warning');
    this.reset(); ctx.overlay.clearGhost();
  }

  private previewCurve(coord: MacroCoord, ctx: CurveToolContext): void {
    ctx.overlay.showGhost(cellSet(this.grid(ctx), splineCells([...this.chain.points, coord], ctx.arming.brushSize)), this.card(coord, ctx));
  }

  private commitCurve(ctx: CurveToolContext): void {
    const anchors = this.chain.points.map(p => ({ ...p }));
    const start = this.start ?? surfaceLayerAt(anchors[0]!, ctx);
    const stroke = ctx.beginStroke();
    this.strokeCells.clear();
    this.eraseAt(splineCells(anchors, ctx.arming.brushSize), ctx, start);
    const violations = finishEraserStroke(ctx, stroke);
    this.reset(); ctx.overlay.clearGhost();
    if (violations.length) {
      stroke.rollback();
      ctx.notify(violationToast(ctx.t, violations[0]!), 'warning');
    } else {
      const preimage = new StrokePreimage();
      preimage.record(stroke.entries());
      adjustErasedCurve(anchors, preimage, ctx, (cells, frozen) => { this.strokeCells.clear(); this.eraseAt(cells, frozen, start); });
    }
  }

  private refreshDraft(ctx: CurveToolContext): void {
    if (this.draftContext && (ctx.arming.eraserShape !== 'curve' || ctx.arming.contentType !== this.draftContext.content || ctx.state !== this.draftContext.state)) {
      this.reset(); ctx.overlay.clearGhost();
    }
  }

  hasPending(ctx: CurveToolContext): boolean { this.refreshDraft(ctx); return this.chain.length > 0; }

  undoPendingStep(ctx: CurveToolContext): boolean {
    this.refreshDraft(ctx);
    if (!this.chain.undoStep()) return false;
    const last = this.chain.points[this.chain.length - 1];
    if (last) this.previewCurve(last, ctx); else ctx.overlay.clearGhost();
    return true;
  }

  cancelPending(ctx: CurveToolContext): boolean {
    if (this.gesture.drag.active || this.chain.length) { this.reset(); ctx.overlay.clearGhost(); return true; }
    if (ctx.curve.isOpen()) { ctx.curve.end(); return true; }
    return false;
  }

  /** The press never happened: a stroke's erasures are taken back without a redo step, and a curve
   *  keeps the anchors it had before this press, as the brush's does. */
  onPointerCancel(ctx: CurveToolContext): void {
    ctx.overlay.clearGhost();
    if (this.chain.length) { this.chain.cancelPress(); this.erasing = false; return; }
    if (this.erasing) this.stroke?.rollback();
    this.reset();
  }

  onActivate(_ctx: CurveToolContext): void { this.reset(); }
  onDeactivate(ctx: CurveToolContext): void { ctx.curve.end(); this.reset(); ctx.overlay.clearGhost(); }

  private reset(): void {
    this.erasing = false; this.gesture.clear(); this.strokeCells.clear();
    this.draftContext = null; this.start = null;
  }

  /** Lowers the cells a stroke started on `start` reaches (`reaches`) to its bottom, a layer at a time
   *  through the peel, stopping at a refusal or a top on a hidden layer. Terrain peels before ground
   *  peels: a block bleeds onto the ground up and left of it, so that ground can only become sea once
   *  the dab has peeled the block away. */
  private eraseAt(cells: MacroCoord[], ctx: CurveToolContext, start = this.start ?? 0): void {
    if (ctx.arming.contentType === 'road') { eraseTileCells(cells, ctx); return; }
    const bottom = bottomOf(start, ctx);
    const waterEraser = ctx.arming.contentType === 'water';
    const bare: MacroCoord[] = [];
    for (const c of cells) {
      const key = cellKey(c.x, c.y);
      if (this.strokeCells.has(key)) continue;
      const cell = getCell(ctx.state.cells, c.x, c.y);
      if (!reaches(cell, start, ctx)) continue;
      if (groundPeel(c, cell, ctx) !== undefined) { bare.push(c); continue; }
      this.strokeCells.add(key);
      for (let step = 0, now = cell; step < depthOf(ctx) && now?.terrain; step++, now = getCell(ctx.state.cells, c.x, c.y)) {
        const hidden = ctx.arming.layerVisibility[now.terrain.elevation] === false;
        if ((step > 0 && surfaceElevation(now.terrain) <= bottom) || !erasesHere(now.terrain.type, ctx) || hidden) break;
        const cmd = peelCommand(c.x, c.y, now, { waterEraser });
        if (!cmd || !ctx.execute(cmd).success) break;
      }
    }
    for (const c of bare) {
      const ground = groundPeel(c, getCell(ctx.state.cells, c.x, c.y), ctx);
      if (!ground) continue;
      this.strokeCells.add(cellKey(c.x, c.y));
      ctx.execute(ground);
    }
  }
}
