/**
 * What one build-brush stroke has laid, and the trimming that keeps its shape derived from the
 * finished mass. A road is an object coating rather than a terrain cell, so the stroke keeps the two
 * apart and every reader asks for the surface it is armed with.
 */
import { trimRoadCommand, trimTerrainCommand } from '../../../core/model/command-build';
import { type MacroCoord } from '../../../core/model/types';
import { getCell } from '../../../core/model/grid-model';
import { cellKey, parseCellKey } from '../../../core/grid/rect';
import { SQUARE_CORNERS, isSquareCorners } from '../../../core/model/corners';
import { reconcileCuts } from '../../../core/domain/edge-cut/cut-reconcile';
import { roadLookup } from '../../../state/object-index';
import { applyAutoEdgeCut } from '../../trim/auto-edge-cut';
import type { ToolContext } from '../runtime/types';
import { paintTrimMode } from './trim-mode';

/** The cell itself plus its 8 neighbours, the reach of the auto-trim pass (`withBorder`). */
const BASELINE_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1],
];

/** Whether the brush is laying road tiles rather than terrain. */
export const laysTiles = (ctx: ToolContext): boolean => ctx.arming.contentType === 'road';

export class StrokeCells {
  /** Terrain cells and road cells this stroke laid, as `cellKey`s. */
  readonly terrain = new Set<string>();
  readonly tiles = new Set<string>();
  /** Whether the stroke was trimmed as it was drawn (freehand only), so its end squares it first. */
  liveTrimmed = false;

  clear(): void {
    this.terrain.clear();
    this.tiles.clear();
    this.liveTrimmed = false;
  }

  /** The cells laid on the surface `ctx` is armed with. */
  laid(ctx: ToolContext): Set<string> {
    return laysTiles(ctx) ? this.tiles : this.terrain;
  }

  coords(ctx: ToolContext): MacroCoord[] {
    return [...this.laid(ctx)].map(parseCellKey);
  }
}

/** Put the stroke's own cells back to square, so the final pass derives their shape from the finished
 *  mass rather than from what the drag rounded on its way through. A road's cut is derived from which
 *  sides it connects on, so a tile the drag has since paved past is squared the same way. */
export function squareStroke(cells: readonly MacroCoord[], ctx: ToolContext): void {
  if (laysTiles(ctx)) {
    const roads = roadLookup(ctx.state);
    for (const { x, y } of cells) {
      const road = roads(x, y);
      if (!road?.corners || isSquareCorners(road.corners)) continue;
      ctx.execute(trimRoadCommand(road, x, y, [...SQUARE_CORNERS]));
    }
    return;
  }
  for (const { x, y } of cells) {
    const t = getCell(ctx.state.cells, x, y)?.terrain;
    // A Γ patch is its corners, so squaring one leaves a patch of nothing; the trim pass owns them.
    if (t?.patchOnly) continue;
    const corners = t?.corners;
    if (isSquareCorners(corners)) continue;
    ctx.execute(trimTerrainCommand(x, y, [...SQUARE_CORNERS]));
  }
}

/** The dab plus the ring around it, and only cells this stroke laid: the next dab lands against the
 *  last one, so a shape derived a moment ago is derived from a different neighbourhood now. */
function strokeWindow(cells: readonly MacroCoord[], laid: ReadonlySet<string>): MacroCoord[] {
  const window: MacroCoord[] = [];
  const seen = new Set<string>();
  for (const c of cells) {
    for (const [dx, dy] of BASELINE_OFFSETS) {
      const x = c.x + dx, y = c.y + dy, k = cellKey(x, y);
      if (seen.has(k) || !laid.has(k)) continue;
      seen.add(k);
      window.push({ x, y });
    }
  }
  return window;
}

/**
 * Trim what a freehand dab just laid, while the drag is still going, so the stroke rounds under the
 * cursor. The stroke-end pass still decides the final shape and squares the stroke's own cells first.
 * Terrain repairs the cuts the dab invalidated, squares the window and derives it again; a road has no
 * corners to reconcile and no notch to fill, so it is squared and trimmed.
 */
export function liveTrim(cells: MacroCoord[], ctx: ToolContext, stroke: StrokeCells): void {
  const mode = paintTrimMode(ctx);
  if (mode === 'off') return;
  stroke.liveTrimmed = true;
  const window = strokeWindow(cells, stroke.laid(ctx));
  if (laysTiles(ctx)) {
    squareStroke(window, ctx);
    applyAutoEdgeCut(ctx, mode, [], window);
    return;
  }
  reconcileCuts(window, { state: ctx.state, execute: (cmd) => ctx.execute(cmd), validatePre: ctx.validateCommand }, roadLookup(ctx.state));
  squareStroke(window, ctx);
  applyAutoEdgeCut(ctx, mode, window, []);
}
