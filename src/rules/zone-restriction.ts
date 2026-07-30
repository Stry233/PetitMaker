/**
 * V-ZONE-01: Zone Restriction (pre-command)
 *
 * Rejects any operation on a non-Grass zone (Void/Beach/Plaza→grass aside, only
 * Grass is buildable). The plaza is an immutable locked object; object-collision
 * rules (V-PLACE-BLOCK / V-PLACE-OVERLAP) keep terrain and objects off it.
 *
 * Guarantees:
 * - Reports one error per invalid cell (not one per command).
 * - Cells outside the grid (getCell null) are illegal for placement (an object
 *   can't hang over the void) but skipped for terrain edits (can't paint off-map).
 */
import {
  CommandType,
  type Command,
  type GridState,
  type MacroCoord,
  type PreCommandRule,
  type ValidationError,
} from '../core/model/types';
import { getCell, getFootprint, isBuildableZone } from '../core/model/grid-model';
import { getPlacedObjectSize } from '../state/object-geometry';

function extractCells(cmd: Command): MacroCoord[] {
  switch (cmd.type) {
    case CommandType.PaintTerrain:
    case CommandType.EraseTerrain:
      return cmd.cells;
    default:
      return [];
  }
}

export const zoneRestrictionRule: PreCommandRule = {
  id: 'V-ZONE-01',
  agentHint: 'Build only on grass zone (token "."). Sea/beach/plaza/boundary reject all edits.',
  phase: 'pre-command',
  // NOT RemoveObject: removing an object is always allowed regardless of the zone under it. (Gating
  // removal by zone trapped an object that ended up on non-grass — e.g. a bug-placed one — so it could
  // never be cleared, leaving it stuck in state + rendered. Removal must always succeed.)
  appliesTo: [CommandType.PaintTerrain, CommandType.EraseTerrain, CommandType.PlaceObject],
  validate(cmd: Command, state: GridState): ValidationError[] {
    const errors: ValidationError[] = [];

    // PlaceObject: EVERY cell the (rotated) footprint covers must be buildable,
    // not just the top-left anchor. Cells off the map (getCell null) are open
    // sea — treated as illegal, so an object can't hang over the void.
    if (cmd.type === CommandType.PlaceObject) {
      const { w, h } = getPlacedObjectSize(cmd.object);
      for (const coord of getFootprint(cmd.object.position.x, cmd.object.position.y, w, h)) {
        const cell = getCell(state.cells, coord.x, coord.y);
        if (!cell || !isBuildableZone(cell.zone)) {
          errors.push({ ruleId: 'V-ZONE-01', message: 'error.zone_restricted', cells: [coord], severity: 'error' });
        }
      }
      return errors;
    }

    // Terrain edits / object removal: per-cell; off-map cells are skipped (you
    // can't paint outside the grid anyway).
    for (const coord of extractCells(cmd)) {
      const cell = getCell(state.cells, coord.x, coord.y);
      if (!cell) continue;
      if (!isBuildableZone(cell.zone)) {
        errors.push({ ruleId: 'V-ZONE-01', message: 'error.zone_restricted', cells: [coord], severity: 'error' });
        continue;
      }
      // A painted terrain block renders shifted -HALF_TILE (up-left) vs the zone grid, so it visually
      // bleeds half a cell onto its UP, LEFT, and UP-LEFT (diagonal) neighbours — the block's top-left
      // micro-block lands squarely in the (x-1, y-1) cell. Reject painting where ANY of the three is
      // non-buildable: at a convex beach/void corner the diagonal is non-grass while up+left are grass,
      // so checking only up+left let the top-left micro-block sit on the beach. (Erase doesn't bleed.)
      if (cmd.type === CommandType.PaintTerrain) {
        const up = getCell(state.cells, coord.x, coord.y - 1);
        const left = getCell(state.cells, coord.x - 1, coord.y);
        const upLeft = getCell(state.cells, coord.x - 1, coord.y - 1);
        if ((up && !isBuildableZone(up.zone)) || (left && !isBuildableZone(left.zone)) || (upLeft && !isBuildableZone(upLeft.zone))) {
          errors.push({ ruleId: 'V-ZONE-01', message: 'error.zone_restricted', cells: [coord], severity: 'error' });
        }
      }
    }
    return errors;
  },
};
