import type { GridState, MacroCoord, ValidationError } from '../../core/model/types';
import { cellKey, cellOverlapsRect } from '../../core/model/grid-model';
import { getCatalogItem } from '../../state/catalog';
import { entriesNear, getObjectIndex } from '../../state/object-index';
import { overlappingCoatings, removeOverlappingCoatings } from '../objects/object-placer';
import { planPaint } from './paint-plan';
import type { ToolContext } from '../runtime/types';

/** Ghost/preview color (0xRRGGBB) for the given tile material. */
export function tileGhostColor(material: string): number {
  const item = getCatalogItem(material);
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

  // Strip FIRST: a coating over a coating is refused outright (V-PLACE-OVERLAP), so the
  // replacement must clear the cell before it can validate. A refusal after the strip — the cell
  // is sea, plaza, or off the map — rolls the strip back, so the pair stays all-or-nothing and a
  // road is never deleted for a tile that nothing placed.
  const start = ctx.getUndoStackSize();
  removeOverlappingCoatings([coord], ctx);
  if (!ctx.executeCommand(cmd).success) {
    ctx.rollbackTo(start);
    return false;
  }
  painted.add(cellKey(coord.x, coord.y));
  return true;
}

/** Remove any tile/coating object covering the given cells. */
export function eraseTileCells(cells: MacroCoord[], ctx: ToolContext): void {
  removeOverlappingCoatings(cells, ctx);
}

/**
 * Whether a placement refusal is ONLY the coating the tile click strips first — the one refusal
 * the click makes legal. Shared by the cursor probe and the road-trim ghost, so every promise
 * matches what the click commits: a coating over a coating is refused outright by
 * V-PLACE-OVERLAP, and only the strip-then-place pair gets past it.
 */
export function strippableRefusal(gs: GridState, coord: MacroCoord, errors: readonly ValidationError[]): boolean {
  if (errors.length === 0 || !errors.every((e) => e.ruleId === 'V-PLACE-OVERLAP')) return false;
  if (overlappingCoatings(gs, [coord]).length === 0) return false;
  for (const e of entriesNear(getObjectIndex(gs), { x: coord.x, y: coord.y, w: 1, h: 1 })) {
    if (!e.coating && cellOverlapsRect(e.rect, coord.x, coord.y, 0)) return false; // a solid no strip removes
  }
  return true;
}
