/**
 * V-MTN-01: Elevation Range (pre-command)
 *
 * Mountain elevation must be in [0, ELEVATION_MAX]. Elevation 0 is valid — it clears terrain.
 * Only applies to PaintTerrain commands with terrainType === Mountain.
 * Water commands are not checked (water has no elevation ceiling in this rule).
 */
import {
  CommandType,
  TerrainType,
  type Command,
  type GridState,
  type PreCommandRule,
  type ValidationError,
} from '../core/model/types';
import { ELEVATION_MAX } from '../core/model/constants';

export const elevationRangeRule: PreCommandRule = {
  id: 'V-MTN-01',
  agentHint: `Mountain elevation must be 0-${ELEVATION_MAX} (0 clears the cell).`,
  phase: 'pre-command',
  appliesTo: [CommandType.PaintTerrain],
  validate(cmd: Command, _state: GridState): ValidationError[] {
    if (cmd.type !== CommandType.PaintTerrain) return [];
    if (cmd.terrainType !== TerrainType.Mountain) return [];
    if (cmd.elevation < 0 || cmd.elevation > ELEVATION_MAX) {
      return [{ ruleId: 'V-MTN-01', message: 'error.elevation_limit', messageParams: { max: ELEVATION_MAX }, cells: cmd.cells, severity: 'error' }];
    }
    return [];
  },
};
