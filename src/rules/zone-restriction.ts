/**
 * V-ZONE-01: Zone Restriction (pre-command)
 *
 * Rejects painting, erasing or placing on a non-Grass zone: only Grass is
 * buildable. A template's Plaza zone loads as Grass under the locked plaza object,
 * and the collision rules (V-PLACE-BLOCK / V-PLACE-OVERLAP) keep terrain and
 * objects off that footprint. A planet-session ground edit rewrites the zone
 * itself and is checked only for bleed.
 *
 * Guarantees:
 * - Reports one error per invalid cell (not one per command).
 * - Cells outside the grid (getCell null) are illegal for placement (an object
 *   can't hang over the void) but skipped for terrain edits (can't paint off-map).
 */
import {
  CommandType,
  TerrainType,
  type Command,
  type GridState,
  type MacroCoord,
  type PreCommandRule,
  type ValidationError,
} from '../core/model/types';
import { cellKey, getCell, isBuildableZone } from '../core/model/grid-model';
import { coveredCells, getPlacedObjectSize } from '../state/object-geometry';

function extractCells(cmd: Command): MacroCoord[] {
  switch (cmd.type) {
    case CommandType.PaintTerrain:
    case CommandType.EraseTerrain:
      return cmd.cells;
    default:
      return [];
  }
}

/** A ground command's own cells, and whether they end the command without terrain. */
interface GroundCells { cells: ReadonlySet<string>; clears: boolean }

/** Whether a right, down or down-right neighbour of `coord` holds terrain once the command has
 *  applied. The command's own cells hold terrain afterwards unless it clears them. */
function bleedsOnto(state: GridState, coord: MacroCoord, own: GroundCells): boolean {
  for (const [dx, dy] of [[1, 0], [0, 1], [1, 1]] as const) {
    const x = coord.x + dx, y = coord.y + dy;
    const held = own.cells.has(cellKey(x, y)) ? !own.clears : getCell(state.cells, x, y)?.terrain != null;
    if (held) return true;
  }
  return false;
}

/** Whether a terrain block painted at `coord` would bleed onto a non-buildable cell. A block renders
 *  shifted half a cell up-left of the zone grid, so it reaches its UP, LEFT and UP-LEFT neighbours;
 *  at a convex coast corner only the diagonal may be off grass. */
export function paintBleedsOffBuildable(state: Pick<GridState, 'cells'>, coord: MacroCoord): boolean {
  for (const [dx, dy] of [[0, -1], [-1, 0], [-1, -1]] as const) {
    const n = getCell(state.cells, coord.x + dx, coord.y + dy);
    if (n && !isBuildableZone(n.zone)) return true;
  }
  return false;
}

export const zoneRestrictionRule: PreCommandRule = {
  id: 'V-ZONE-01',
  agentHint: 'Build only on grass zone (token "."). Sea/beach/plaza/boundary reject all edits.',
  phase: 'pre-command',
  // NOT RemoveObject: removal must always succeed, whatever the zone under the object. Gated by zone,
  // an object standing on non-grass could never be cleared — stuck in state and rendered forever.
  appliesTo: [CommandType.PaintTerrain, CommandType.EraseTerrain, CommandType.PlaceObject],
  validate(cmd: Command, state: GridState): ValidationError[] {
    const errors: ValidationError[] = [];

    // PlaceObject: EVERY cell the (rotated) footprint covers must be buildable,
    // not just the top-left anchor. Cells off the map (getCell null) are open
    // sea — treated as illegal, so an object can't hang over the void. The
    // footprint is swept as COVERED cells: this rule runs after V-PLACE-TRAIT,
    // which may have snapped a halfStep item onto a half cell, and `pos + integer
    // offset` from a half origin names cells that do not exist — every lookup
    // would come back null and reject the placement outright.
    if (cmd.type === CommandType.PlaceObject) {
      const { w, h } = getPlacedObjectSize(cmd.object);
      for (const cy of coveredCells(cmd.object.position.y, h)) {
        for (const cx of coveredCells(cmd.object.position.x, w)) {
          const cell = getCell(state.cells, cx, cy);
          if (!cell || !isBuildableZone(cell.zone)) {
            errors.push({ ruleId: 'V-ZONE-01', message: 'error.zone_restricted', cells: [{ x: cx, y: cy }], severity: 'error' });
          }
        }
      }
      return errors;
    }

    // Terrain edits: per-cell; off-map cells are skipped (you can't paint outside
    // the grid anyway). A ground edit (planet session) rewrites the zone itself,
    // so the current zone is no obstacle; one that leaves sea or sand asks the bleed question below,
    // the only reader of the command's own cell set.
    const cells = extractCells(cmd);
    const ground = cmd.type === CommandType.PaintTerrain || cmd.type === CommandType.EraseTerrain ? cmd.ground : undefined;
    const groundEdit = ground !== undefined;
    const own: GroundCells | null = groundEdit && !isBuildableZone(ground) ? {
      cells: new Set(cells.map((c) => cellKey(c.x, c.y))),
      clears: cmd.type === CommandType.EraseTerrain
        || (cmd.type === CommandType.PaintTerrain && cmd.terrainType === TerrainType.Mountain && cmd.elevation === 0),
    } : null;
    for (const coord of cells) {
      const cell = getCell(state.cells, coord.x, coord.y);
      if (!cell) continue;
      if (!groundEdit && !isBuildableZone(cell.zone)) {
        errors.push({ ruleId: 'V-ZONE-01', message: 'error.zone_restricted', cells: [coord], severity: 'error' });
        continue;
      }
      // The mirror of the bleed guard below: a block bleeds onto its up, left and up-left cells, so a
      // ground edit may not turn a cell to sea or sand while its right, down or down-right neighbour
      // still holds a block after the command.
      if (own && bleedsOnto(state, coord, own)) {
        errors.push({ ruleId: 'V-ZONE-01', message: 'error.ground_under_block', cells: [coord], severity: 'error' });
        continue;
      }
      // A painted block's top-left micro-block lands in the (x-1, y-1) cell, so all three up-left
      // neighbours must be buildable (`paintBleedsOffBuildable`). Erase doesn't bleed.
      if (cmd.type === CommandType.PaintTerrain && !groundEdit && paintBleedsOffBuildable(state, coord)) {
        errors.push({ ruleId: 'V-ZONE-01', message: 'error.zone_restricted', cells: [coord], severity: 'error' });
      }
    }
    return errors;
  },
};
