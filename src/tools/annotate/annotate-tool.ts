/**
 * The plan-notes tool: everything a pointer does while the annotation layer is being edited.
 *
 * The active verb comes from `ctx.annotationTool`:
 *
 * - ZONE paints cells. A stroke that begins on an existing zone edits that zone in place; a stroke
 *   on open ground grows the DRAFT, which gathers strokes until Done commits it with the armed
 *   tag. A press that lands on a zone and does not move selects it.
 * - ERASE subtracts cells from whatever zones it crosses (a zone emptied this way is removed) and
 *   deletes a chip or route it presses.
 * - CHIP selects an existing tag near the press, or drops a plate on open ground.
 * - ROUTE draws with a drag, simplified into editable anchors on release; a press that does not
 *   move lays a waypoint instead, and a press back on the last waypoint ends that route. A press
 *   near an existing route selects it and raises its handles.
 * - NONE selects; a subsequent press on a selected note can drag the selection.
 * - MEASURE counts inclusive cell extents between two taps or a drag's endpoints.
 *
 * Everything speaks CELL coordinates, so the tool is view-agnostic exactly as the map tools are.
 * A hidden or locked layer refuses every edit with a toast; selection still works under a lock.
 */
import type { MacroCoord, MicroCoord } from '../../core/model/types';
import { ToolType } from '../../core/model/types';
import {
  addZoneCells, annotationInkScale, chipApproxHeightCells, chipApproxWidthCells, generateAnnotationId,
  INK_CELLS, nextZoneNumber, removeZoneCells, routeHitDistCells, routeSamples, simplifyPath, zoneCellAt,
  zoneCellSet, zoneLabelAnchor, zoneLabelApproxHeightCells, zoneLabelApproxWidthCells,
  type ChipNote, type MapAnnotation, type MeasureNote, type RouteNote, type ZoneNote,
} from '../../core/model/annotations';
import { dimensionHit, measureDrawing } from '../../core/model/annotation-dimensions';
import type { CurveAnchor } from '../../core/model/spline';
import { dragShapeCells, snapShapeEnd, splineCells } from '../paint/shapes';
import { beginCurveSession, endCurveSession, isCurveSessionOpen } from '../paint/curve-session';
import { isConstrainHeld, isMultiSelectHeld } from '../../core/runtime/modifier-state';
import { showToast } from '../../core/runtime/toast-bus';
import type { CursorId } from '../../core/runtime/cursor-spec';
import type { Tool, ToolContext } from '../runtime/types';

/** The zone brush's stamp radius per brush size, in cells at ink scale 1. */
const ZONE_RADIUS: Record<number, number> = { 1: 0.9, 2: 1.6, 3: 2.3 };
/** Pointer travel, in cells, below which a press is a click. */
const CLICK_SLOP = 0.2;
/** A dragged route keeps anchors that bend it by more than this many cells at ink scale 1. */
const ROUTE_TOLERANCE = 0.35;

/** One zone stroke: which note it writes into, and the cells that stood before it began. */
interface ZoneStroke {
  /** The existing zone the press landed on, or null for the draft. */
  zoneId: string | null;
  base: MacroCoord[];
  /** Cells the free brush has stamped so far, growing per move. */
  painted: MacroCoord[];
  moved: boolean;
  start: MacroCoord;
}

export class AnnotateTool implements Tool {
  id = ToolType.Annotate;
  cursor: CursorId = 'place';

  private stroke: ZoneStroke | null = null;
  /** A drag figure in progress (line/rect/circle): where the drag began. */
  private zoneAnchor: MacroCoord | null = null;
  /** The curve figure's anchors so far, the draft they belong to, and the draft cells that stood
   *  before the band began so each new anchor re-lays the whole band. */
  private curveAnchors: MacroCoord[] = [];
  private curveDraftId: string | null = null;
  private curveBase: MacroCoord[] = [];
  /** A dragged route's raw pointer path. */
  private routeDrag: { raw: MacroCoord[]; moved: boolean } | null = null;
  private measurePress: MacroCoord | null = null;
  private erasing: { began: boolean } | null = null;
  /** A move drag armed by a press on a selected note: the WHOLE selection rides it, each note
   *  applied from its ORIGINAL so wobble cannot accumulate. */
  private drag: { start: MacroCoord; origs: MapAnnotation[]; began: boolean } | null = null;

  cursorFor(ctx: ToolContext): CursorId {
    switch (ctx.annotationTool) {
      case 'erase': return 'eraser';
      case 'none': return 'select';
      default: return 'place';
    }
  }

  canActAt(_coord: MacroCoord, ctx: ToolContext): boolean {
    if (ctx.annotationTool === 'none') return true;
    return ctx.annotations == null || (ctx.annotations.visible && !ctx.annotations.locked);
  }

  /** Only a note selected before this press can start a move. */
  grabAt(coord: MacroCoord, ctx: ToolContext): boolean {
    return !ctx.annotations?.locked && this.selectHit(coord, ctx)?.selected === true;
  }

  selects(ctx: ToolContext): boolean {
    return (ctx.annotationTool === 'none' || ctx.annotationTool === 'chip') && ctx.annotations?.visible !== false;
  }

  selectHit(coord: MacroCoord, ctx: ToolContext): { id: string; selected: boolean } | null {
    if (!this.selects(ctx)) return null;
    const p = this.fine(coord, ctx);
    const hit = ctx.annotationTool === 'chip' ? this.chipAt(p, ctx) : this.hitAt(p, ctx);
    return hit ? { id: hit.id, selected: ctx.annotationSelection.includes(hit.id) } : null;
  }

  /** Routes, curves and measurements can await another point; zone strokes await Done. */
  hasPending(ctx: ToolContext): boolean {
    if (ctx.annotationDraft?.kind === 'route' || ctx.annotationDraft?.kind === 'measure') return true;
    return ctx.annotationDraft?.kind === 'zone' && this.curveAnchors.length > 0;
  }

  cancelPending(ctx: ToolContext): boolean {
    const pending = !!(isCurveSessionOpen() || ctx.annotationDraft || this.stroke || this.routeDrag || this.erasing || this.drag);
    this.onDeactivate(ctx);
    return pending;
  }

  undoPendingStep(ctx: ToolContext): boolean {
    const d = ctx.annotationDraft;
    if (d?.kind === 'measure') { ctx.annotationEdit.setDraft(null); this.measurePress = null; return true; }
    if (!d || d.kind !== 'route') return false;
    if (d.points.length <= 1) ctx.annotationEdit.setDraft(null);
    else ctx.annotationEdit.setDraft({ ...d, points: d.points.slice(0, -1) });
    return true;
  }

  onPointerDown(coord: MacroCoord, _micro: MicroCoord, ctx: ToolContext): void {
    const p = this.fine(coord, ctx);
    // A finished route's handles stand until a press lands elsewhere.
    if (isCurveSessionOpen()) {
      endCurveSession();
      ctx.annotationEdit.select([]);
      return;
    }
    switch (ctx.annotationTool) {
      case 'zone': this.zoneDown(p, ctx); return;
      case 'chip': this.chipDown(p, ctx); return;
      case 'route': this.routeDown(p, ctx); return;
      case 'measure': this.measureDown(p, ctx); return;
      case 'erase': this.eraseDown(p, ctx); return;
      case 'none': this.selectDown(p, ctx); return;
    }
  }

  onPointerMove(coord: MacroCoord, _micro: MicroCoord, ctx: ToolContext): void {
    this.discardInactiveGestures(ctx);
    const p = this.fine(coord, ctx);
    if (ctx.annotationTool === 'measure' && ctx.annotationDraft?.kind === 'measure') { this.measureMove(p, ctx); return; }
    if (this.stroke) { this.zoneMove(p, ctx); return; }
    if (this.routeDrag) { this.routeMove(p, ctx); return; }
    if (this.erasing) { this.eraseAt(p, ctx); return; }
    if (this.drag) this.dragMove(p, ctx);
  }

  onPointerUp(_coord: MacroCoord, _micro: MicroCoord, ctx: ToolContext): void {
    this.discardInactiveGestures(ctx);
    if (this.stroke) this.zoneUp(ctx);
    if (this.routeDrag) this.routeUp(ctx);
    if (this.measurePress && ctx.annotationDraft?.kind === 'measure') {
      const end = measureEnd(ctx.annotationDraft.points[0], this.fine(_coord, ctx));
      if (end.x !== this.measurePress.x || end.y !== this.measurePress.y) {
        this.finishMeasure({ ...ctx.annotationDraft, points: [ctx.annotationDraft.points[0], end] }, ctx);
      }
    }
    this.measurePress = null;
    this.erasing = null;
    this.drag = null;
  }

  onPointerCancel(ctx: ToolContext): void {
    if (ctx.annotationDraft?.kind === 'measure') {
      this.measurePress = null;
      ctx.annotationEdit.setDraft(null);
    } else this.onPointerUp({ x: 0, y: 0 }, { x: 0, y: 0 }, ctx);
  }

  onActivate(_ctx: ToolContext): void {}

  private discardInactiveGestures(ctx: ToolContext): void {
    if (ctx.annotationTool !== 'zone') { this.stroke = null; this.zoneAnchor = null; }
    if (ctx.annotationTool !== 'route') this.routeDrag = null;
    if (ctx.annotationTool !== 'measure') this.measurePress = null;
    if (ctx.annotationTool !== 'erase') this.erasing = null;
    if (!this.selects(ctx)) this.drag = null;
  }

  onDeactivate(ctx: ToolContext): void {
    endCurveSession();
    this.stroke = null;
    this.zoneAnchor = null;
    this.curveAnchors = [];
    this.curveDraftId = null;
    this.routeDrag = null;
    this.measurePress = null;
    this.erasing = null;
    this.drag = null;
    if (ctx.annotationDraft) ctx.annotationEdit.setDraft(null);
  }

  /* ── zone ─────────────────────────────────────────────────────────────── */

  private zoneDown(p: MacroCoord, ctx: ToolContext): void {
    if (!this.editable(ctx)) return;
    const shape = ctx.annotationZoneShape;
    if (shape === 'curve') { this.curvePress(p, ctx); return; }
    const target = this.zoneBodyAt(zoneCellAt(p), ctx);
    // A press elsewhere while notes stand selected clears the selection; the stroke still lands.
    if (ctx.annotationSelection.length > 0 && !(target && ctx.annotationSelection.includes(target.id))) {
      ctx.annotationEdit.select([]);
    }
    const base = target ? target.cells : this.draftZone(ctx).cells;
    this.stroke = { zoneId: target?.id ?? null, base, painted: [], moved: false, start: p };
    if (shape !== 'free') this.zoneAnchor = zoneCellAt(p);
    // On open ground a press paints at once, so a tap leaves a dab; on a zone it waits to learn
    // whether it is a click (select) or a drag (extend).
    if (!target) this.writeStroke(shape === 'free' ? stamp([], p, ctx.brushSize, ctx) : this.figureCells(p, ctx), ctx);
  }

  private zoneMove(p: MacroCoord, ctx: ToolContext): void {
    const s = this.stroke!;
    if (!s.moved) {
      if (Math.hypot(p.x - s.start.x, p.y - s.start.y) < CLICK_SLOP) return;
      s.moved = true;
      // An edit to a standing zone is one lane entry per stroke; the draft has no lane of its own.
      if (s.zoneId) ctx.annotationEdit.begin();
      if (ctx.annotationZoneShape === 'free') s.painted = stamp([], s.start, ctx.brushSize, ctx);
    }
    if (ctx.annotationZoneShape === 'free') {
      s.painted = stamp(s.painted, p, ctx.brushSize, ctx);
      this.writeStroke(s.painted, ctx);
    } else {
      this.writeStroke(this.figureCells(p, ctx), ctx);
    }
  }

  private zoneUp(ctx: ToolContext): void {
    const s = this.stroke!;
    this.stroke = null;
    this.zoneAnchor = null;
    // A click on a zone is how it is selected under any brush.
    if (s.zoneId && !s.moved) ctx.annotationEdit.select([s.zoneId]);
  }

  /** Lay `cells` over the stroke's base into its target: the zone in place, or the draft. */
  private writeStroke(cells: MacroCoord[], ctx: ToolContext): void {
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
  private draftZone(ctx: ToolContext): ZoneNote {
    const d = ctx.annotationDraft;
    if (d?.kind === 'zone') return d;
    return {
      kind: 'zone', id: generateAnnotationId(), cells: [],
      color: ctx.annotationColor, tag: ctx.annotationTag, num: nextZoneNumber(ctx.annotations?.items ?? []),
      size: ctx.annotationSize,
    };
  }

  /** The drag figure's cells, from the anchor to the pointer, with the paint tools' own builders
   *  and constrain key. Cells are captured on the zone's drawn grid so the figure lands under the
   *  cursor. */
  private figureCells(p: MacroCoord, ctx: ToolContext): MacroCoord[] {
    const shape = ctx.annotationZoneShape as 'line' | 'rect' | 'circle';
    const cell = zoneCellAt(p);
    const from = this.zoneAnchor ?? cell;
    const to = isConstrainHeld() ? snapShapeEnd(from, cell, shape) : cell;
    return dragShapeCells(shape, from, to, this.bandWidth(ctx));
  }

  /** The curve figure: presses lay anchors into the draft; a press back on the last one closes the
   *  band and leaves the draft standing for Done. */
  private curvePress(p: MacroCoord, ctx: ToolContext): void {
    const draft = this.draftZone(ctx);
    if (this.curveDraftId !== draft.id) { this.curveAnchors = []; this.curveDraftId = draft.id; }
    const cell = zoneCellAt(p);
    const last = this.curveAnchors[this.curveAnchors.length - 1];
    if (last && Math.hypot(cell.x - last.x, cell.y - last.y) <= routeHitDistCells(annotationInkScale(ctx.gridState.template))) {
      this.curveAnchors = [];
      return;
    }
    if (this.curveAnchors.length === 0) this.curveBase = draft.cells;
    this.curveAnchors = [...this.curveAnchors, cell];
    const band = this.curveAnchors.length === 1
      ? stamp([], this.curveAnchors[0]!, ctx.brushSize, ctx)
      : splineCells(this.curveAnchors, this.bandWidth(ctx));
    ctx.annotationEdit.setDraft({ ...draft, cells: addZoneCells(this.curveBase, band) });
  }

  /** A line or curve band's width in the paint builders' own terms, from the scaled stamp. */
  private bandWidth(ctx: ToolContext): number {
    const R = (ZONE_RADIUS[ctx.brushSize] ?? ZONE_RADIUS[2]!) * annotationInkScale(ctx.gridState.template);
    return Math.max(1, Math.round(R));
  }

  /* ── chip ─────────────────────────────────────────────────────────────── */

  private chipDown(p: MacroCoord, ctx: ToolContext): void {
    const hit = ctx.annotations?.visible ? this.chipAt(p, ctx) : null;
    if (hit || isMultiSelectHeld()) { this.selectDown(p, ctx, hit); return; }
    if (!this.editable(ctx)) return;
    const chip: ChipNote = {
      kind: 'chip', id: generateAnnotationId(), x: p.x, y: p.y,
      tag: ctx.annotationTag, size: ctx.annotationSize, color: ctx.annotationColor,
    };
    ctx.annotationEdit.add(chip);
    ctx.annotationEdit.select([chip.id]);
  }

  /* ── route ────────────────────────────────────────────────────────────── */

  private routeDown(p: MacroCoord, ctx: ToolContext): void {
    if (!this.editable(ctx)) return;
    const d = ctx.annotationDraft;
    if (d && d.kind === 'route') {
      // Waypoint mode: a press back on the last waypoint ends the route instead of extending it.
      const last = d.points[d.points.length - 1]!;
      if (Math.hypot(p.x - last.x, p.y - last.y) <= routeHitDistCells(annotationInkScale(ctx.gridState.template))) {
        this.finishRoute(d, ctx);
        return;
      }
      ctx.annotationEdit.setDraft({ ...d, points: [...d.points, p] });
      return;
    }
    const near = this.routeAt(p, ctx);
    if (near) {
      ctx.annotationEdit.select([near.id]);
      this.adjustRoute(near, ctx);
      return;
    }
    if (ctx.annotationSelection.length > 0) ctx.annotationEdit.select([]);
    this.routeDrag = { raw: [p], moved: false };
    ctx.annotationEdit.setDraft({
      kind: 'route', id: generateAnnotationId(), points: [p],
      color: ctx.annotationColor, dashed: ctx.annotationRouteDashed,
    });
  }

  private routeMove(p: MacroCoord, ctx: ToolContext): void {
    const r = this.routeDrag!;
    const last = r.raw[r.raw.length - 1]!;
    if (Math.hypot(p.x - last.x, p.y - last.y) < CLICK_SLOP) return;
    r.moved = true;
    r.raw.push(p);
    const d = ctx.annotationDraft;
    if (d?.kind === 'route') ctx.annotationEdit.setDraft({ ...d, points: r.raw.map((q) => ({ x: q.x, y: q.y })) });
  }

  private routeUp(ctx: ToolContext): void {
    const r = this.routeDrag!;
    this.routeDrag = null;
    const d = ctx.annotationDraft;
    // A press that never moved leaves its one waypoint standing for the next press.
    if (!r.moved || d?.kind !== 'route') return;
    const points = simplifyPath(r.raw, ROUTE_TOLERANCE * annotationInkScale(ctx.gridState.template));
    if (points.length < 2) { ctx.annotationEdit.setDraft(null); return; }
    this.finishRoute({ ...d, points }, ctx);
  }

  /** The route becomes a note, selected, with its anchors up for tuning. */
  private finishRoute(d: RouteNote, ctx: ToolContext): void {
    ctx.annotationEdit.setDraft(null);
    if (d.points.length < 2) return;
    ctx.annotationEdit.add(d);
    ctx.annotationEdit.select([d.id]);
    this.adjustRoute(d, ctx);
  }

  /** Raise the curve brush's adjust handles over a route. The host rewrites the note's points: a
   *  drag's frames preview in place, its release makes the one undo-lane entry. */
  private adjustRoute(d: RouteNote, ctx: ToolContext): void {
    const edit = ctx.annotationEdit;
    const id = d.id;
    const write = (pts: readonly CurveAnchor[]): void => {
      edit.apply((data) => {
        if (data.locked || !data.visible) return;
        const i = data.items.findIndex((n) => n.id === id);
        if (i >= 0 && data.items[i]!.kind === 'route') {
          data.items[i] = { ...(data.items[i] as RouteNote), points: pts.map((a) => ({ ...a })) };
        }
      });
    };
    // The points as they stood when the current drag began, which the undo-lane snapshot must
    // hold: by commit time the live note already carries the drag's frames.
    let lastWritten: CurveAnchor[] = d.points.map((a) => ({ ...a }));
    let before: CurveAnchor[] | null = null;
    beginCurveSession(d.points.map((a) => ({ ...a })), {
      width: Math.max(1, Math.round(INK_CELLS.route * annotationInkScale(ctx.gridState.template))),
      terrainGrid: false, freeCoords: true,
    }, {
      preview: (next) => {
        before ??= lastWritten;
        write(next);
        lastWritten = next.map((a) => ({ ...a }));
      },
      repaint: (next) => {
        const base = before ?? lastWritten;
        before = null;
        if (JSON.stringify(base) === JSON.stringify(next)) { write(next); return; }
        write(base);
        edit.begin();
        write(next);
        lastWritten = next.map((a) => ({ ...a }));
      },
      finalize: () => { before = null; },
    });
  }

  private measureDown(p: MacroCoord, ctx: ToolContext): void {
    if (!this.editable(ctx)) return;
    const cell = zoneCellAt(p);
    const draft = ctx.annotationDraft;
    if (draft?.kind === 'measure') {
      this.finishMeasure({ ...draft, points: [draft.points[0], measureEnd(draft.points[0], p)] }, ctx);
      return;
    }
    ctx.annotationEdit.select([]);
    this.measurePress = cell;
    ctx.annotationEdit.setDraft({ kind: 'measure', id: generateAnnotationId(), points: [cell, cell], color: ctx.annotationColor });
  }

  private measureMove(p: MacroCoord, ctx: ToolContext): void {
    const draft = ctx.annotationDraft;
    if (draft?.kind !== 'measure' || ctx.annotations?.locked || ctx.annotations?.visible === false) return;
    const cell = measureEnd(draft.points[0], p);
    if (draft.points[1].x === cell.x && draft.points[1].y === cell.y) return;
    ctx.annotationEdit.setDraft({ ...draft, points: [draft.points[0], cell] });
  }

  private finishMeasure(note: MeasureNote, ctx: ToolContext): void {
    this.measurePress = null;
    ctx.annotationEdit.setDraft(null);
    if (!this.editable(ctx)) return;
    ctx.annotationEdit.add(note);
    ctx.annotationEdit.select([note.id]);
  }

  /* ── erase ────────────────────────────────────────────────────────────── */

  private eraseDown(p: MacroCoord, ctx: ToolContext): void {
    if (!this.editable(ctx)) return;
    const hit = this.hitAt(p, ctx);
    if (hit && hit.kind !== 'zone') { ctx.annotationEdit.remove(hit.id); return; }
    this.erasing = { began: false };
    this.eraseAt(p, ctx);
  }

  /** Subtract the stamp from every zone it crosses, and from the draft. */
  private eraseAt(p: MacroCoord, ctx: ToolContext): void {
    const gone = stamp([], p, ctx.brushSize, ctx);
    const goneSet = zoneCellSet(gone);
    const touches = (cells: readonly MacroCoord[]): boolean => cells.some((c) => goneSet.has(`${c.x},${c.y}`));
    const d = ctx.annotationDraft;
    if (d?.kind === 'zone' && touches(d.cells)) ctx.annotationEdit.setDraft({ ...d, cells: removeZoneCells(d.cells, gone) });
    const items = ctx.annotations?.items ?? [];
    if (!items.some((n) => n.kind === 'zone' && touches(n.cells))) return;
    if (!this.erasing!.began) { this.erasing!.began = true; ctx.annotationEdit.begin(); }
    ctx.annotationEdit.apply((data) => {
      data.items = data.items
        .map((n) => (n.kind === 'zone' && touches(n.cells) ? { ...n, cells: removeZoneCells(n.cells, gone) } : n))
        .filter((n) => n.kind !== 'zone' || n.cells.length > 0);
    });
  }

  /* ── select ───────────────────────────────────────────────────────────── */

  private selectDown(p: MacroCoord, ctx: ToolContext, hit = ctx.annotations?.visible ? this.hitAt(p, ctx) : null): void {
    const wasSelected = hit !== null && ctx.annotationSelection.includes(hit.id);
    // Ctrl toggles the note in and out of the SET; a toggle never arms a drag.
    if (isMultiSelectHeld()) {
      if (hit) {
        const cur = ctx.annotationSelection;
        ctx.annotationEdit.select(cur.includes(hit.id) ? cur.filter((i) => i !== hit.id) : [...cur, hit.id]);
      }
      this.drag = null;
      return;
    }
    // A plain press on a member keeps the standing set (and drags it whole); anywhere else it
    // collapses to the note under the press, or to nothing.
    const ids = hit
      ? (ctx.annotationSelection.includes(hit.id) ? ctx.annotationSelection : [hit.id])
      : [];
    ctx.annotationEdit.select(ids);
    const items = ctx.annotations?.items ?? [];
    const origs = ids.map((id) => items.find((n) => n.id === id)).filter((n): n is MapAnnotation => !!n);
    this.drag = wasSelected && !ctx.annotations?.locked ? { start: p, origs: origs.map(copyNote), began: false } : null;
  }

  private dragMove(p: MacroCoord, ctx: ToolContext): void {
    const drag = this.drag!;
    const dx = p.x - drag.start.x;
    const dy = p.y - drag.start.y;
    if (!drag.began) {
      if (Math.abs(dx) + Math.abs(dy) < CLICK_SLOP) return;
      if (!this.editable(ctx)) { this.drag = null; return; }
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

  /* ── shared ───────────────────────────────────────────────────────────── */

  /** Whether an EDIT may land, saying why not when it may not. A null layer is an EMPTY one. */
  private editable(ctx: ToolContext): boolean {
    if (!ctx.annotations) return true;
    if (!ctx.annotations.visible) {
      showToast(ctx.t('annot.hidden'), 'warning');
      return false;
    }
    if (ctx.annotations.locked) {
      showToast(ctx.t('annot.locked'), 'warning');
      return false;
    }
    return true;
  }

  /** The press at half-cell precision where the view offers it, else the cell's centre. */
  private fine(coord: MacroCoord, ctx: ToolContext): MacroCoord {
    return ctx.halfCoord ?? { x: coord.x + 0.5, y: coord.y + 0.5 };
  }

  /** The topmost committed zone whose cells hold `cell`. */
  private zoneBodyAt(cell: MacroCoord, ctx: ToolContext): ZoneNote | null {
    const items = ctx.annotations?.items ?? [];
    const k = `${cell.x},${cell.y}`;
    for (let i = items.length - 1; i >= 0; i--) {
      const n = items[i]!;
      if (n.kind === 'zone' && zoneCellSet(n.cells).has(k)) return n;
    }
    return null;
  }

  /** The topmost route within reach of `p`. */
  private routeAt(p: MacroCoord, ctx: ToolContext): RouteNote | null {
    const items = ctx.annotations?.items ?? [];
    const reach = routeHitDistCells(annotationInkScale(ctx.gridState.template));
    for (let i = items.length - 1; i >= 0; i--) {
      const n = items[i]!;
      if (n.kind !== 'route') continue;
      for (const [sx, sy] of routeSamples(n.points, 8)) {
        if (Math.hypot(p.x - sx, p.y - sy) <= reach) return n;
      }
    }
    return null;
  }

  private captionHit(p: MacroCoord, n: ZoneNote, ink: number, ctx: ToolContext): boolean {
    if (ctx.annotationLabelHit !== undefined) return ctx.annotationLabelHit === n.id;
    const label = n.tag ? ctx.tagLabel(n.tag) : '';
    if (n.num <= 0 && !label) return false;
    const at = zoneLabelAnchor(n.cells);
    return Math.abs(p.x - at.x) <= zoneLabelApproxWidthCells(n, label, ink) / 2
      && Math.abs(p.y - at.y) <= zoneLabelApproxHeightCells(n, ink) / 2;
  }

  private chipContains(p: MacroCoord, note: ChipNote, ink: number, ctx: ToolContext): boolean {
    if (ctx.annotationLabelHit !== undefined) return ctx.annotationLabelHit === note.id;
    const reach = Math.max(0.35, INK_CELLS.text[note.size] * ink * 0.3);
    return Math.abs(p.x - note.x) <= chipApproxWidthCells(note, ctx.tagLabel(note.tag), ink) / 2 + reach
      && Math.abs(p.y - note.y) <= chipApproxHeightCells(note, ink) / 2 + reach;
  }

  private chipAt(p: MacroCoord, ctx: ToolContext): ChipNote | null {
    const ink = annotationInkScale(ctx.gridState.template);
    const items = ctx.annotations?.items ?? [];
    for (let i = items.length - 1; i >= 0; i--) {
      const note = items[i]!;
      if (note.kind === 'chip' && this.chipContains(p, note, ink, ctx)) return note;
    }
    return null;
  }

  /** Topmost note under a press: chips and captions read over routes, routes over zone bodies,
   *  later notes over earlier — the same order the views paint them in. */
  private hitAt(p: MacroCoord, ctx: ToolContext): MapAnnotation | null {
    const items = ctx.annotations?.items ?? [];
    const ink = annotationInkScale(ctx.gridState.template);
    if (ctx.annotationLabelHit) {
      const label = items.find(n => n.id === ctx.annotationLabelHit);
      if (label) return label;
    }
    for (let i = items.length - 1; i >= 0; i--) {
      const n = items[i]!;
      if (n.kind === 'measure' && dimensionHit(p, measureDrawing(n.points, ink, n.flipped), ink)) return n;
      if (n.kind === 'chip') {
        if (this.chipContains(p, n, ink, ctx)) return n;
      } else if (n.kind === 'zone' && this.captionHit(p, n, ink, ctx)) {
        return n;
      }
    }
    const route = this.routeAt(p, ctx);
    if (route) return route;
    return this.zoneBodyAt(zoneCellAt(p), ctx);
  }
}

/** Round-stamp `radius` cells around the fine press point into `cells`, deduplicated. A cell's
 *  DRAWN centre is its corner point (`ZONE_GRID_SHIFT`), so the distance runs from there and the
 *  drawn stamp stays centred under the cursor. */
function stamp(cells: readonly MacroCoord[], p: MacroCoord, brushSize: number, ctx: ToolContext): MacroCoord[] {
  const R = (ZONE_RADIUS[brushSize] ?? ZONE_RADIUS[2]!) * annotationInkScale(ctx.gridState.template);
  const out: MacroCoord[] = [];
  for (let y = Math.floor(p.y - R); y <= Math.ceil(p.y + R); y++) {
    for (let x = Math.floor(p.x - R); x <= Math.ceil(p.x + R); x++) {
      if (Math.hypot(x - p.x, y - p.y) <= R) out.push({ x, y });
    }
  }
  return addZoneCells(cells, out);
}

/** An independent copy of a note, so a drag keeps measuring from where it began while the live
 *  items move under it. A planning note is plain data: cells, anchors, ids, colours and numbers. */
function copyNote(note: MapAnnotation): MapAnnotation {
  return JSON.parse(JSON.stringify(note)) as MapAnnotation;
}

function measureEnd(start: MacroCoord, point: MacroCoord): MacroCoord {
  const end = zoneCellAt(point);
  return Math.abs(end.x - start.x) >= Math.abs(end.y - start.y)
    ? { x: end.x, y: start.y }
    : { x: start.x, y: end.y };
}

/** Zones and measurements move by whole cells; chips and routes retain fractional positions. */
function movedBy(orig: MapAnnotation, dx: number, dy: number): MapAnnotation {
  if (orig.kind === 'zone') {
    const ix = Math.round(dx);
    const iy = Math.round(dy);
    return { ...orig, cells: orig.cells.map((c) => ({ x: c.x + ix, y: c.y + iy })) };
  }
  if (orig.kind === 'measure') return { ...orig, points: orig.points.map(p => ({ x: p.x + Math.round(dx), y: p.y + Math.round(dy) })) as [MacroCoord, MacroCoord] };
  if (orig.kind === 'chip') return { ...orig, x: orig.x + dx, y: orig.y + dy };
  return { ...orig, points: orig.points.map((pt) => ({ ...pt, x: pt.x + dx, y: pt.y + dy })) };
}
