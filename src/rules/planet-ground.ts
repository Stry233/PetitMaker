/**
 * V-PLANET-01: in the planet session, the ground under a placed object keeps its zone, so no
 * object, the landmark included, ends up over sea or sand.
 */
import { CommandType, type Command, type GridState, type PreCommandRule, type ValidationError } from '../core/model/types';
import { entriesCovering, getObjectIndex } from '../state/object-index';

export const planetGroundRule: PreCommandRule = {
  id: 'V-PLANET-01',
  agentHint: 'The ground under a placed object keeps its zone.',
  phase: 'pre-command',
  appliesTo: [CommandType.PaintTerrain, CommandType.EraseTerrain],
  validate(cmd: Command, state: GridState): ValidationError[] {
    if ((cmd.type !== CommandType.PaintTerrain && cmd.type !== CommandType.EraseTerrain) || cmd.ground === undefined) return [];
    const index = getObjectIndex(state);
    const cells = cmd.cells.filter((c) => entriesCovering(index, { x: c.x, y: c.y, w: 1, h: 1 }).length > 0);
    return cells.length ? [{ ruleId: 'V-PLANET-01', message: 'error.ground_under_object', cells, severity: 'error' }] : [];
  },
};
