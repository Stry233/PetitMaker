/** The figures the notes tool's gestures share: brush footprints, drag figures and the layer's
 *  edit gate; a note moves through `core/model/annotations.ts:movedNote`. Zone figures run in
 *  half-cell steps: a step is the half-grid cell at the corner of the whole cell `noteStepCell` puts
 *  under the pointer, and every figure is a set of half-grid cells. */
import type { MacroCoord } from '../../../core/model/types';
import { HALVES, noteStepCell, zoneCellAt, zoneHalfCells, type MapAnnotation } from '../../../core/model/annotations';
import { brushCells, circleCells, line4, rectCells, snapShapeEnd, splinePath, type DragShapeKind } from '../../../core/grid/shapes';
import { cellCentre } from '../../../core/grid/grid-convert';
import { cellKey } from '../../../core/grid/rect';
import { HALF_GRID } from '../../../core/game/profile';
import type { CurveAnchor } from '../../../core/base/spline';
import type { AnnotateContext } from './channel';

/** The id every note ghost wears; a ghost never enters the notes, so it never meets a real id. */
export const NOTE_GHOST_ID = 'note-ghost';

/** Pointer travel, in cells, below which a press is a click. */
export const CLICK_SLOP = 0.2;

/** The step under map point `p`. */
export function stepAt(p: MacroCoord): MacroCoord {
  return zoneCellAt(noteStepCell(p), HALF_GRID);
}

/** The distance between two steps, in map cells. */
export function stepDistance(a: MacroCoord, b: MacroCoord): number {
  return Math.hypot(a.x - b.x, a.y - b.y) / HALVES;
}

/** Whole cells `cells`, counted from a step's whole cell, laid at `step` as half-grid cells. */
function wholeAt(step: MacroCoord, cells: readonly MacroCoord[]): MacroCoord[] {
  return zoneHalfCells({ cells: [...cells] }).map((c) => ({ x: c.x + step.x, y: c.y + step.y }));
}

/** The steps `build` lays through `steps`: on the whole-cell lattice of the first step when every
 *  step lies on it, so whole-cell input lays exactly the whole-cell figure, else on the half grid. */
function stepPath(steps: readonly MacroCoord[], build: (pts: MacroCoord[]) => MacroCoord[]): MacroCoord[] {
  const base = steps[0]!;
  const coarse = steps.every((p) => (p.x - base.x) % HALVES === 0 && (p.y - base.y) % HALVES === 0);
  if (!coarse) return build([...steps]);
  return build(steps.map((p) => ({ x: (p.x - base.x) / HALVES, y: (p.y - base.y) / HALVES })))
    .map((q) => ({ x: base.x + q.x * HALVES, y: base.y + q.y * HALVES }));
}

/** The road brush's dab at `step`. */
export function footprint(step: MacroCoord, ctx: AnnotateContext): MacroCoord[] {
  return wholeAt(step, brushCells(0, 0, ctx.arming.brushSize));
}

/** The brush's dab swept along `path`, each half cell once, in first-reached order. */
function band(path: readonly MacroCoord[], ctx: AnnotateContext): MacroCoord[] {
  const dab = brushCells(0, 0, ctx.arming.brushSize);
  const seen = new Set<string>();
  const out: MacroCoord[] = [];
  for (const step of path) {
    for (const c of wholeAt(step, dab)) {
      const k = cellKey(c.x, c.y);
      if (!seen.has(k)) { seen.add(k); out.push(c); }
    }
  }
  return out;
}

/** The free brush's run from one pointer step to the next, as the road brush lays it. */
export function run(from: MacroCoord, to: MacroCoord, ctx: AnnotateContext): MacroCoord[] {
  return band(stepPath([from, to], ([a, b]) => line4(a!.x, a!.y, b!.x, b!.y)), ctx);
}

/** The curve through the steps `anchors`, at the brush width. */
export function curveCells(anchors: readonly MacroCoord[], ctx: AnnotateContext): MacroCoord[] {
  return band(stepPath(anchors, (pts) => splinePath(pts as CurveAnchor[])), ctx);
}

/** A drag figure from step `from` to step `to`, with the paint tools' own builders and constrain
 *  key: a line at the brush width, a rectangle from cell to cell, a circle round the first cell. */
export function figureCells(shape: DragShapeKind, from: MacroCoord, to: MacroCoord, ctx: AnnotateContext): MacroCoord[] {
  const end = ctx.modifiers.constrain ? snapShapeEnd(from, to, shape) : to;
  switch (shape) {
    case 'line': return band(stepPath([from, end], ([a, b]) => line4(a!.x, a!.y, b!.x, b!.y)), ctx);
    case 'rect': return rectCells(
      { x: Math.min(from.x, end.x), y: Math.min(from.y, end.y) },
      { x: Math.max(from.x, end.x) + HALVES - 1, y: Math.max(from.y, end.y) + HALVES - 1 },
    );
    case 'circle': return wholeAt(from, circleCells({ x: 0, y: 0 }, Math.abs(end.x - from.x) / HALVES, Math.abs(end.y - from.y) / HALVES));
  }
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

/** A measurement's far end: the step cell under `point`, on the row or column of `start` it is nearer. */
export function measureEnd(start: MacroCoord, point: MacroCoord): MacroCoord {
  const end = noteStepCell(point);
  return Math.abs(end.x - start.x) >= Math.abs(end.y - start.y)
    ? { x: end.x, y: start.y }
    : { x: start.x, y: end.y };
}

