/**
 * The erase verb of the notes tool: it subtracts cells from every zone it crosses (a zone emptied this
 * way is removed) and deletes a chip, route or measurement it presses. It takes the road eraser's
 * shapes (`ctx.arming.eraserShape`): the free brush erases as it moves, a line, rectangle or circle on
 * release, and the curve lays anchors until a press back on the last one.
 */
import type { MacroCoord } from '../../../core/model/types';
import { removeZoneCells, zoneCellAt, zoneCellSet } from '../../../core/model/annotations';
import { splineCells } from '../../../core/grid/shapes';
import { cellKey } from '../../../core/grid/rect';
import type { AnnotateContext } from './channel';
import { annotationInkScale, routeHitDistCells } from '../../../core/model/annotation/text-metrics';
import { hitAt } from './note-hits';
import { figureCells, finePoint, footprint, layerEditable, run } from './note-edits';

export class EraseGesture {
  /** A stroke in progress: whether it has opened its undo step, the cell it last reached, and for a
   *  line, rectangle or circle the cell the drag began on. */
  private stroke: { began: boolean; last: MacroCoord; anchor: MacroCoord | null } | null = null;
  /** The curve eraser's anchors so far. */
  private anchors: MacroCoord[] = [];

  get stroking(): boolean { return this.stroke !== null; }
  /** Where a figure's drag began, while one is down. */
  get figureAnchor(): MacroCoord | null { return this.stroke?.anchor ?? null; }
  get curveAnchors(): readonly MacroCoord[] { return this.anchors; }

  down(p: MacroCoord, ctx: AnnotateContext): void {
    if (!layerEditable(ctx)) return;
    const shape = ctx.arming.eraserShape;
    const hit = this.anchors.length ? null : hitAt(p, ctx);
    if (hit && hit.kind !== 'zone') { ctx.annotationEdit.remove(hit.id); return; }
    const cell = zoneCellAt(p);
    if (shape === 'curve') { this.curvePress(cell, ctx); return; }
    this.stroke = { began: false, last: cell, anchor: shape === 'free' ? null : cell };
    if (shape === 'free') this.erase(footprint(cell, ctx), ctx);
  }

  /** The free eraser takes the run between samples; a figure waits for its release. */
  move(p: MacroCoord, ctx: AnnotateContext): void {
    const e = this.stroke!;
    if (e.anchor) return;
    const cell = zoneCellAt(p);
    if (cell.x === e.last.x && cell.y === e.last.y) return;
    this.erase(run(e.last, cell, ctx), ctx);
    e.last = cell;
  }

  /** Ends the stroke, laying a figure's cells where the drag was released. */
  up(coord: MacroCoord, ctx: AnnotateContext): void {
    const anchor = this.stroke?.anchor;
    const shape = ctx.arming.eraserShape;
    if (anchor && shape !== 'free' && shape !== 'curve') {
      this.erase(figureCells(shape, anchor, zoneCellAt(finePoint(coord, ctx)), ctx), ctx);
      ctx.overlay.clearGhost();
    }
    this.stroke = null;
  }

  /** Takes back the newest curve anchor; false when there is none. */
  undoAnchor(): boolean {
    if (this.anchors.length === 0) return false;
    this.anchors = this.anchors.slice(0, -1);
    return true;
  }

  dropStroke(): void { this.stroke = null; }

  dropAnchors(): void { this.anchors = []; }

  /** A press back on the last curve anchor takes the band away as one undo step. */
  private curvePress(cell: MacroCoord, ctx: AnnotateContext): void {
    const last = this.anchors[this.anchors.length - 1];
    if (!last || Math.hypot(cell.x - last.x, cell.y - last.y) > routeHitDistCells(annotationInkScale(ctx.state.template))) {
      this.anchors = [...this.anchors, cell];
      return;
    }
    const anchors = this.anchors;
    this.anchors = [];
    this.stroke = { began: false, last: cell, anchor: null };
    this.erase(anchors.length === 1 ? footprint(anchors[0]!, ctx) : splineCells(anchors, ctx.arming.brushSize), ctx);
    this.stroke = null;
    ctx.overlay.clearGhost();
  }

  /** Subtract `gone` from every zone it crosses, and from the draft. */
  private erase(gone: MacroCoord[], ctx: AnnotateContext): void {
    const goneSet = zoneCellSet(gone);
    const touches = (cells: readonly MacroCoord[]): boolean => cells.some((c) => goneSet.has(cellKey(c.x, c.y)));
    const d = ctx.arming.notes.draft;
    const draftTouched = d?.kind === 'zone' && touches(d.cells);
    const items = ctx.state.annotations?.items ?? [];
    if (!draftTouched && !items.some((n) => n.kind === 'zone' && touches(n.cells))) return;
    if (!this.stroke!.began) { this.stroke!.began = true; ctx.annotationEdit.begin(); }
    if (draftTouched) ctx.annotationEdit.setDraft({ ...d, cells: removeZoneCells(d.cells, gone) });
    ctx.annotationEdit.apply((data) => {
      data.items = data.items
        .map((n) => (n.kind === 'zone' && touches(n.cells) ? { ...n, cells: removeZoneCells(n.cells, gone) } : n))
        .filter((n) => n.kind !== 'zone' || n.cells.length > 0);
    });
  }
}
