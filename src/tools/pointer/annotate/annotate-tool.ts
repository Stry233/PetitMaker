/**
 * The plan-notes tool: everything a pointer does while the annotation layer is being edited.
 *
 * The active verb comes from `ctx.arming.annotationTool`:
 *
 * - zone paints cells. A stroke that begins on an existing zone edits that zone in place; a stroke
 *   on open ground grows the draft, which gathers strokes until Done commits it with the armed
 *   tag. A press that lands on a zone and does not move selects it.
 * - erase subtracts cells from zones and deletes the other notes it presses (`erase-gesture.ts`).
 * - chip selects an existing tag near the press, or drops a plate on open ground (`chip-gesture.ts`).
 * - route draws with a drag or by waypoints, and adjusts a route it presses (`route-gesture.ts`).
 * - none selects; a subsequent press on a selected note can drag the selection.
 * - measure counts inclusive cell extents between two taps or a drag's endpoints (`measure-gesture.ts`).
 *
 * Everything speaks cell coordinates, so the tool is view-agnostic exactly as the map tools are.
 * Brush and eraser lay the road brush's footprint (`brushCells`, `dragShapeCells`, `splineCells`),
 * so size N is an N-cell band on every template.
 * A hidden or locked layer refuses every edit with a toast; selection still works under a lock.
 */
import type { MacroCoord } from '../../../core/model/types';
import { ToolType } from '../../../state/editing/vocabulary';
import { addZoneCells, generateAnnotationId, nextZoneNumber, zoneCellAt, type MapAnnotation, type ZoneNote } from '../../../core/model/annotations';
import { annotationInkScale, routeHitDistCells } from '../../../core/model/annotation/text-metrics';
import { splineCells, type DragShapeKind } from '../../../core/grid/shapes';
import type { Rect } from '../../../core/grid/rect';
import { annotationsInRect } from '../../../core/model/annotation/geometry';
import type { CursorId } from '../../../assets/cursors/cursor-spec';
import type { Tool } from '../runtime/types';
import type { AnnotateContext } from './channel';
import { PLACEMENT_GRID } from '../../../core/game/profile';
import { gridCell, mapPoint, type GridCell, type MapPoint, cellSet } from '../../../core/grid/grids';
import { chipAt, hitAt, zoneBodyAt } from './note-hits';
import { CLICK_SLOP, copyNote, figureCells, finePoint, footprint, layerEditable, movedBy, run } from './note-edits';
import { RouteGesture } from './route-gesture';
import { EraseGesture } from './erase-gesture';
import { MeasureGesture } from './measure-gesture';
import { ChipGesture } from './chip-gesture';

/** One zone stroke: which note it writes into, and the cells that stood before it began. */
interface ZoneStroke {
  /** The existing zone the press landed on, or null for the draft. */
  zoneId: string | null;
  base: MacroCoord[];
  /** Cells the free brush has laid so far, growing per move. */
  painted: MacroCoord[];
  /** The cell the free brush last reached, so a fast move lays the whole run between samples. */
  last: MacroCoord;
  moved: boolean;
  start: MacroCoord;
}

export class AnnotateTool implements Tool<typeof PLACEMENT_GRID, AnnotateContext> {
  id = ToolType.Annotate;
  grid(): typeof PLACEMENT_GRID { return PLACEMENT_GRID; }

  private stroke: ZoneStroke | null = null;
  private historyEpoch: number | undefined;
  /** A drag figure in progress (line/rect/circle): where the drag began. */
  private zoneAnchor: MacroCoord | null = null;
  /** The curve figure's anchors so far, the draft they belong to, and the draft cells that stood
   *  before the band began so each new anchor re-lays the whole band. */
  private curveAnchors: MacroCoord[] = [];
  private curveDraftId: string | null = null;
  private curveBase: MacroCoord[] = [];
  private readonly route = new RouteGesture();
  private readonly erase = new EraseGesture();
  private readonly measure = new MeasureGesture();
  private readonly chip = new ChipGesture((p, ctx, hit) => this.selectDown(p, ctx, hit));
  /** A move drag armed by a press on a selected note: the whole selection rides it, each note
   *  applied from its original so wobble cannot accumulate. */
  private drag: { start: MacroCoord; origs: MapAnnotation[]; began: boolean } | null = null;

  cursor(ctx: AnnotateContext): CursorId {
    switch (ctx.arming.annotationTool) {
      case 'erase': return 'eraser';
      case 'none': return 'select';
      default: return 'place';
    }
  }

  canActAt(_coord: MacroCoord, ctx: AnnotateContext): boolean {
    if (ctx.arming.annotationTool === 'none') return true;
    return ctx.state.annotations == null || (ctx.state.annotations.visible && !ctx.state.annotations.locked);
  }

  /** Only a note selected before this press can start a move. */
  grabAt(coord: MacroCoord, ctx: AnnotateContext): boolean {
    return !ctx.state.annotations?.locked && this.selectHit(coord, ctx)?.selected === true;
  }

  selects(ctx: AnnotateContext): boolean {
    return (ctx.arming.annotationTool === 'none' || ctx.arming.annotationTool === 'chip') && ctx.state.annotations?.visible !== false;
  }

  /** Chip and selection modes move only a note selected before the press; curve figures place
   *  anchors by click. A drag from any of these moves the map. */
  clickOnly(coord: MacroCoord, ctx: AnnotateContext): boolean {
    const a = ctx.arming;
    return ((a.annotationTool === 'chip' || a.annotationTool === 'none') && !this.grabAt(coord, ctx))
      || (a.annotationTool === 'zone' && a.annotationZoneShape === 'curve')
      || (a.annotationTool === 'erase' && a.eraserShape === 'curve');
  }

  /** The notes' own band: membership by drawn ink, additive like the object band. */
  bandSelect(rect: Rect, ctx: AnnotateContext): void {
    const selection = ctx.arming.notes.selection;
    const additions = annotationsInRect(rect, ctx.state.annotations?.items ?? []).filter((id) => !selection.includes(id));
    if (additions.length > 0) ctx.annotationEdit.select([...selection, ...additions]);
  }

  selectHit(coord: MacroCoord, ctx: AnnotateContext): { id: string; selected: boolean } | null {
    if (!this.selects(ctx)) return null;
    const p = finePoint(coord, ctx);
    const hit = ctx.arming.annotationTool === 'chip' ? chipAt(p, ctx) : hitAt(p, ctx);
    return hit ? { id: hit.id, selected: ctx.arming.notes.selection.includes(hit.id) } : null;
  }

  /** Routes, curves and measurements can await another point; zone strokes await Done. */
  hasPending(ctx: AnnotateContext): boolean {
    if (ctx.arming.notes.draft?.kind === 'route' || ctx.arming.notes.draft?.kind === 'measure') return true;
    if (this.erase.curveAnchors.length > 0) return true;
    return ctx.arming.notes.draft?.kind === 'zone' && this.curveAnchors.length > 0;
  }

  cancelPending(ctx: AnnotateContext): boolean {
    const pending = !!(ctx.curve.isOpen() || ctx.arming.notes.draft || this.stroke || this.route.dragging || this.erase.stroking
      || this.drag || this.erase.curveAnchors.length);
    this.onDeactivate(ctx);
    if (ctx.arming.notes.draft) ctx.annotationEdit.setDraft(null);
    return pending;
  }

  undoPendingStep(ctx: AnnotateContext): boolean {
    if (this.erase.undoAnchor()) {
      ctx.overlay.clearGhost();
      return true;
    }
    if (this.measure.undoStep(ctx)) return true;
    const d = ctx.arming.notes.draft;
    if (!d || d.kind !== 'route') return false;
    ctx.annotationEdit.begin();
    if (d.points.length <= 1) ctx.annotationEdit.setDraft(null);
    else ctx.annotationEdit.setDraft({ ...d, points: d.points.slice(0, -1) });
    return true;
  }

  onPointerDown(coord: GridCell<typeof PLACEMENT_GRID>, _point: MapPoint, ctx: AnnotateContext): void {
    this.syncHistory(ctx);
    ctx.overlay.clearGhost();
    if (ctx.arming.notes.discardPending) { ctx.overlay.clearGhost(); this.resetGestures(ctx); return; }
    const p = finePoint(coord, ctx);
    // A finished route's handles stand until a press lands elsewhere.
    if (ctx.curve.isOpen()) {
      ctx.curve.end();
      ctx.annotationEdit.select([]);
      return;
    }
    switch (ctx.arming.annotationTool) {
      case 'zone': this.zoneDown(p, ctx); return;
      case 'chip': this.chip.down(p, ctx); return;
      case 'route': this.route.down(finePoint(coord, ctx), ctx); return;
      case 'measure': this.measure.down(p, ctx); return;
      case 'erase': this.erase.down(p, ctx); return;
      case 'none': this.selectDown(p, ctx); return;
    }
  }

  onPointerMove(coord: GridCell<typeof PLACEMENT_GRID>, _point: MapPoint, ctx: AnnotateContext): void {
    this.syncHistory(ctx);
    if (ctx.arming.notes.discardPending) { ctx.overlay.clearGhost(); this.resetGestures(ctx); return; }
    this.discardInactiveGestures(ctx);
    const p = finePoint(coord, ctx);
    this.preview(p, ctx);
    if (ctx.arming.annotationTool === 'measure' && ctx.arming.notes.draft?.kind === 'measure') { this.measure.move(p, ctx); return; }
    if (this.stroke) { this.zoneMove(p, ctx); return; }
    if (this.route.dragging) { this.route.move(p, ctx); return; }
    if (this.erase.stroking) { this.erase.move(p, ctx); return; }
    if (this.drag) this.dragMove(p, ctx);
  }

  onPointerUp(_coord: GridCell<typeof PLACEMENT_GRID>, _point: MapPoint, ctx: AnnotateContext): void {
    this.syncHistory(ctx);
    if (ctx.arming.notes.discardPending) { ctx.overlay.clearGhost(); this.resetGestures(ctx); return; }
    this.discardInactiveGestures(ctx);
    if (this.stroke) this.zoneUp(ctx);
    if (this.route.dragging) this.route.up(finePoint(_coord, ctx), ctx);
    this.measure.up(finePoint(_coord, ctx), ctx);
    this.erase.up(_coord, ctx);
    this.drag = null;
  }

  onPointerCancel(ctx: AnnotateContext): void {
    ctx.overlay.clearGhost();
    if (!this.measure.cancel(ctx)) this.onPointerUp(gridCell(PLACEMENT_GRID, { x: 0, y: 0 }), mapPoint({ x: 0, y: 0 }), ctx);
  }

  onActivate(_ctx: AnnotateContext): void {}

  private discardInactiveGestures(ctx: AnnotateContext): void {
    if (ctx.arming.annotationTool !== 'zone') { this.stroke = null; this.zoneAnchor = null; }
    if (ctx.arming.annotationTool !== 'route') this.route.drop();
    if (ctx.arming.annotationTool !== 'measure') this.measure.drop();
    if (ctx.arming.annotationTool !== 'erase') this.erase.dropStroke();
    if (ctx.arming.annotationTool !== 'erase' || ctx.arming.eraserShape !== 'curve') this.erase.dropAnchors();
    if (!this.selects(ctx)) this.drag = null;
  }

  private resetGestures(ctx: AnnotateContext): void {
    ctx.curve.end();
    this.stroke = null;
    this.zoneAnchor = null;
    this.curveAnchors = [];
    this.curveDraftId = null;
    this.route.drop();
    this.measure.drop();
    this.erase.dropStroke();
    this.erase.dropAnchors();
    this.drag = null;
  }

  private syncHistory(ctx: AnnotateContext): void {
    if (this.historyEpoch !== ctx.arming.notes.historyEpoch) this.resetGestures(ctx);
    this.historyEpoch = ctx.arming.notes.historyEpoch;
  }

  onDeactivate(ctx: AnnotateContext): void {
    ctx.overlay.clearGhost();
    this.resetGestures(ctx);
  }

  private preview(p: MacroCoord, ctx: AnnotateContext): void {
    if (ctx.state.annotations?.visible === false || ctx.state.annotations?.locked || this.drag || ctx.curve.isOpen()) {
      ctx.overlay.clearGhost();
      return;
    }
    if (ctx.arming.annotationTool !== 'zone' && ctx.arming.annotationTool !== 'erase') {
      ctx.overlay.clearGhost();
      return;
    }
    const erase = ctx.arming.annotationTool === 'erase';
    const shape = erase ? ctx.arming.eraserShape : ctx.arming.annotationZoneShape;
    const cell = zoneCellAt(p);
    let cells: MacroCoord[];
    if (shape === 'curve') {
      const anchors = erase ? this.erase.curveAnchors : ctx.arming.notes.draft?.id === this.curveDraftId ? this.curveAnchors : [];
      cells = anchors.length ? splineCells([...anchors, cell], ctx.arming.brushSize) : footprint(cell, ctx);
    } else if (shape === 'free') cells = footprint(cell, ctx);
    else if (erase) {
      const anchor = this.erase.figureAnchor;
      cells = anchor ? figureCells(shape, anchor, cell, ctx) : shape === 'line' ? footprint(cell, ctx) : [cell];
    } else cells = figureCells(shape, this.zoneAnchor ?? cell, cell, ctx);
    ctx.overlay.showGhost(cellSet(this.grid(), cells), { icon: erase ? 'eraser' : null, valid: true });
  }

  /* ── zone ─────────────────────────────────────────────────────────────── */

  private zoneDown(p: MacroCoord, ctx: AnnotateContext): void {
    if (!layerEditable(ctx)) return;
    const shape = ctx.arming.annotationZoneShape;
    if (shape === 'curve') { this.curvePress(p, ctx); return; }
    const target = zoneBodyAt(zoneCellAt(p), ctx);
    // A press elsewhere while notes stand selected clears the selection; the stroke still lands.
    if (ctx.arming.notes.selection.length > 0 && !(target && ctx.arming.notes.selection.includes(target.id))) {
      ctx.annotationEdit.select([]);
    }
    const base = target ? target.cells : this.draftZone(ctx).cells;
    const cell = zoneCellAt(p);
    this.stroke = { zoneId: target?.id ?? null, base, painted: [], last: cell, moved: false, start: p };
    if (shape !== 'free') this.zoneAnchor = cell;
    // On open ground a press paints at once, so a tap leaves a dab; on a zone it waits to learn
    // whether it is a click (select) or a drag (extend).
    if (!target) {
      ctx.annotationEdit.begin();
      if (shape === 'free') this.stroke.painted = footprint(cell, ctx);
      this.writeStroke(shape === 'free' ? this.stroke.painted : this.zoneFigure(p, ctx), ctx);
    }
  }

  private zoneMove(p: MacroCoord, ctx: AnnotateContext): void {
    const s = this.stroke!;
    if (!s.moved) {
      if (Math.hypot(p.x - s.start.x, p.y - s.start.y) < CLICK_SLOP) return;
      s.moved = true;
      // Existing zones begin history only after the press becomes a paint stroke.
      if (s.zoneId) ctx.annotationEdit.begin();
      if (ctx.arming.annotationZoneShape === 'free') s.painted = footprint(s.last, ctx);
    }
    if (ctx.arming.annotationZoneShape === 'free') {
      const cell = zoneCellAt(p);
      s.painted = addZoneCells(s.painted, run(s.last, cell, ctx));
      s.last = cell;
      this.writeStroke(s.painted, ctx);
    } else {
      this.writeStroke(this.zoneFigure(p, ctx), ctx);
    }
  }

  private zoneUp(ctx: AnnotateContext): void {
    const s = this.stroke!;
    this.stroke = null;
    this.zoneAnchor = null;
    // A click on a zone is how it is selected under any brush.
    if (s.zoneId && !s.moved) ctx.annotationEdit.select([s.zoneId]);
  }

  /** Lay `cells` over the stroke's base into its target: the zone in place, or the draft. */
  private writeStroke(cells: MacroCoord[], ctx: AnnotateContext): void {
    const s = this.stroke!;
    const merged = addZoneCells(s.base, cells);
    if (s.zoneId) {
      const id = s.zoneId;
      ctx.annotationEdit.apply((data) => {
        const i = data.items.findIndex((n) => n.id === id);
        if (i >= 0 && data.items[i]!.kind === 'zone') data.items[i] = { ...(data.items[i] as ZoneNote), cells: merged };
      });
      return;
    }
    ctx.annotationEdit.setDraft({ ...this.draftZone(ctx), cells: merged });
  }

  /** The standing zone draft, or a fresh one wearing the armed tag, color and size. */
  private draftZone(ctx: AnnotateContext): ZoneNote {
    const d = ctx.arming.notes.draft;
    if (d?.kind === 'zone') return d;
    return {
      kind: 'zone', id: generateAnnotationId(), cells: [],
      color: ctx.arming.annotationColor, tag: ctx.arming.annotationTag, num: nextZoneNumber(ctx.state.annotations?.items ?? []),
      size: ctx.arming.annotationSize,
    };
  }

  /** The zone drag figure's cells, from the anchor to the pointer. Cells are captured on the
   *  zone's drawn grid so the figure lands under the cursor. */
  private zoneFigure(p: MacroCoord, ctx: AnnotateContext): MacroCoord[] {
    const cell = zoneCellAt(p);
    return figureCells(ctx.arming.annotationZoneShape as DragShapeKind, this.zoneAnchor ?? cell, cell, ctx);
  }

  /** The curve figure: presses lay anchors into the draft; a press back on the last one closes the
   *  band and leaves the draft standing for Done. */
  private curvePress(p: MacroCoord, ctx: AnnotateContext): void {
    const draft = this.draftZone(ctx);
    if (this.curveDraftId !== draft.id) { this.curveAnchors = []; this.curveDraftId = draft.id; }
    const cell = zoneCellAt(p);
    const last = this.curveAnchors[this.curveAnchors.length - 1];
    if (last && Math.hypot(cell.x - last.x, cell.y - last.y) <= routeHitDistCells(annotationInkScale(ctx.state.template))) {
      this.curveAnchors = [];
      return;
    }
    ctx.annotationEdit.begin();
    if (this.curveAnchors.length === 0) this.curveBase = draft.cells;
    this.curveAnchors = [...this.curveAnchors, cell];
    const band = this.curveAnchors.length === 1
      ? footprint(this.curveAnchors[0]!, ctx)
      : splineCells(this.curveAnchors, ctx.arming.brushSize);
    ctx.annotationEdit.setDraft({ ...draft, cells: addZoneCells(this.curveBase, band) });
  }

  /* ── select ───────────────────────────────────────────────────────────── */

  private selectDown(p: MacroCoord, ctx: AnnotateContext, hit = ctx.state.annotations?.visible ? hitAt(p, ctx) : null): void {
    const wasSelected = hit !== null && ctx.arming.notes.selection.includes(hit.id);
    // Ctrl toggles the note in and out of the set; a toggle never arms a drag.
    if (ctx.modifiers.multiSelect) {
      if (hit) {
        const cur = ctx.arming.notes.selection;
        ctx.annotationEdit.select(cur.includes(hit.id) ? cur.filter((i) => i !== hit.id) : [...cur, hit.id]);
      }
      this.drag = null;
      return;
    }
    // A plain press on a member keeps the standing set (and drags it whole); anywhere else it
    // collapses to the note under the press, or to nothing.
    const ids = hit
      ? (ctx.arming.notes.selection.includes(hit.id) ? ctx.arming.notes.selection : [hit.id])
      : [];
    ctx.annotationEdit.select(ids);
    const items = ctx.state.annotations?.items ?? [];
    const origs = ids.map((id) => items.find((n) => n.id === id)).filter((n): n is MapAnnotation => !!n);
    this.drag = wasSelected && !ctx.state.annotations?.locked ? { start: p, origs: origs.map(copyNote), began: false } : null;
  }

  private dragMove(p: MacroCoord, ctx: AnnotateContext): void {
    const drag = this.drag!;
    const dx = p.x - drag.start.x;
    const dy = p.y - drag.start.y;
    if (!drag.began) {
      if (Math.abs(dx) + Math.abs(dy) < CLICK_SLOP) return;
      if (!layerEditable(ctx)) { this.drag = null; return; }
      ctx.annotationEdit.begin();
      drag.began = true;
    }
    ctx.annotationEdit.apply((data) => {
      for (const orig of drag.origs) {
        const i = data.items.findIndex((n) => n.id === orig.id);
        if (i >= 0) data.items[i] = movedBy(orig, dx, dy);
      }
    });
  }

}
