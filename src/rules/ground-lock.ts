/**
 * V-GROUND-LOCK: the ordinary editor never edits layer 0. A terrain command carrying `ground`
 * (turning ground into sea, sea into ground, or laying sand) belongs to the planet session only.
 */
import { CommandType } from '../core/model/types';
import { TERRAIN_GRID } from '../core/game/profile';
import { evidenceOn } from '../core/grid/grids';
import { definePreRule } from './define';

export const groundLockRule = definePreRule({
  id: 'V-GROUND-LOCK',
  appliesTo: [CommandType.PaintTerrain, CommandType.EraseTerrain],
  validate(cmd, _state, fail) {
    if (cmd.ground === undefined) return [];
    return [fail('error.zone_restricted', evidenceOn(TERRAIN_GRID, cmd.cells))];
  },
});
