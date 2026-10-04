/**
 * V-GROUND-LOCK: the ordinary editor never edits layer 0. A terrain command carrying `ground`
 * (turning ground into sea, sea into ground, or laying sand) belongs to the planet session only.
 */
import { CommandType, type Command, type GridState, type PreCommandRule, type ValidationError } from '../core/model/types';

export const groundLockRule: PreCommandRule = {
  id: 'V-GROUND-LOCK',
  agentHint: 'The ground shape (grass, sand, sea) is fixed by the planet and cannot be edited.',
  phase: 'pre-command',
  appliesTo: [CommandType.PaintTerrain, CommandType.EraseTerrain],
  validate(cmd: Command, _state: GridState): ValidationError[] {
    if ((cmd.type !== CommandType.PaintTerrain && cmd.type !== CommandType.EraseTerrain) || cmd.ground === undefined) return [];
    return [{ ruleId: 'V-GROUND-LOCK', message: 'error.zone_restricted', cells: cmd.cells, severity: 'error' }];
  },
};
