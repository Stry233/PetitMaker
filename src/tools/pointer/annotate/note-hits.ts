/** What a press on the notes layer lands on, read in the order both views paint the notes. */
import type { MacroCoord } from '../../../core/model/types';
import { zoneCellAt, zoneCellSet, zoneGrid, zoneHasCaption, type ChipNote, type MapAnnotation, type RouteNote, type ZoneNote } from '../../../core/model/annotations';
import { cellKey } from '../../../core/grid/rect';
import { annotationInkScale, chipApproxHeightCells, chipApproxWidthCells, INK_CELLS, routeHitDistCells, zoneLabelApproxHeightCells, zoneLabelApproxWidthCells } from '../../../core/model/annotation/text-metrics';
import { routeSamples, zoneLabelAnchor } from '../../../core/model/annotation/geometry';
import { dimensionHit, measureDrawing } from '../../../core/model/annotation/dimensions';
import type { AnnotateContext } from './channel';

/** The topmost committed zone whose cells hold map point `p`. */
export function zoneBodyAt(p: MacroCoord, ctx: AnnotateContext): ZoneNote | null {
  const items = ctx.state.annotations?.items ?? [];
  for (let i = items.length - 1; i >= 0; i--) {
    const n = items[i]!;
    if (n.kind !== 'zone') continue;
    const cell = zoneCellAt(p, zoneGrid(n));
    if (zoneCellSet(n.cells).has(cellKey(cell.x, cell.y))) return n;
  }
  return null;
}

/** The topmost route within reach of `p`. */
export function routeAt(p: MacroCoord, ctx: AnnotateContext): RouteNote | null {
  const items = ctx.state.annotations?.items ?? [];
  const reach = routeHitDistCells(annotationInkScale(ctx.state.template));
  for (let i = items.length - 1; i >= 0; i--) {
    const n = items[i]!;
    if (n.kind !== 'route') continue;
    for (const [sx, sy] of routeSamples(n.points, 8)) {
      if (Math.hypot(p.x - sx, p.y - sy) <= reach) return n;
    }
  }
  return null;
}

function captionHit(p: MacroCoord, n: ZoneNote, ink: number, ctx: AnnotateContext): boolean {
  if (ctx.annotationLabelHit !== undefined) return ctx.annotationLabelHit === n.id;
  const label = n.tag ? ctx.tagLabel(n.tag) : '';
  if (!zoneHasCaption(n, label)) return false;
  const at = zoneLabelAnchor(n.cells, zoneGrid(n));
  return Math.abs(p.x - at.x) <= zoneLabelApproxWidthCells(n, label, ink) / 2
    && Math.abs(p.y - at.y) <= zoneLabelApproxHeightCells(n, ink) / 2;
}

function chipContains(p: MacroCoord, note: ChipNote, ink: number, ctx: AnnotateContext): boolean {
  if (ctx.annotationLabelHit !== undefined) return ctx.annotationLabelHit === note.id;
  const reach = Math.max(0.35, INK_CELLS.text[note.size] * ink * 0.3);
  return Math.abs(p.x - note.x) <= chipApproxWidthCells(note, ctx.tagLabel(note.tag), ink) / 2 + reach
    && Math.abs(p.y - note.y) <= chipApproxHeightCells(note, ink) / 2 + reach;
}

/** The topmost chip under `p`. */
export function chipAt(p: MacroCoord, ctx: AnnotateContext): ChipNote | null {
  const ink = annotationInkScale(ctx.state.template);
  const items = ctx.state.annotations?.items ?? [];
  for (let i = items.length - 1; i >= 0; i--) {
    const note = items[i]!;
    if (note.kind === 'chip' && chipContains(p, note, ink, ctx)) return note;
  }
  return null;
}

/** Topmost note under a press: chips and captions read over routes, routes over zone bodies, later
 *  notes over earlier. */
export function hitAt(p: MacroCoord, ctx: AnnotateContext): MapAnnotation | null {
  const items = ctx.state.annotations?.items ?? [];
  const ink = annotationInkScale(ctx.state.template);
  if (ctx.annotationLabelHit) {
    const label = items.find(n => n.id === ctx.annotationLabelHit);
    if (label) return label;
  }
  for (let i = items.length - 1; i >= 0; i--) {
    const n = items[i]!;
    if (n.kind === 'measure' && dimensionHit(p, measureDrawing(n.points, ink, n.flipped), ink)) return n;
    if (n.kind === 'chip') {
      if (chipContains(p, n, ink, ctx)) return n;
    } else if (n.kind === 'zone' && captionHit(p, n, ink, ctx)) {
      return n;
    }
  }
  const route = routeAt(p, ctx);
  if (route) return route;
  return zoneBodyAt(p, ctx);
}
