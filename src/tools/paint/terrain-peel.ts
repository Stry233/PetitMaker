import { CommandType, TerrainType } from '../../core/model/types';
import { structuralTop } from '../../core/edge-cut/terrain-silhouette';
import type { Command, MacroCell } from '../../core/model/types';

/** Peel one structural layer or remove a cosmetic fillet. Water erasure can retain its elevation as a bank. */
export function peelCommand(x: number, y: number, cell: MacroCell | null, convertWater = false): Command | null {
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
