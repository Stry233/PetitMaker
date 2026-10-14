/**
 * V-WTR-02: Water Containment (post-stroke)
 *
 * Every water cell must be contained: for each cardinal direction where the
 * neighbor has lower elevation (a "face"), the perpendicular axis must have
 * mountain caps on both ends. Trace through same-elevation water cells until
 * hitting a non-water cell; that cell must be mountain at exactly the water elevation.
 *
 * Out-of-bounds neighbors count as lower elevation (water at map edge is uncapped).
 * Rivers (elevation 0) and waterfalls (elevation > 0) follow the same rule.
 *
 * Reports one error per violating water cell, not per face.
 */
import { TerrainType, type ValidationError } from '../core/model/types';
import { getCell } from '../core/model/grid-model';
import { surfaceElevation } from '../core/domain/terrain/terrain-surface';
import { traceToMountain } from '../core/domain/terrain/waterfall-geometry';
import { DIR_OFFSETS, PERP_DIRS, type Direction } from '../core/grid/directions';
import { TERRAIN_GRID } from '../core/game/profile';
import { evidenceOn } from '../core/grid/grids';
import { definePostRule } from './define';

const ALL_DIRS: Direction[] = ['north', 'south', 'east', 'west'];

export const waterContainmentRule = definePostRule({
  id: 'V-WTR-02',

  validate(state, opts, fail) {
    const { width, height } = state.template;
    const errors: ValidationError[] = [];

    for (let y = 0; y < height; y++) {
      const row = state.cells[y];
      for (let x = 0; x < width; x++) {
        const terrain = row?.[x]?.terrain;
        if (!terrain || terrain.type !== TerrainType.Water) continue;

        const elev = terrain.elevation;

        for (const dir of ALL_DIRS) {
          const { dx, dy } = DIR_OFFSETS[dir];
          const nx = x + dx, ny = y + dy;
          const neighborCell = getCell(state.cells, nx, ny);
          // Off the map reads as −1, the same "lower than any water" `cellElevation` returns for it,
          // so the out-of-bounds face below is reached without asking the grid a second time.
          const neighborElev = neighborCell ? surfaceElevation(neighborCell.terrain) : -1;
          if (neighborElev >= elev) continue;

          // Out-of-bounds neighbor means water flows off the map edge — always uncapped
          if (!neighborCell) {
            errors.push(fail('error.water_uncapped', evidenceOn(TERRAIN_GRID, [{ x, y }])));
            if (opts?.firstOnly) return errors;
            break;
          }

          const [perpA, perpB] = PERP_DIRS[dir];
          const { dx: pdxA, dy: pdyA } = DIR_OFFSETS[perpA];
          const { dx: pdxB, dy: pdyB } = DIR_OFFSETS[perpB];

          const hasLeft = traceToMountain(state, x, y, elev, { dx: pdxA, dy: pdyA });
          const hasRight = traceToMountain(state, x, y, elev, { dx: pdxB, dy: pdyB });

          if (!hasLeft || !hasRight) {
            errors.push(fail('error.water_uncapped', evidenceOn(TERRAIN_GRID, [{ x, y }])));
            if (opts?.firstOnly) return errors;
            break;
          }
        }
      }
    }
    return errors;
  },
});
