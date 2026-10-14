/**
 * V-WTR-03: Waterfall Adjacent Row Uniformity (post-stroke)
 *
 * For each waterfall face, the row directly in front of (downstream from)
 * the waterfall must have uniform elevation across its full width n.
 * n = width of the waterfall structure including the capping mountains.
 *
 * The adjacent row cells can be mountain or water, but all n cells must be
 * at the exact same elevation. Any height difference is a violation.
 *
 * Example: waterfall `M W M` at layer 3, n=3.
 *   M W M
 *   3 3 3   <- waterfall (layer 3)
 *   2 2 2   <- front row: all same elevation -> Legal
 *
 * Illegal:
 *   M W M
 *   3 3 3   <- waterfall (layer 3)
 *   2 0 2   <- height difference -> Illegal
 */
import { TerrainType, type GridState, type MacroCoord, type ValidationError } from '../core/model/types';
import { getCell } from '../core/model/grid-model';
import { cellElevation, isWaterAtElev, traceToMountain } from '../core/domain/terrain/waterfall-geometry';
import { DIR_OFFSETS, PERP_DIRS, type Direction } from '../core/grid/directions';
import { TERRAIN_GRID } from '../core/game/profile';
import { evidenceOn } from '../core/grid/grids';
import { definePostRule, type Fail } from './define';

/** The waterfall strip through (x, y) along `perpDir`'s axis, in order: the capping mountain at one
 *  end, the water at `elev` between, and the capping mountain at the other end. */
function fullStrip(state: GridState, x: number, y: number, elev: number, perpDir: Direction): MacroCoord[] {
  const { dx, dy } = DIR_OFFSETS[perpDir];
  // Both ends are walked from (x, y) itself, which a patch-only water cell (its support a tier
  // lower) starts but would stop a walk from the other end, so the strip always contains it.
  let sx = x, sy = y;
  while (isWaterAtElev(state, sx + dx, sy + dy, elev)) { sx += dx; sy += dy; }
  let ex = x, ey = y;
  while (isWaterAtElev(state, ex - dx, ey - dy, elev)) { ex -= dx; ey -= dy; }
  const cells: MacroCoord[] = [{ x: sx + dx, y: sy + dy }];
  for (let cx = sx, cy = sy; ; cx -= dx, cy -= dy) {
    cells.push({ x: cx, y: cy });
    if (cx === ex && cy === ey) break;
  }
  cells.push({ x: ex - dx, y: ey - dy });
  return cells;
}

/**
 * Check that all n cells in the adjacent row (1 step in flowDir from each
 * strip cell) are at the same elevation. Report errors for non-uniform cells.
 */
function checkAdjacentRowUniformity(
  state: GridState,
  strip: readonly MacroCoord[],
  flowDir: Direction,
  map: { width: number; height: number },
  report: { errors: ValidationError[]; fail: Fail },
): void {
  const { width: mapWidth, height: mapHeight } = map;
  const { errors, fail } = report;
  const { dx, dy } = DIR_OFFSETS[flowDir];
  const n = strip.length;

  // Off the map reads as -1, so an edge-adjacent row can never pass as uniform with real terrain.
  const adjacentElevs: number[] = [];
  for (const cell of strip) {
    const ax = cell.x + dx, ay = cell.y + dy;
    if (ax < 0 || ax >= mapWidth || ay < 0 || ay >= mapHeight) {
      adjacentElevs.push(-1);
      continue;
    }
    adjacentElevs.push(cellElevation(state, ax, ay));
  }

  const firstElev = adjacentElevs[0]!;
  const isUniform = adjacentElevs.every(e => e === firstElev);

  if (!isUniform) {
    for (let i = 0; i < n; i++) {
      if (adjacentElevs[i] !== firstElev) {
        const cell = strip[i]!;
        errors.push(fail('error.waterfall_adjacent_not_uniform', evidenceOn(TERRAIN_GRID, [{ x: cell.x + dx, y: cell.y + dy }])));
      }
    }
  }
}

export const waterfallAdjacentUniformityRule = definePostRule({
  id: 'V-WTR-03',

  validate(state, opts, fail) {
    const { width, height } = state.template;
    const errors: ValidationError[] = [];
    const processedFaces = new Set<string>();

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const cell = getCell(state.cells, x, y);
        if (!cell?.terrain || cell.terrain.type !== TerrainType.Water) continue;

        const elev = cell.terrain.elevation;

        for (const flowDir of ['north', 'south', 'east', 'west'] as Direction[]) {
          const { dx, dy } = DIR_OFFSETS[flowDir];
          const neighborElev = cellElevation(state, x + dx, y + dy);
          if (neighborElev >= elev) continue; // needs height drop

          // Check perpendicular capping at exact elevation
          const [perpA, perpB] = PERP_DIRS[flowDir];
          const { dx: pdxA, dy: pdyA } = DIR_OFFSETS[perpA];
          const { dx: pdxB, dy: pdyB } = DIR_OFFSETS[perpB];
          const cappedA = traceToMountain(state, x, y, elev, { dx: pdxA, dy: pdyA });
          const cappedB = traceToMountain(state, x, y, elev, { dx: pdxB, dy: pdyB });
          if (!cappedA || !cappedB) continue;

          const strip = fullStrip(state, x, y, elev, perpA);
          const faceKey = `${strip[0]!.x},${strip[0]!.y},${flowDir}`;
          if (processedFaces.has(faceKey)) continue;
          processedFaces.add(faceKey);

          checkAdjacentRowUniformity(state, strip, flowDir, { width, height }, { errors, fail });
          if (opts?.firstOnly && errors.length > 0) return errors;
        }
      }
    }
    return errors;
  },
});
