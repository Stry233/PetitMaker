/**
 * The route verb of the notes tool. A drag draws a route through `route-fit.ts` and keeps its anchors
 * on release; a press that does not move lays a waypoint, and a press back on the last waypoint ends
 * the route. A press near a committed route selects it and raises the curve brush's adjust handles.
 */
import type { MacroCoord } from '../../../core/model/types';
import { generateAnnotationId, type RouteNote } from '../../../core/model/annotations';
import type { CurveAnchor } from '../../../core/base/spline';
import { PLACEMENT_GRID } from '../../../core/game/profile';
import { curveArmingKey } from '../paint/curve-session';
import type { AnnotateContext } from './channel';
import { annotationInkScale, INK_CELLS, routeHitDistCells } from '../../../core/model/annotation/text-metrics';
import { extendRouteFit, routeFitAnchors, startRouteFit, type RouteFit } from '../../../core/model/annotation/route-fit';
import { routeAt } from './note-hits';
import { layerEditable } from './note-edits';

export class RouteGesture {
  /** A dragged route's fit, whether the drag has left its press, and the context its pending frame
   *  writes through. */
  private drag: { fit: RouteFit; moved: boolean; ctx: AnnotateContext } | null = null;
  /** The animation frame that writes the live route; one per frame however many moves arrive. */
  private frame = 0;

  get dragging(): boolean { return this.drag !== null; }

  down(p: MacroCoord, ctx: AnnotateContext): void {
    if (!layerEditable(ctx)) return;
    const d = ctx.arming.notes.draft;
    if (d && d.kind === 'route') {
      // Waypoint mode: a press back on the last waypoint ends the route instead of extending it.
      const last = d.points[d.points.length - 1]!;
      if (Math.hypot(p.x - last.x, p.y - last.y) <= routeHitDistCells(annotationInkScale(ctx.state.template))) {
        this.finish(d, ctx);
        return;
      }
      ctx.annotationEdit.begin();
      ctx.annotationEdit.setDraft({ ...d, points: [...d.points, p] });
      return;
    }
    const near = routeAt(p, ctx);
    if (near) {
      ctx.annotationEdit.select([near.id]);
      this.adjust(near, ctx);
      return;
    }
    if (ctx.arming.notes.selection.length > 0) ctx.annotationEdit.select([]);
    ctx.annotationEdit.begin();
    this.drag = { fit: startRouteFit(p, ctx.cellPixels), moved: false, ctx };
    ctx.annotationEdit.setDraft({
      kind: 'route', id: generateAnnotationId(), points: [p],
      color: ctx.arming.annotationColor, dashed: ctx.arming.annotationRouteDashed, width: ctx.arming.annotationRouteWidth,
    });
  }

  move(p: MacroCoord, ctx: AnnotateContext): void {
    const r = this.drag!;
    r.ctx = ctx;
    if (!extendRouteFit(r.fit, p)) return;
    r.moved = true;
    if (this.frame || typeof requestAnimationFrame !== 'function') {
      if (!this.frame) this.write();
      return;
    }
    this.frame = requestAnimationFrame(() => { this.frame = 0; this.write(); });
  }

  up(p: MacroCoord, ctx: AnnotateContext): void {
    const r = this.drag!;
    r.ctx = ctx;
    if (extendRouteFit(r.fit, p)) r.moved = true;
    this.drop();
    const d = ctx.arming.notes.draft;
    // A press that never moved leaves its one waypoint standing for the next press.
    if (!r.moved || d?.kind !== 'route') return;
    const points = routeFitAnchors(r.fit);
    if (points.length < 2) { ctx.annotationEdit.setDraft(null); return; }
    this.finish({ ...d, points }, ctx);
  }

  /** Abandons a drag in flight and its pending frame. */
  drop(): void {
    if (this.frame && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.drag = null;
  }

  /** The live route: the fit's anchors as they stand, the same ones release keeps. */
  private write(): void {
    const r = this.drag;
    const d = r?.ctx.arming.notes.draft;
    if (!r || d?.kind !== 'route') return;
    r.ctx.annotationEdit.setDraft({ ...d, points: routeFitAnchors(r.fit) });
  }

  /** The route becomes a note, selected, with its anchors up for tuning. */
  private finish(d: RouteNote, ctx: AnnotateContext): void {
    ctx.annotationEdit.setDraft(null);
    if (d.points.length < 2) return;
    ctx.annotationEdit.apply(data => { data.items.push(d); });
    ctx.annotationEdit.select([d.id]);
    this.adjust(d, ctx);
  }

  /** Raise the curve brush's adjust handles over a route. The host rewrites the note's points: a
   *  drag's frames preview in place, its release makes the one undo-lane entry. */
  private adjust(d: RouteNote, ctx: AnnotateContext): void {
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
    ctx.curve.begin(d.points.map((a) => ({ ...a })), {
      width: Math.max(1, Math.round(INK_CELLS.route * annotationInkScale(ctx.state.template))),
      grid: PLACEMENT_GRID, freeCoords: true, armingKey: curveArmingKey(ctx.arming),
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
}
