import { CommandType, TerrainType } from '../../core/model/types';
import type { Command, MacroCell } from '../../core/model/types';

/**
 * The command to peel one terrain layer at (x,y), or null if nothing to peel.
 * Mirrors eraser behavior: mountain N → N-1 (N=1 → elev 0 clears via the
 * PaintTerrain elev-0 special case), water → cleared to ground, ground → null.
 *
 * `convertWater` is the WATER eraser's variant: erased water becomes this layer's MOUNTAIN
 * instead of a hole. Excavating it (EraseTerrain) unbanks whatever water stands beside it, so
 * erasing the edge of a waterfall is refused whole by the containment rule; a
 * mountain at the water's own elevation is the bank that keeps the neighbours legal. Water@0
 * converts to Mountain@0, which the layer system already defines as bare grass.
 */
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
    elevation: cell.terrain.elevation - 1,
  };
}
