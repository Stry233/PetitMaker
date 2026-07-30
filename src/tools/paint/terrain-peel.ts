import { CommandType, TerrainType } from '../../core/model/types';
import type { Command, MacroCell } from '../../core/model/types';

/**
 * The command to peel one terrain layer at (x,y), or null if nothing to peel.
 * Mirrors eraser behavior: mountain N → N-1 (N=1 → elev 0 clears via the
 * PaintTerrain elev-0 special case), water → cleared to ground, ground → null.
 */
export function peelCommand(x: number, y: number, cell: MacroCell | null): Command | null {
  if (!cell?.terrain) return null;
  if (cell.terrain.type === TerrainType.Water) {
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
    elevation: cell.terrain.elevation - 1,
  };
}
