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
import {
  TerrainType,
  type GridState,
  type PostStrokeRule,
  type ValidationError,
} from '../core/model/types';
import { getCell } from '../core/model/grid-model';
import { surfaceElevation } from '../core/edge-cut/terrain-silhouette';
import { DIR_OFFSETS, PERP_DIRS, traceToMountain, type Direction } from '../core/model/waterfall-geometry';

const ALL_DIRS: Direction[] = ['north', 'south', 'east', 'west'];

export const waterContainmentRule: PostStrokeRule = {
  id: 'V-WTR-02',
  agentHint: 'POST-CHECK, WHOLE-MAP — every water cell with a lower neighbor (an exposed face) must be capped by mountains at EXACTLY the water elevation on both perpendicular ends. Because it re-checks the ENTIRE map, a pre-existing illegal water cell reverts ANY edit, even one far away. If the cited cell is NOT one you just touched, that water was already broken: you canNOT fix it by editing elsewhere — clear_area that water (or cap its faces with mountains at its elevation) FIRST, then RE-APPLY the edit that just reverted — it did NOT land — and continue. Otherwise enclose new water in the SAME call or keep it surrounded by same-level ground.',
  phase: 'post-stroke',

  validate(state: GridState, opts?: { firstOnly?: boolean }): ValidationError[] {
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
            errors.push({
              ruleId: 'V-WTR-02',
              message: 'error.water_uncapped',
              cells: [{ x, y }],
              severity: 'error',
            });
            if (opts?.firstOnly) return errors;
            break;
          }

          const [perpA, perpB] = PERP_DIRS[dir];
          const { dx: pdxA, dy: pdyA } = DIR_OFFSETS[perpA];
          const { dx: pdxB, dy: pdyB } = DIR_OFFSETS[perpB];

          const hasLeft = traceToMountain(state, x, y, elev, pdxA, pdyA);
          const hasRight = traceToMountain(state, x, y, elev, pdxB, pdyB);

          if (!hasLeft || !hasRight) {
            errors.push({
              ruleId: 'V-WTR-02',
              message: 'error.water_uncapped',
              cells: [{ x, y }],
              severity: 'error',
            });
            if (opts?.firstOnly) return errors;
            break;
          }
        }
      }
    }
    return errors;
  },
};
