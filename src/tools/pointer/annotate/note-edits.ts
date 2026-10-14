/** The figures and moves the notes tool's gestures share: brush footprints, drag figures, the
 *  layer's edit gate and how a note moves. */
import type { MacroCoord } from '../../../core/model/types';
import { zoneCellAt, type MapAnnotation } from '../../../core/model/annotations';
import { brushCells, dragShapeCells, expandLine, line4, snapShapeEnd, type DragShapeKind } from '../../../core/grid/shapes';
import { cellCentre } from '../../../core/grid/grid-convert';
import type { AnnotateContext } from './channel';

/** Pointer travel, in cells, below which a press is a click. */
export const CLICK_SLOP = 0.2;

/** The road brush's dab on `cell`. */
export function footprint(cell: MacroCoord, ctx: AnnotateContext): MacroCoord[] {
  return brushCells(cell.x, cell.y, ctx.arming.brushSize);
}

/** The free brush's run from one pointer sample to the next, as the road brush lays it. */
export function run(from: MacroCoord, to: MacroCoord, ctx: AnnotateContext): MacroCoord[] {
  return expandLine(line4(from.x, from.y, to.x, to.y), ctx.arming.brushSize);
}

/** A drag figure from `from` to `to`, with the paint tools' own builder and constrain key. */
export function figureCells(shape: DragShapeKind, from: MacroCoord, to: MacroCoord, ctx: AnnotateContext): MacroCoord[] {
  return dragShapeCells(shape, from, ctx.modifiers.constrain ? snapShapeEnd(from, to, shape) : to, ctx.arming.brushSize);
}

/** The map point under the pointer, else the cell's centre in a headless context. */
export function finePoint(coord: MacroCoord, ctx: AnnotateContext): MacroCoord {
  return ctx.point ?? cellCentre(coord);
}

/** Whether an edit may land, saying why not when it may not. A null layer is an empty one. */
export function layerEditable(ctx: AnnotateContext): boolean {
  if (!ctx.state.annotations) return true;
  if (!ctx.state.annotations.visible) {
    ctx.notify(ctx.t('annot.hidden'), 'warning');
    return false;
  }
  if (ctx.state.annotations.locked) {
    ctx.notify(ctx.t('annot.locked'), 'warning');
    return false;
  }
  return true;
}

/** An independent copy of a note, so a drag keeps measuring from where it began while the live
 *  items move under it. A planning note is plain data: cells, anchors, ids, colours and numbers. */
export function copyNote(note: MapAnnotation): MapAnnotation {
  return JSON.parse(JSON.stringify(note)) as MapAnnotation;
}

/** A measurement's far end: the cell under `point`, on the row or column of `start` it is nearer. */
export function measureEnd(start: MacroCoord, point: MacroCoord): MacroCoord {
  const end = zoneCellAt(point);
  return Math.abs(end.x - start.x) >= Math.abs(end.y - start.y)
    ? { x: end.x, y: start.y }
    : { x: start.x, y: end.y };
}

/** Zones and measurements move by whole cells; chips and routes retain fractional positions. */
export function movedBy(orig: MapAnnotation, dx: number, dy: number): MapAnnotation {
  if (orig.kind === 'zone') {
    const ix = Math.round(dx);
    const iy = Math.round(dy);
    return { ...orig, cells: orig.cells.map((c) => ({ x: c.x + ix, y: c.y + iy })) };
  }
  if (orig.kind === 'measure') return { ...orig, points: orig.points.map(p => ({ x: p.x + Math.round(dx), y: p.y + Math.round(dy) })) as [MacroCoord, MacroCoord] };
  if (orig.kind === 'chip') return { ...orig, x: orig.x + dx, y: orig.y + dy };
  return { ...orig, points: orig.points.map((pt) => ({ ...pt, x: pt.x + dx, y: pt.y + dy })) };
}
