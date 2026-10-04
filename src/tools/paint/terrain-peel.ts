import { CellZone, CommandType, TerrainType } from '../../core/model/types';
import { structuralTop } from '../../core/edge-cut/terrain-silhouette';
import { groundZone, isLandZone } from '../../core/model/grid-model';
import { groundCommand } from './ground-command';
import type { Command, MacroCell } from '../../core/model/types';

/** Peel one structural layer or remove a cosmetic fillet. Water erasure can retain its elevation as a bank.
 *  With `groundEditable` (the planet session) layer 0 peels too: the terrain eraser turns bare ground,
 *  a shore rim cell read as the ground under it, into sea. The water eraser has nothing to take there. */
export function peelCommand(
  x: number, y: number, cell: MacroCell | null, convertWater = false, groundEditable = false,
): Command | null {
  if (groundEditable && cell && !cell.terrain) {
    return !convertWater && isLandZone(groundZone(cell)) ? groundCommand([{ x, y }], CellZone.Void) : null;
  }
  if (!cell?.terrain) return null;
  if (cell.terrain.type === TerrainType.Water) {
    if (convertWater) {
      return {
        type: CommandType.PaintTerrain,
        timestamp: Date.now(),
        cells: [{ x, y }],
        terrainType: TerrainType.Mountain,
        elevation: cell.terrain.elevation,
      };
    }
    return {
      type: CommandType.EraseTerrain,
      timestamp: Date.now(),
      cells: [{ x, y }],
    };
  }
  return {
    type: CommandType.PaintTerrain,
    timestamp: Date.now(),
    cells: [{ x, y }],
    terrainType: TerrainType.Mountain,
    elevation: cell.terrain.patchOnly ? structuralTop(cell.terrain) : cell.terrain.elevation - 1,
  };
}
