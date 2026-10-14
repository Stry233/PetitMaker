/**
 * V-PLANET-01: in the planet session, the ground under a placed object keeps its zone, so no
 * object, the landmark included, ends up over sea or sand.
 */
import { CommandType } from '../core/model/types';
import { entriesCovering, getObjectIndex } from '../state/object-index';
import { TERRAIN_GRID } from '../core/game/profile';
import { evidenceOn } from '../core/grid/grids';
import { definePreRule } from './define';

export const planetGroundRule = definePreRule({
  id: 'V-PLANET-01',
  appliesTo: [CommandType.PaintTerrain, CommandType.EraseTerrain],
  validate(cmd, state, fail) {
    if (cmd.ground === undefined) return [];
    const index = getObjectIndex(state);
    const cells = cmd.cells.filter((c) => entriesCovering(index, { x: c.x, y: c.y, w: 1, h: 1 }).length > 0);
    return cells.length ? [fail('error.ground_under_object', evidenceOn(TERRAIN_GRID, cells))] : [];
  },
});
