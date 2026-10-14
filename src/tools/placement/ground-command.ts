import { eraseTerrainCommand, paintTerrainCommand } from '../../core/model/command-build';
import { TerrainType } from '../../core/model/types';
import { isOpenSeaZone } from '../../core/game/zones';
import type { EraseTerrainCommand, MacroCoord, PaintTerrainCommand } from '../../core/model/types';
import type { GroundZone } from '../../core/game/zones';

/** The planet-session layer-0 edit that turns bare `cells` into `zone`: sea erases, land lays a
 *  mountain at elevation 0, which holds no terrain. */
export function groundCommand(cells: MacroCoord[], zone: GroundZone): PaintTerrainCommand | EraseTerrainCommand {
  return isOpenSeaZone(zone)
    ? eraseTerrainCommand(cells, zone)
    : paintTerrainCommand(cells, TerrainType.Mountain, 0, zone);
}
