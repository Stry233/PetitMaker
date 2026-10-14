/**
 * V-MTN-01: Elevation Range (pre-command)
 *
 * Mountain elevation must be in [0, ELEVATION_MAX]. Elevation 0 is valid — it clears terrain.
 * Only applies to PaintTerrain commands with terrainType === Mountain.
 * Water commands are not checked (water has no elevation ceiling in this rule).
 */
import { CommandType, TerrainType } from '../core/model/types';
import { ELEVATION_MAX, TERRAIN_GRID } from '../core/game/profile';
import { evidenceOn } from '../core/grid/grids';
import { definePreRule } from './define';

export const elevationRangeRule = definePreRule({
  id: 'V-MTN-01',
  appliesTo: [CommandType.PaintTerrain],
  validate(cmd, _state, fail) {
    if (cmd.terrainType !== TerrainType.Mountain) return [];
    if (cmd.elevation < 0 || cmd.elevation > ELEVATION_MAX) {
      return [fail('error.elevation_limit', evidenceOn(TERRAIN_GRID, cmd.cells), { messageParams: { max: ELEVATION_MAX } })];
    }
    return [];
  },
});
