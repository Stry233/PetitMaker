/**
 * The plan-notes tool: everything a pointer does while the annotation layer is being edited.
 *
 * One tool for the four armings plus the put-away state, switched by `ctx.annotationTool` (the
 * annotation slice's field, mirrored into the context the way `eraserShape` is): ZONE paints a
 * cell set as a draft and commits it on release, TEXT drops a draft note and opens the name
 * editor, ROUTE collects waypoints as a draft until a press lands back on the last one, ERASE
 * removes what a press hits, and NONE selects and drags. Everything speaks CELL coordinates, so
 * the tool is view-agnostic exactly as the map tools are — 3D hands it the same cells through its
 * pick.
 *
 * A hidden or locked layer refuses every edit with a toast; selection alone still works under a
 * lock (PS's own grammar: you can hold a thing you may not move).
 */
import type { MacroCoord, MicroCoord } from '../../core/model/types';
import { ToolType } from '../../core/model/types';
import {
  annotationInkScale, generateAnnotationId, INK_CELLS, nextZoneNumber, routeHitDistCells,
  routeSamples, textApproxHeightCells, textApproxWidthCells, zoneCellAt, zoneCellSet, zoneCentroid,
  zoneLabelApproxHeightCells, zoneLabelApproxWidthCells,
  type MapAnnotation, type RouteNote, type TextNote, type ZoneNote,
} from '../../core/model/annotations';
import type { CurveAnchor } from '../../core/model/spline';
import { dragShapeCells, snapShapeEnd, splineCells } from '../paint/shapes';
import { beginCurveSession, endCurveSession, isCurveSessionOpen } from '../paint/curve-session';
import { isConstrainHeld, isMultiSelectHeld } from '../../core/runtime/modifier-state';
import { showToast } from '../../core/runtime/toast-bus';
import type { CursorId } from '../../core/runtime/cursor-spec';
import type { Tool, ToolContext } from '../runtime/types';

/** The zone brush's stamp radius per brush size, in cells at ink scale 1: a planning region is a
 *  share of the ISLAND, so the stamp grows with the map exactly as the drawn ink does. */
const ZONE_RADIUS: Record<number, number> = { 1: 0.9, 2: 1.6, 3: 2.3 };

export class AnnotateTool implements Tool {
  id = ToolType.Annotate;
  cursor: CursorId = 'place';

  /** A drag figure in progress (line/rect/circle): where the drag began. */
  private zoneAnchor: MacroCoord | null = null;
  /** The free brush mid-stroke. */
  private painting = false;
  /** The curve figure's anchors so far — the tool's own gesture state, like the macro tool's mark;
   *  the draft in the store is its projection, so an outside clear empties this on the next look. */
  private curveAnchors: MacroCoord[] = [];
  /** A move drag armed by a press on a selected note: the WHOLE selection rides it, each note
   *  applied from its ORIGINAL so wobble cannot accumulate. */
  private drag: { start: MacroCoord; origs: MapAnnotation[]; began: boolean } | null = null;

  cursorFor(ctx: ToolContext): CursorId {
    switch (ctx.annotationTool) {
      case 'text': return 'text';
      case 'erase': return 'eraser';
      case 'none': return 'select';
      default: return 'place';
    }
  }

  canActAt(_coord: MacroCoord, ctx: ToolContext): boolean {
    if (ctx.annotationTool === 'none') return true;
    return ctx.annotations == null || (ctx.annotations.visible && !ctx.annotations.locked);
  }

  /** The select state's grab: a press on a note (or its caption) picks the selection up. Only the
   *  'none' state drags — every armed tool's press draws or erases instead. */
  grabAt(coord: MacroCoord, ctx: ToolContext): boolean {
    if (ctx.annotationTool !== 'none' || !ctx.annotations?.visible) return false;
    return this.hitAt(this.fine(coord, ctx), coord, ctx) !== null;
  }

  /** The put-away state is this tool's select state; a hidden layer offers nothing to select. */
  selects(ctx: ToolContext): boolean {
    return ctx.annotationTool === 'none' && ctx.annotations?.visible !== false;
  }

  selectHit(coord: MacroCoord, ctx: ToolContext): { id: string; selected: boolean } | null {
    if (!this.selects(ctx)) return null;
    const hit = this.hitAt(this.fine(coord, ctx), coord, ctx);
    return hit ? { id: hit.id, selected: ctx.annotationSelection.includes(hit.id) } : null;
  }

  hasPending(ctx: ToolContext): boolean {
    if (ctx.annotationDraft?.kind === 'route') return true;
    return ctx.annotationDraft?.kind === 'zone' && this.curveAnchors.length > 0;
  }

  cancelPending(ctx: ToolContext): boolean {
    if (isCurveSessionOpen()) { endCurveSession(); return true; }
    if (!ctx.annotationDraft) return false;
    ctx.annotationEdit.setDraft(null);
    return true;
  }

  undoPendingStep(ctx: ToolContext): boolean {
    const d = ctx.annotationDraft;
    if (!d || d.kind !== 'route') return false;
    if (d.points.length <= 1) ctx.annotationEdit.setDraft(null);
    else ctx.annotationEdit.setDraft({ ...d, points: d.points.slice(0, -1) });
    return true;
  }

  onPointerDown(coord: MacroCoord, _micro: MicroCoord, ctx: ToolContext): void {
    const p = this.fine(coord, ctx);
    // DISMISS-FIRST: while a finished route's adjust handles stand, or a note stands selected (its
    // verb row showing), a press with a drawing tool armed puts that away and makes nothing — the
    // intuitive read of "click somewhere else" is "close this", and a press that instead minted
    // the next note stood chrome the user never asked for. The select state keeps its own presses
    // when nothing is standing: they are how the selection moves.
    if (isCurveSessionOpen()) {
      endCurveSession();
      ctx.annotationEdit.select([]);
      ctx.annotationEdit.setNaming(null);
      return;
    }
    // A press that lands ON a zone's caption SELECTS, whatever tool is armed: the caption is the
    // zone's grab handle, and a brush that painted over it forced a trip back to the select state
    // for every rename. It yields to a gesture already underway (a route mid-waypoints, a curve
    // mid-anchors) — hijacking a waypoint press would tear the draft — and the eraser keeps its
    // own meaning for the same press (delete).
    if (ctx.annotationTool !== 'none' && ctx.annotationTool !== 'erase'
      && !this.hasPending(ctx) && ctx.annotations?.visible) {
      const cap = this.captionAt(p, ctx);
      if (cap) {
        const cur = ctx.annotationSelection;
        ctx.annotationEdit.select(isMultiSelectHeld()
          ? (cur.includes(cap.id) ? cur.filter((i) => i !== cap.id) : [...cur, cap.id])
          : [cap.id]);
        ctx.annotationEdit.setNaming(null);
        return;
      }
    }
    if (ctx.annotationTool !== 'none' && ctx.annotationSelection.length > 0) {
      ctx.annotationEdit.select([]);
      ctx.annotationEdit.setNaming(null);
      return;
    }
    switch (ctx.annotationTool) {
      case 'zone': {
        if (!this.editable(ctx)) return;
        const shape = ctx.annotationZoneShape;
        if (shape === 'curve') {
          this.curvePress(p, ctx);
          return;
        }
        if (shape === 'free') {
          this.painting = true;
          ctx.annotationEdit.setDraft(this.zoneDraft(stamp([], p, ctx.brushSize, ctx), ctx));
          return;
        }
        // line / rect / circle: a drag figure, previewed live and taken on release.
        this.zoneAnchor = zoneCellAt(p);
        this.painting = true;
        ctx.annotationEdit.setDraft(this.zoneDraft(this.figureCells(p, ctx), ctx));
        return;
      }
      case 'text': {
        if (!this.editable(ctx)) return;
        const draft: TextNote = {
          kind: 'text', id: generateAnnotationId(), x: p.x, y: p.y, text: '',
          style: ctx.annotationTextStyle, size: ctx.annotationTextSize, color: ctx.annotationColor,
        };
        ctx.annotationEdit.setDraft(draft);
        ctx.annotationEdit.setNaming(draft.id);
        return;
      }
      case 'route': {
        if (!this.editable(ctx)) return;
        const d = ctx.annotationDraft;
        if (d && d.kind === 'route') {
          // A press back on the last waypoint ends the route instead of extending it.
          const last = d.points[d.points.length - 1]!;
          if (Math.hypot(p.x - last.x, p.y - last.y) <= routeHitDistCells(annotationInkScale(ctx.gridState.template))) {
            this.finishRoute(d, ctx);
            return;
          }
          ctx.annotationEdit.setDraft({ ...d, points: [...d.points, p] });
          return;
        }
        ctx.annotationEdit.setDraft({
          kind: 'route', id: generateAnnotationId(), points: [p],
          color: ctx.annotationColor, dashed: ctx.annotationRouteDashed,
        });
        return;
      }
      case 'erase': {
        if (!this.editable(ctx)) return;
        const hit = this.hitAt(p, coord, ctx);
        if (hit) ctx.annotationEdit.remove(hit.id);
        return;
      }
      case 'none': {
        const hit = ctx.annotations?.visible ? this.hitAt(p, coord, ctx) : null;
        // Ctrl toggles the note in and out of the SET; a toggle never arms a drag, so an
        // assembling selection cannot be smeared by a shaky press.
        if (isMultiSelectHeld()) {
          if (hit) {
            const cur = ctx.annotationSelection;
            ctx.annotationEdit.select(cur.includes(hit.id) ? cur.filter((i) => i !== hit.id) : [...cur, hit.id]);
            ctx.annotationEdit.setNaming(null);
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
        this.drag = hit ? { start: p, origs: structuredClone(origs), began: false } : null;
        return;
      }
    }
  }

  onPointerMove(coord: MacroCoord, _micro: MicroCoord, ctx: ToolContext): void {
    const p = this.fine(coord, ctx);
    if (this.painting && ctx.annotationDraft?.kind === 'zone') {
      const d = ctx.annotationDraft;
      const cells = this.zoneAnchor
        ? this.figureCells(p, ctx)
        : stamp(d.cells, p, ctx.brushSize, ctx);
      ctx.annotationEdit.setDraft({ ...d, cells });
      return;
    }
    if (this.drag) {
      const dx = p.x - this.drag.start.x;
      const dy = p.y - this.drag.start.y;
      if (!this.drag.began) {
        if (Math.abs(dx) + Math.abs(dy) < 0.2) return;
        if (!this.editable(ctx)) { this.drag = null; return; }
        ctx.annotationEdit.begin();
        this.drag.began = true;
      }
      const { origs } = this.drag;
      ctx.annotationEdit.apply((data) => {
        for (const orig of origs) {
          const i = data.items.findIndex((n) => n.id === orig.id);
          if (i >= 0) data.items[i] = movedBy(orig, dx, dy);
        }
      });
    }
  }

  onPointerUp(_coord: MacroCoord, _micro: MicroCoord, ctx: ToolContext): void {
    if (this.painting) {
      this.painting = false;
      this.zoneAnchor = null;
      this.commitZone(ctx);
    }
    this.drag = null;
  }

  /** The zone draft becomes a note, selected and offered its name; a degenerate figure is simply
   *  let go. */
  private commitZone(ctx: ToolContext): void {
    const d = ctx.annotationDraft;
    if (d?.kind !== 'zone') return;
    ctx.annotationEdit.setDraft(null);
    if (d.cells.length < 2) return;
    ctx.annotationEdit.add(d);
    ctx.annotationEdit.select([d.id]);
    ctx.annotationEdit.setNaming(d.id);
  }

  /** A fresh zone draft around the given cells. */
  private zoneDraft(cells: MacroCoord[], ctx: ToolContext): ZoneNote {
    return {
      kind: 'zone', id: generateAnnotationId(), cells,
      color: ctx.annotationColor, name: '', num: nextZoneNumber(ctx.annotations?.items ?? []),
      size: ctx.annotationTextSize,
    };
  }

  /** The drag figure's cells, from the anchor to the pointer — the paint tools' own builders, with
   *  their own constrain key, so an annotation rectangle is drawn with the same hand a terrain one
   *  is. The line's width is the zone brush's own stamp. Cells are captured on the zone's drawn
   *  grid (`zoneCellAt`), so the figure lands under the cursor. */
  private figureCells(p: MacroCoord, ctx: ToolContext): MacroCoord[] {
    const shape = ctx.annotationZoneShape as 'line' | 'rect' | 'circle';
    const cell = zoneCellAt(p);
    const from = this.zoneAnchor ?? cell;
    const to = isConstrainHeld() ? snapShapeEnd(from, cell, shape) : cell;
    return dragShapeCells(shape, from, to, this.bandWidth(ctx));
  }

  /** The curve figure: presses lay anchors, a press back on the last one takes the band. */
  private curvePress(p: MacroCoord, ctx: ToolContext): void {
    const d = ctx.annotationDraft;
    if (d?.kind !== 'zone' || this.curveAnchors.length === 0) this.curveAnchors = [];
    const cell = zoneCellAt(p);
    const last = this.curveAnchors[this.curveAnchors.length - 1];
    if (last && Math.hypot(cell.x - last.x, cell.y - last.y) <= routeHitDistCells(annotationInkScale(ctx.gridState.template))) {
      this.curveAnchors = [];
      this.commitZone(ctx);
      return;
    }
    this.curveAnchors = [...this.curveAnchors, cell];
    const cells = this.curveBand(ctx);
    if (d?.kind === 'zone') ctx.annotationEdit.setDraft({ ...d, cells });
    else ctx.annotationEdit.setDraft(this.zoneDraft(cells, ctx));
  }

  /** The band the curve's anchors trace, at the zone brush's own width. */
  private curveBand(ctx: ToolContext): MacroCoord[] {
    if (this.curveAnchors.length === 1) return stamp([], this.curveAnchors[0]!, ctx.brushSize, ctx);
    return splineCells(this.curveAnchors, this.bandWidth(ctx));
  }

  /** A line or curve band's width in the paint builders' own terms, from the scaled stamp. */
  private bandWidth(ctx: ToolContext): number {
    const R = (ZONE_RADIUS[ctx.brushSize] ?? ZONE_RADIUS[2]!) * annotationInkScale(ctx.gridState.template);
    return Math.max(1, Math.round(R));
  }

  onActivate(_ctx: ToolContext): void {}

  onDeactivate(ctx: ToolContext): void {
    endCurveSession();
    this.painting = false;
    this.zoneAnchor = null;
    this.curveAnchors = [];
    this.drag = null;
    if (ctx.annotationDraft) ctx.annotationEdit.setDraft(null);
    ctx.annotationEdit.setNaming(null);
  }

  /** The route becomes a note, and its anchors STAY UP for tuning: the terrain curve brush's own
   *  adjust phase, on the same session and the same handle overlay. The host rewrites the note's
   *  points — a drag's frames preview in place, its release makes the one undo-lane entry. */
  private finishRoute(d: RouteNote, ctx: ToolContext): void {
    ctx.annotationEdit.setDraft(null);
    if (d.points.length < 2) return;
    ctx.annotationEdit.add(d);
    ctx.annotationEdit.select([d.id]);
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
    // The points as they stood when the current drag began — what the undo-lane snapshot must
    // hold, since by commit time the live note already carries the drag's frames. Tracked from
    // the host's own writes rather than read back off the layer.
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

  /** Whether an EDIT may land, saying why not when it may not. Selection does not come through
   *  here — a lock refuses change, not attention. A null layer is an EMPTY one (the slice creates
   *  the field on first write), so it edits freely. */
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

  /** The topmost zone whose CAPTION holds the press — the armed-tool selection path, which must
   *  not also grab text notes or zone bodies (those keep their tool meaning). */
  private captionAt(p: MacroCoord, ctx: ToolContext): ZoneNote | null {
    const items = ctx.annotations?.items ?? [];
    const ink = annotationInkScale(ctx.gridState.template);
    for (let i = items.length - 1; i >= 0; i--) {
      const n = items[i]!;
      if (n.kind === 'zone' && this.captionHit(p, n, ink)) return n;
    }
    return null;
  }

  private captionHit(p: MacroCoord, n: ZoneNote, ink: number): boolean {
    if (n.num <= 0 && !n.name) return false;
    const at = zoneCentroid(n.cells);
    return Math.abs(p.x - at.x) <= zoneLabelApproxWidthCells(n, ink) / 2
      && Math.abs(p.y - at.y) <= zoneLabelApproxHeightCells(n, ink) / 2;
  }

  /** The press at half-cell precision where the view offers it, else the cell's centre. */
  private fine(coord: MacroCoord, ctx: ToolContext): MacroCoord {
    return ctx.halfCoord ?? { x: coord.x + 0.5, y: coord.y + 0.5 };
  }

  /** Topmost note under a press: text reads over routes, routes over zones, later notes over
   *  earlier — the same order the views paint them in. The reach follows the map's ink scale, so
   *  what a press can grab is what the eye sees drawn. */
  private hitAt(p: MacroCoord, _cell: MacroCoord, ctx: ToolContext): MapAnnotation | null {
    const items = ctx.annotations?.items ?? [];
    const ink = annotationInkScale(ctx.gridState.template);
    // Zone ink draws on the terrain grid, so the cell a press lands in is the DRAWN one.
    const cell = zoneCellAt(p);
    // The LETTERING tier: text notes and zone captions read as one layer of words standing on the
    // map, later-drawn on top. A zone's caption is its grab handle — the one part of the zone
    // that stays visible whatever covers the cells, and it may hang outside them.
    for (let i = items.length - 1; i >= 0; i--) {
      const n = items[i]!;
      if (n.kind === 'text') {
        if (Math.abs(p.x - n.x) <= textApproxWidthCells(n, ink) / 2 && Math.abs(p.y - n.y) <= textApproxHeightCells(n, ink)) return n;
      } else if (n.kind === 'zone' && this.captionHit(p, n, ink)) {
        return n;
      }
    }
    for (let i = items.length - 1; i >= 0; i--) {
      const n = items[i]!;
      if (n.kind !== 'route') continue;
      for (const [sx, sy] of routeSamples(n.points, 8)) {
        if (Math.hypot(p.x - sx, p.y - sy) <= routeHitDistCells(ink)) return n;
      }
    }
    for (let i = items.length - 1; i >= 0; i--) {
      const n = items[i]!;
      if (n.kind !== 'zone') continue;
      if (zoneCellSet(n.cells).has(`${cell.x},${cell.y}`)) return n;
    }
    return null;
  }
}

/** Round-stamp `radius` cells around the fine press point into `cells`, deduplicated, clamped to
 *  the map by the caller's own drawing (a note may reach the sea — planning ink is not terrain).
 *  A cell's DRAWN centre is its corner point (`ZONE_GRID_SHIFT`), so the distance runs from there
 *  and the drawn stamp stays centred under the cursor. */
function stamp(cells: readonly MacroCoord[], p: MacroCoord, brushSize: number, ctx: ToolContext): MacroCoord[] {
  const R = (ZONE_RADIUS[brushSize] ?? ZONE_RADIUS[2]!) * annotationInkScale(ctx.gridState.template);
  const out = [...cells];
  const seen = new Set(out.map((c) => `${c.x},${c.y}`));
  for (let y = Math.floor(p.y - R); y <= Math.ceil(p.y + R); y++) {
    for (let x = Math.floor(p.x - R); x <= Math.ceil(p.x + R); x++) {
      if (Math.hypot(x - p.x, y - p.y) > R) continue;
      const k = `${x},${y}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ x, y });
    }
  }
  return out;
}


/** The note as the drag has carried it: zones move by whole cells (their cells are whole), the
 *  free-anchored kinds by the drag's own fraction. */
function movedBy(orig: MapAnnotation, dx: number, dy: number): MapAnnotation {
  if (orig.kind === 'zone') {
    const ix = Math.round(dx);
    const iy = Math.round(dy);
    return { ...orig, cells: orig.cells.map((c) => ({ x: c.x + ix, y: c.y + iy })) };
  }
  if (orig.kind === 'text') return { ...orig, x: orig.x + dx, y: orig.y + dy };
  return { ...orig, points: orig.points.map((pt) => ({ ...pt, x: pt.x + dx, y: pt.y + dy })) };
}
