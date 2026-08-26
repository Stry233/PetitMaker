/**
 * V-WTR-03: Waterfall Adjacent Row Uniformity (post-stroke)
 *
 * For each waterfall face, the row directly in front of (downstream from)
 * the waterfall must have uniform elevation across its full width n.
 * n = width of the waterfall structure INCLUDING the capping mountains.
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
import {
  TerrainType,
  type GridState,
  type MacroCoord,
  type PostStrokeRule,
  type ValidationError,
} from '../core/model/types';
import { getCell } from '../core/model/grid-model';
import {
  cellElevation,
  DIR_OFFSETS,
  isWaterAtElev,
  PERP_DIRS,
  traceToMountain,
  type Direction,
} from '../core/model/waterfall-geometry';

/**
 * Find the full waterfall strip: capping mountains + water cells between them.
 * Returns an ordered list of MacroCoords along the perpendicular axis.
 */
function getFullStrip(
  state: GridState, x: number, y: number, elev: number, perpDir: Direction,
): { cells: MacroCoord[] } {
  const { dx, dy } = DIR_OFFSETS[perpDir];

  // Walk in the perpDir direction to find one end of the water strip
  let sx = x, sy = y;
  while (isWaterAtElev(state, sx + dx, sy + dy, elev)) {
    sx += dx;
    sy += dy;
  }
  // The cap mountain on this end (one step beyond the last water cell)
  const capA: MacroCoord = { x: sx + dx, y: sy + dy };

  // Walk in the opposite direction to find the other end
  const odx = -dx, ody = -dy;
  let ex = x, ey = y;
  while (isWaterAtElev(state, ex + odx, ey + ody, elev)) {
    ex += odx;
    ey += ody;
  }
  const capB: MacroCoord = { x: ex + odx, y: ey + ody };

  // Build the full strip: capA, then water cells from sx,sy to ex,ey, then capB
  const cells: MacroCoord[] = [capA];
  let cx = sx, cy = sy;
  while (true) {
    cells.push({ x: cx, y: cy });
    if (cx === ex && cy === ey) break;
    cx += odx;
    cy += ody;
  }
  cells.push(capB);

  return { cells };
}

/**
 * Check that all n cells in the adjacent row (1 step in flowDir from each
 * strip cell) are at the same elevation. Report errors for non-uniform cells.
 */
function checkAdjacentRowUniformity(
  state: GridState,
  strip: { cells: MacroCoord[] },
  flowDir: Direction,
  mapWidth: number,
  mapHeight: number,
  errors: ValidationError[],
): void {
  const { dx, dy } = DIR_OFFSETS[flowDir];
  const n = strip.cells.length;

  // Off the map reads as -1, so an edge-adjacent row can never pass as uniform with real terrain.
  const adjacentElevs: number[] = [];
  for (const cell of strip.cells) {
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
        const cell = strip.cells[i]!;
        errors.push({
          ruleId: 'V-WTR-03',
          message: 'error.waterfall_adjacent_not_uniform',
          cells: [{ x: cell.x + dx, y: cell.y + dy }],
          severity: 'error',
        });
      }
    }
  }
}

export const waterfallAdjacentUniformityRule: PostStrokeRule = {
  id: 'V-WTR-03',
  agentHint: 'POST-CHECK — the row directly BELOW the waterfall lip must all be ONE elevation across the full frame width. FIX: keep the falling water at the pool elevation (a high water cell), and build the cells directly below it as a single uniform lower shelf FIRST. Painting low (e.g. elev-0) water against a stepped hillside always fails here — do not repeat it.',
  phase: 'post-stroke',

  validate(state: GridState, opts?: { firstOnly?: boolean }): ValidationError[] {
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
          const cappedA = traceToMountain(state, x, y, elev, pdxA, pdyA);
          const cappedB = traceToMountain(state, x, y, elev, pdxB, pdyB);
          if (!cappedA || !cappedB) continue;

          const strip = getFullStrip(state, x, y, elev, perpA);
          const faceKey = `${strip.cells[0]!.x},${strip.cells[0]!.y},${flowDir}`;
          if (processedFaces.has(faceKey)) continue;
          processedFaces.add(faceKey);

          checkAdjacentRowUniformity(state, strip, flowDir, width, height, errors);
          if (opts?.firstOnly && errors.length > 0) return errors;
        }
      }
    }
    return errors;
  },
};
