/**
 * The trimmed shape a build-brush ghost promises. With auto-trim on, a committed stroke has cut
 * corners and can gain Γ patches in its notches (a road stroke, cut end-caps and bends), so the ghost
 * runs the real trim pass: terrain over a scratch copy of the cells, a road over a shadowed coating
 * lookup (`previewRoadTrim`). Both return `TrimmedCell`s, so a view is handed one payload.
 */
import type { Command, MacroCoord } from '../../../core/model/types';
import type { RowSpan } from '../../../core/grid/cell-spans';
import { previewAutoTrim, shapeOfCells, shapeOfSpans, type GhostShape, type TrimmedCell } from '../../trim/trim-preview';
import { previewRoadTrim } from '../../trim/road-trim-preview';
import type { ToolContext } from '../runtime/types';
import { planPaint } from './paint-plan';
import { laysTiles } from './stroke-cells';
import { paintTrimMode } from './trim-mode';

/** The probe asks as if the stroke had not started: a hover is not part of anyone's stroke. */
export const FRESH_STROKE: ReadonlySet<string> = new Set<string>();

/** `laidTiles` are the road cells this stroke laid; `before` runs on the scratch ahead of the paint
 *  (a curve's baseline restore, so an adjust ghost is not shaped by the curve it replaces). */
function trimOfShape(
  shape: GhostShape, ctx: ToolContext, before: Command[], laidTiles: ReadonlySet<string>,
): TrimmedCell[] | undefined {
  const mode = paintTrimMode(ctx);
  if (mode === 'off') return undefined;
  if (laysTiles(ctx)) {
    return previewRoadTrim(ctx.state, mode, shape, ctx.registry, {
      plan: (cells) => planPaint(cells, ctx, 'road', FRESH_STROKE).commands, laidThisStroke: laidTiles,
    });
  }
  return previewAutoTrim(ctx.state, mode, shape, ctx.registry, {
    plan: (paint, on) => planPaint(paint, { ...ctx, state: on }, ctx.arming.contentType, FRESH_STROKE).commands,
    before,
  })
    // The trim also reshapes the corners of terrain the stroke lands against. That is a change to the
    // map, not to the shape being placed; a Γ patch is kept, since the shape grows into that cell.
    .filter((t) => t.patch || shape.contains(t.x, t.y));
}

export function trimOfCells(
  cells: MacroCoord[], ctx: ToolContext, before: Command[], laidTiles: ReadonlySet<string>,
): TrimmedCell[] | undefined {
  return cells.length === 0 ? undefined : trimOfShape(shapeOfCells(cells), ctx, before, laidTiles);
}

/** The same for a span-form ghost (rect, circle), which never builds its own cell list: only the rim
 *  of a shape can be trimmed, and that is derivable from the spans. */
export function trimOfSpans(spans: readonly RowSpan[], ctx: ToolContext, laidTiles: ReadonlySet<string>): TrimmedCell[] | undefined {
  return spans.length === 0 ? undefined : trimOfShape(shapeOfSpans(spans), ctx, [], laidTiles);
}
