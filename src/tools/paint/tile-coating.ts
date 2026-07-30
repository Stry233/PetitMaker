import type { MacroCoord } from '../../core/model/types';
import { cellKey } from '../../core/model/grid-model';
import { getCatalogItem } from '../../state/catalog';
import { useEditorStore } from '../../state/store';
import { removeOverlappingCoatings } from '../objects/object-placer';
import { planPaint, tileCatalogId } from './paint-plan';
import type { ToolContext } from '../types';

export type { TileMaterial } from './paint-plan';
export { tileCatalogId } from './paint-plan';

/** Ghost/preview color (0xRRGGBB) for the currently-selected tile material. */
export function tileGhostColor(): number {
  const item = getCatalogItem(tileCatalogId(useEditorStore.getState().tileMaterial));
  return item?.color ? parseInt(item.color.slice(1), 16) : 0xd2b48c;
}

/**
 * Execute the tile click on one cell. What to place is `planPaint`'s call — off-grid, water and
 * unknown-material cells come back with no command — so this only does the parts a plan must not:
 * strip the coating it replaces, execute, and record the cell in the stroke.
 *
 * Returns true iff a place command executed successfully.
 */
export function placeTileCell(coord: MacroCoord, ctx: ToolContext, painted: Set<string>): boolean {
  const cmd = planPaint([coord], ctx, 'tile', painted).commands[0];
  if (!cmd) return false;

  removeOverlappingCoatings([coord], ctx);

  if (!ctx.executeCommand(cmd).success) return false;
  painted.add(cellKey(coord.x, coord.y));
  return true;
}

/** Remove any tile/coating object covering the given cells. */
export function eraseTileCells(cells: MacroCoord[], ctx: ToolContext): void {
  removeOverlappingCoatings(cells, ctx);
}
