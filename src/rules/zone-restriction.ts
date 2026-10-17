/**
 * V-ZONE-01: Zone Restriction (pre-command)
 *
 * Rejects painting, erasing or placing on a non-Grass zone: only Grass is
 * buildable, except that an item's `groundZones` trait may let its footprint stand wholly on sand
 * (and, with `acrossBoundary`, across grass and sand). A landmark stands on the ground its profile names instead
 * (`core/game/profile.ts:LandmarkGround`), read from each cell's own ground. A template records grass
 * under a locked landmark, and the collision rules (V-PLACE-BLOCK / V-PLACE-OVERLAP) keep terrain and
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
  type Command,
  type GridState,
  type MacroCoord,
  type ValidationError,
} from '../core/model/types';
import { getCell, clearsTerrain, commandGrid } from '../core/model/grid-model';
import { cellKey } from '../core/grid/rect';
import { groundZone, isBuildableZone, isSandZone } from '../core/game/zones';
import { groundZonesOf } from '../core/model/traits';
import { getCatalogItem } from '../state/catalog';
import { landmarkSpec } from '../core/game/profile';
import { landmarkGroundHolds } from '../core/model/landmarks';
import { getPlacedObjectSize } from '../state/object-geometry';
import { footprintCells } from '../core/grid/footprint';
import { evidenceOn } from '../core/grid/grids';
import { definePreRule } from './define';

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

/** Whether a terrain block painted at `coord` would bleed onto ground `buildableAt` refuses (`null`
 *  off the map, which takes any bleed). A block renders shifted half a cell up-left of the zone
 *  grid, so it reaches its up, left and up-left neighbours; at a convex coast corner only the
 *  diagonal may be off grass. A plan over a template asks this with its own reading of the ground. */
export function bleedsOffBuildable(buildableAt: (x: number, y: number) => boolean | null, coord: MacroCoord): boolean {
  for (const [dx, dy] of [[0, -1], [-1, 0], [-1, -1]] as const) {
    if (buildableAt(coord.x + dx, coord.y + dy) === false) return true;
  }
  return false;
}

/** `bleedsOffBuildable` over the map's zones: V-ZONE-01's paint test. */
export function paintBleedsOffBuildable(state: Pick<GridState, 'cells'>, coord: MacroCoord): boolean {
  return bleedsOffBuildable((x, y) => {
    const n = getCell(state.cells, x, y);
    return n ? isBuildableZone(n.zone) : null;
  }, coord);
}

export const zoneRestrictionRule = definePreRule({
  id: 'V-ZONE-01',
  // Not RemoveObject: removal must always succeed, whatever the zone under the object. Gated by zone,
  // an object standing on non-grass could never be cleared — stuck in state and rendered forever.
  appliesTo: [CommandType.PaintTerrain, CommandType.EraseTerrain, CommandType.PlaceObject],
  validate(cmd, state, fail) {
    const errors: ValidationError[] = [];

    // PlaceObject: Every cell the (rotated) footprint covers must be buildable,
    // not just the top-left anchor. Cells off the map (getCell null) are open
    // sea — treated as illegal, so an object can't hang over the void. The
    // footprint is swept as covered cells: this rule runs after V-PLACE-TRAIT,
    // which may have snapped a halfStep item onto a half cell, and `pos + integer
    // offset` from a half origin names cells that do not exist — every lookup
    // would come back null and reject the placement outright.
    if (cmd.type === CommandType.PlaceObject) {
      const { w, h } = getPlacedObjectSize(cmd.object);
      const landmark = landmarkSpec(cmd.object.catalogId);
      if (landmark?.ground === 'coast') {
        const rect = { x: cmd.object.position.x, y: cmd.object.position.y, width: w, height: h };
        const zoneAt = (x: number, y: number) => { const c = getCell(state.cells, x, y); return c ? groundZone(c) : undefined; };
        if (landmarkGroundHolds(landmark, rect, cmd.object.rotation, zoneAt)) return [];
        return [fail('error.landmark_coast', evidenceOn(commandGrid(cmd), footprintCells(rect.x, rect.y, w, h)))];
      }
      // Each footprint cell is buildable ground, sand, or neither; the item's ground zones say which
      // it may stand wholly on, and whether its footprint may take both.
      const item = getCatalogItem(cmd.object.catalogId);
      const zones = item ? groundZonesOf(item) : { onGrass: true, onSand: false, acrossBoundary: false };
      const footprint = footprintCells(cmd.object.position.x, cmd.object.position.y, w, h);
      let grass = 0, sand = 0;
      for (const c of footprint) {
        const cell = getCell(state.cells, c.x, c.y);
        const kind = !cell ? null : isBuildableZone(cell.zone) ? 'grass' : isSandZone(groundZone(cell)) ? 'sand' : null;
        if (kind === 'grass' && zones.onGrass) grass++;
        else if (kind === 'sand' && zones.onSand) sand++;
        else errors.push(fail('error.zone_restricted', evidenceOn(commandGrid(cmd), [c])));
      }
      if (errors.length === 0 && grass > 0 && sand > 0 && !zones.acrossBoundary) {
        errors.push(fail('error.across_zone_boundary', evidenceOn(commandGrid(cmd), footprint)));
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
      clears: clearsTerrain(cmd),
    } : null;
    for (const coord of cells) {
      const cell = getCell(state.cells, coord.x, coord.y);
      if (!cell) continue;
      if (!groundEdit && !isBuildableZone(cell.zone)) {
        errors.push(fail('error.zone_restricted', evidenceOn(commandGrid(cmd), [coord])));
        continue;
      }
      // The mirror of the bleed guard below: a block bleeds onto its up, left and up-left cells, so a
      // ground edit may not turn a cell to sea or sand while its right, down or down-right neighbour
      // still holds a block after the command.
      if (own && bleedsOnto(state, coord, own)) {
        errors.push(fail('error.ground_under_block', evidenceOn(commandGrid(cmd), [coord])));
        continue;
      }
      // A painted block's top-left micro-block lands in the (x-1, y-1) cell, so all three up-left
      // neighbours must be buildable (`paintBleedsOffBuildable`). Erase doesn't bleed.
      if (cmd.type === CommandType.PaintTerrain && !groundEdit && paintBleedsOffBuildable(state, coord)) {
        errors.push(fail('error.zone_restricted', evidenceOn(commandGrid(cmd), [coord])));
      }
    }
    return errors;
  },
});
