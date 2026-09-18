import { TerrainType, ToolType } from '../../core/model/types';
import type { GridState, MacroCoord, MicroCoord } from '../../core/model/types';
import type { Tool, ToolContext } from '../runtime/types';
import type { PreviewCell } from '../../core/runtime/preview-cell';
import type { CursorId } from '../../core/runtime/cursor-spec';
import { brushCells } from './drawing-tool';
import { dragShapeCells, dragShapeSpans, expandLine, line4, snapShapeEnd, splineCells } from './shapes';
import { isConstrainHeld } from '../../core/runtime/modifier-state';
import { showToast } from '../../core/runtime/toast-bus';
import { cloneGridState, getCell } from '../../core/model/grid-model';
import type { ContentType } from '../../core/model/edit-mode';
import { peelCommand } from './terrain-peel';
import { eraseTileCells } from './tile-coating';
import { overlappingCoatings, removeObjectCommand } from '../objects/object-placer';
import { endCurveSession, isCurveSessionOpen } from './curve-session';
import { adjustErasedCurve } from './eraser-curve';
import { finishEraserStroke } from './eraser-stroke';
import type { CurveAnchor } from './shapes';

function erasesHere(type: TerrainType, surface: ContentType): boolean {
  if (surface === 'water') return type === TerrainType.Water;
  if (surface === 'mountain') return type === TerrainType.Mountain;
  return true;
}

/** Erases only the selected surface, with one undo entry per gesture. */
export class EraserTool implements Tool {
  readonly id = ToolType.Eraser;
  readonly cursor: CursorId = 'eraser';
  terrainGrid(ctx: ToolContext): boolean { return ctx.contentType !== 'tile'; }

  canActAt(coord: MacroCoord, ctx: ToolContext): boolean {
    if (ctx.contentType === 'tile') {
      return overlappingCoatings(ctx.gridState, [coord]).every(obj => ctx.validateCommand(removeObjectCommand(obj)).length === 0);
    }
    const cell = getCell(ctx.gridState.cells, coord.x, coord.y);
    if (!cell?.terrain || ctx.layerVisibility[cell.terrain.elevation] === false || !erasesHere(cell.terrain.type, ctx.contentType)) return true;
    const cmd = peelCommand(coord.x, coord.y, cell, ctx.contentType === 'water');
    return !cmd || ctx.validateCommand(cmd).length === 0;
  }

  private card(coord: MacroCoord, ctx: ToolContext): PreviewCell {
    return { icon: 'eraser', valid: this.canActAt(coord, ctx) };
  }

  private erasing = false;
  private lastCoord: MacroCoord | null = null;
  private strokeStartUndoSize = 0;
  private strokeCells = new Set<string>();
  private shapeOrigin: MacroCoord | null = null;
  private draftContext: { state: GridState; content: ContentType } | null = null;
  private curvePoints: CurveAnchor[] = [];
  private dragAnchor: number | null = null;
  private dragMoved = false;
  private lastClick: { coord: MacroCoord; at: number } | null = null;

  onPointerDown(coord: MacroCoord, _micro: MicroCoord, ctx: ToolContext): void {
    this.refreshDraft(ctx);
    if (isCurveSessionOpen()) { endCurveSession(); if (ctx.eraserShape === 'curve') return; }
    if (ctx.eraserShape === 'curve') {
      this.draftContext = { state: ctx.gridState, content: ctx.contentType };
      this.erasing = true;
      const hit = this.curvePoints.findIndex(p => p.x === coord.x && p.y === coord.y);
      if (hit >= 0) { this.dragAnchor = hit; this.dragMoved = false; }
      else this.curvePoints.push({ ...coord });
      this.previewCurve(coord, ctx);
      return;
    }
    this.erasing = true;
    this.lastCoord = coord;
    this.strokeStartUndoSize = ctx.getUndoStackSize();
    this.strokeCells.clear();
    if (ctx.eraserShape !== 'dot') {
      this.shapeOrigin = coord;
      return;
    }
    this.eraseAt(brushCells(coord.x, coord.y, ctx.brushSize), ctx);
  }

  onPointerMove(coord: MacroCoord, _micro: MicroCoord, ctx: ToolContext): void {
    this.refreshDraft(ctx);
    if (isCurveSessionOpen()) { ctx.overlay.clearGhost(); return; }
    const shape = ctx.eraserShape;
    const terrainGrid = this.terrainGrid(ctx);
    if (shape === 'curve' && this.curvePoints.length) {
      if (this.dragAnchor !== null) {
        const held = this.curvePoints[this.dragAnchor]!;
        this.dragMoved ||= held.x !== coord.x || held.y !== coord.y;
        this.curvePoints[this.dragAnchor] = { ...coord };
        ctx.overlay.showGhost(splineCells(this.curvePoints, ctx.brushSize), this.card(coord, ctx), terrainGrid);
      } else this.previewCurve(coord, ctx);
      return;
    }
    if (this.shapeOrigin && shape !== 'dot') {
      const end = this.shapeEnd(coord, ctx);
      if (shape === 'rect' || shape === 'circle') ctx.overlay.showGhostSpans(dragShapeSpans(shape, this.shapeOrigin, end), this.card(end, ctx), terrainGrid);
      else ctx.overlay.showGhost(this.shapeCells(end, ctx), this.card(end, ctx), terrainGrid);
      return;
    }
    ctx.overlay.showGhost(shape === 'rect' || shape === 'circle' ? [coord] : brushCells(coord.x, coord.y, ctx.brushSize), this.card(coord, ctx), terrainGrid);
    if (this.erasing && (coord.x !== this.lastCoord?.x || coord.y !== this.lastCoord?.y)) {
      const from = this.lastCoord ?? coord;
      this.lastCoord = coord;
      this.eraseAt(expandLine(line4(from.x, from.y, coord.x, coord.y), ctx.brushSize), ctx);
    }
  }

  onPointerUp(coord: MacroCoord, _micro: MicroCoord, ctx: ToolContext): void {
    this.refreshDraft(ctx);
    if (!this.erasing) return;
    if (ctx.eraserShape === 'curve') {
      this.erasing = false;
      const first = this.curvePoints[0]!;
      if (this.curvePoints.length === 1 && (first.x !== coord.x || first.y !== coord.y)) {
        this.curvePoints.push({ ...coord });
        this.lastClick = null;
        this.previewCurve(coord, ctx);
        return;
      }
      if (this.dragAnchor !== null) {
        this.dragAnchor = null;
        if (this.dragMoved) { this.lastClick = null; this.previewCurve(coord, ctx); return; }
      }
      const prev = this.lastClick;
      if (prev && performance.now() - prev.at <= 400 && prev.coord.x === coord.x && prev.coord.y === coord.y && this.curvePoints.length >= 2) {
        this.commitCurve(ctx);
      } else { this.lastClick = { coord: { ...coord }, at: performance.now() }; this.previewCurve(coord, ctx); }
      return;
    }
    const origin = this.shapeOrigin;
    const end = this.shapeEnd(coord, ctx);
    if (origin) this.eraseAt(this.shapeCells(end, ctx), ctx);
    else if (this.lastCoord) this.eraseAt(expandLine(line4(this.lastCoord.x, this.lastCoord.y, coord.x, coord.y), ctx.brushSize), ctx);
    const violations = finishEraserStroke(ctx, this.strokeStartUndoSize);
    if (violations[0]) showToast(ctx.t(violations[0].message), 'warning');
    this.reset(); ctx.overlay.clearGhost();
  }

  private previewCurve(coord: MacroCoord, ctx: ToolContext): void {
    ctx.overlay.showGhost(splineCells([...this.curvePoints, coord], ctx.brushSize), this.card(coord, ctx), this.terrainGrid(ctx));
  }

  private commitCurve(ctx: ToolContext): void {
    const anchors = this.curvePoints.map(p => ({ ...p }));
    const baseline = cloneGridState(ctx.gridState);
    const start = ctx.getUndoStackSize();
    this.strokeCells.clear();
    this.eraseAt(splineCells(anchors, ctx.brushSize), ctx);
    const violations = finishEraserStroke(ctx, start);
    this.reset(); ctx.overlay.clearGhost();
    if (violations.length) {
      ctx.rollbackTo(start);
      showToast(ctx.t(violations[0]!.message), 'warning');
    } else {
      adjustErasedCurve(anchors, baseline, ctx, (cells, frozen) => { this.strokeCells.clear(); this.eraseAt(cells, frozen); });
    }
  }

  private refreshDraft(ctx: ToolContext): void {
    if (this.draftContext && (ctx.eraserShape !== 'curve' || ctx.contentType !== this.draftContext.content || ctx.gridState !== this.draftContext.state)) {
      this.reset(); ctx.overlay.clearGhost();
    }
  }

  hasPending(ctx: ToolContext): boolean { this.refreshDraft(ctx); return this.curvePoints.length > 0; }

  undoPendingStep(ctx: ToolContext): boolean {
    this.refreshDraft(ctx);
    if (!this.curvePoints.length) return false;
    this.curvePoints.pop(); this.dragAnchor = null; this.lastClick = null;
    const last = this.curvePoints[this.curvePoints.length - 1];
    if (last) this.previewCurve(last, ctx); else ctx.overlay.clearGhost();
    return true;
  }

  private shapeEnd(coord: MacroCoord, ctx: ToolContext): MacroCoord {
    const shape = ctx.eraserShape;
    return this.shapeOrigin && isConstrainHeld() && (shape === 'line' || shape === 'rect' || shape === 'circle')
      ? snapShapeEnd(this.shapeOrigin, coord, shape) : coord;
  }

  private shapeCells(end: MacroCoord, ctx: ToolContext): MacroCoord[] {
    const origin = this.shapeOrigin!;
    return dragShapeCells(ctx.eraserShape === 'dot' || ctx.eraserShape === 'curve' ? 'line' : ctx.eraserShape, origin, end, ctx.brushSize);
  }

  cancelPending(ctx: ToolContext): boolean {
    if (this.shapeOrigin || this.curvePoints.length) { this.reset(); ctx.overlay.clearGhost(); return true; }
    if (isCurveSessionOpen()) { endCurveSession(); return true; }
    return false;
  }

  onPointerCancel(ctx: ToolContext): void {
    if (this.erasing && !this.curvePoints.length) ctx.rollbackTo(this.strokeStartUndoSize);
    this.reset(); ctx.overlay.clearGhost();
  }

  onActivate(_ctx: ToolContext): void { this.reset(); }
  onDeactivate(ctx: ToolContext): void { endCurveSession(); this.reset(); ctx.overlay.clearGhost(); }

  private reset(): void {
    this.erasing = false; this.lastCoord = null; this.shapeOrigin = null; this.strokeCells.clear();
    this.draftContext = null; this.curvePoints = []; this.dragAnchor = null; this.dragMoved = false; this.lastClick = null;
  }

  private eraseAt(cells: MacroCoord[], ctx: ToolContext): void {
    if (ctx.contentType === 'tile') { eraseTileCells(cells, ctx); return; }
    for (const c of cells) {
      const key = `${c.x},${c.y}`;
      if (this.strokeCells.has(key)) continue;
      const cell = getCell(ctx.gridState.cells, c.x, c.y);
      if (!cell?.terrain || !erasesHere(cell.terrain.type, ctx.contentType) || ctx.layerVisibility[cell.terrain.elevation] === false) continue;
      this.strokeCells.add(key);
      const cmd = peelCommand(c.x, c.y, cell, ctx.contentType === 'water');
      if (cmd) ctx.executeCommand(cmd);
    }
  }
}
