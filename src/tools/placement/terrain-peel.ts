import { eraseTerrainCommand, paintTerrainCommand } from '../../core/model/command-build';
import { TerrainType } from '../../core/model/types';
import { OFF_MAP_ZONE, groundZone, isLandZone } from '../../core/game/zones';
import { structuralTop } from '../../core/domain/terrain/terrain-surface';
import { groundCommand } from './ground-command';
import type { Command, MacroCell } from '../../core/model/types';

/** Which eraser peels: the water eraser turns water into a bank at its elevation, and in the planet
 *  session (`groundEditable`) layer 0 peels too. */
export interface PeelOptions {
  waterEraser?: boolean;
  groundEditable?: boolean;
}

/** Peel one structural layer or remove a cosmetic fillet. With `groundEditable` the terrain eraser
 *  turns bare ground, a shore rim cell read as the ground under it, into sea; the water eraser has
 *  nothing to take there. */
export function peelCommand(
  x: number, y: number, cell: MacroCell | null, { waterEraser = false, groundEditable = false }: PeelOptions = {},
): Command | null {
  if (groundEditable && cell && !cell.terrain) {
    return !waterEraser && isLandZone(groundZone(cell)) ? groundCommand([{ x, y }], OFF_MAP_ZONE) : null;
  }
  if (!cell?.terrain) return null;
  if (cell.terrain.type === TerrainType.Water) {
    if (waterEraser) {
      return paintTerrainCommand([{ x, y }], TerrainType.Mountain, cell.terrain.elevation);
    }
    return eraseTerrainCommand([{ x, y }]);
  }
  return paintTerrainCommand([{ x, y }], TerrainType.Mountain, cell.terrain.patchOnly ? structuralTop(cell.terrain) : cell.terrain.elevation - 1);
}
