import { CellZone, CommandType, TerrainType } from '../../core/model/types';
import type { EraseTerrainCommand, GroundZone, MacroCoord, PaintTerrainCommand } from '../../core/model/types';

/** The planet-session layer-0 edit that turns bare `cells` into `zone`: sea erases, land lays a
 *  mountain at elevation 0, which holds no terrain. */
export function groundCommand(cells: MacroCoord[], zone: GroundZone): PaintTerrainCommand | EraseTerrainCommand {
  return zone === CellZone.Void
    ? { type: CommandType.EraseTerrain, timestamp: Date.now(), cells, ground: zone }
    : { type: CommandType.PaintTerrain, timestamp: Date.now(), cells, terrainType: TerrainType.Mountain, elevation: 0, ground: zone };
}
