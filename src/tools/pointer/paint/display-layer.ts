/**
 * The layer panel's highlight while the build brush paints: where a dab is landing, never the build
 * floor, since a layer the ground chose must not pin the next stroke.
 */
import type { MacroCoord } from '../../../core/model/types';
import { getCell } from '../../../core/model/grid-model';
import { cellKey } from '../../../core/grid/rect';
import { ELEVATION_MAX } from '../../../core/game/profile';
import type { ToolContext } from '../runtime/types';
import { autoStackTarget, buildFloor, isLowGround, mountainCeiling, mountainRung, waterLayerAt } from './paint-plan';

/** The highlight for the cell under a dab, read before the dab paints it: water's landing layer, the
 *  mountain's auto-stack target, and none for a road. */
export function showDabLayer(coord: MacroCoord, ctx: ToolContext): void {
  if (ctx.arming.contentType === 'water') { ctx.setDisplayLayer(waterLayerAt(coord, ctx)); return; }
  if (ctx.arming.contentType !== 'mountain') { ctx.setDisplayLayer(null); return; }
  const cell = getCell(ctx.state.cells, coord.x, coord.y);
  // Sea, and sand in either material, lay layer 0 in the planet session.
  if (cell && ctx.arming.groundEditable && (ctx.arming.planetMaterial === 'sand' || isLowGround(cell, ctx))) { ctx.setDisplayLayer(0); return; }
  if (!cell) { ctx.setDisplayLayer(Math.max(0, autoStackTarget(0, buildFloor(ctx), mountainCeiling(ctx)))); return; }
  const { from, target } = mountainRung(cell, ctx);
  ctx.setDisplayLayer(Math.max(from, target));
}

/**
 * After the commit, settle the highlight on what the cell the stroke ended over became, so a capped or
 * reverted stack shows its real height. Only that cell counts, never the stroke's maximum, and a cell
 * the stroke did not lay or that holds nothing keeps the live value. Water reads the layer that cell
 * holds, which is where the last dab put its water.
 */
export function settleStrokeLayer(ctx: ToolContext, focus: MacroCoord | undefined, laid: ReadonlySet<string>): void {
  if (ctx.arming.contentType === 'water') {
    if (focus) ctx.setDisplayLayer(waterLayerAt(focus, ctx));
    return;
  }
  if (ctx.arming.contentType !== 'mountain') { ctx.setDisplayLayer(null); return; }
  if (!focus || !laid.has(cellKey(focus.x, focus.y))) return;
  const achieved = getCell(ctx.state.cells, focus.x, focus.y)?.terrain?.elevation ?? 0;
  if (achieved > 0) ctx.setDisplayLayer(Math.min(ELEVATION_MAX, achieved));
}
