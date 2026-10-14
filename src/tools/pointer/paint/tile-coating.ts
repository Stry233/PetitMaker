import { getCatalogItem } from '../../../state/catalog';
import { coatingLayer } from '../../../core/model/traits';
import type { MacroCoord } from '../../../core/model/types';
import { cellKey } from '../../../core/grid/rect';
import { removeOverlappingCoatings } from '../../placement/coatings';
import { planPaint } from './paint-plan';
import type { ToolContext } from '../runtime/types';

/**
 * Execute the tile click on one cell. What to place is `planPaint`'s call — off-grid, water and
 * unknown-material cells come back with no command — so this only does the parts a plan must not:
 * strip the coating it replaces, execute, and record the cell in the stroke.
 *
 * Returns true iff a place command executed successfully.
 */
export function placeTileCell(coord: MacroCoord, ctx: ToolContext, painted: Set<string>): boolean {
  const cmd = planPaint([coord], ctx, 'road', painted).commands[0];
  if (!cmd) return false;

  // Strip first: a coating over a coating is refused outright (V-PLACE-OVERLAP), so the
  // replacement must clear the cell before it can validate. A refusal after the strip — the cell
  // is sea, a landmark, or off the map — rolls the strip back, so the pair stays all-or-nothing and a
  // road is never deleted for a tile that nothing placed.
  const stroke = ctx.beginStroke();
  removeOverlappingCoatings([coord], ctx, getCatalogItem(ctx.arming.tileMaterial));
  if (!ctx.execute(cmd).success) {
    stroke.rollback();
    return false;
  }
  painted.add(cellKey(coord.x, coord.y));
  return true;
}

/** Remove any tile/coating object covering the given cells. */
export function eraseTileCells(cells: MacroCoord[], ctx: ToolContext): void {
  removeOverlappingCoatings(cells, ctx, undefined, coatingLayer(getCatalogItem(ctx.arming.tileMaterial)));
}

