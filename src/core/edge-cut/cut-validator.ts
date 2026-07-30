import type { Corners, CornerTrim, GridState } from '../model/types';
import { TerrainType } from '../model/types';
import { getCell } from '../model/grid-model';
import { cornerWrappedAt } from './terrain-silhouette';
import { CORNER_INDEX, type CornerPos } from './corner-index';
import {
  detectRoadConn, findRoadAt, hasRoadAt, matchActualRoadState, matchCanonicalRoadState, roadSideKept,
} from './road-cut-states';

type Side = 'N' | 'E' | 'S' | 'W';
type EdgeInterval = [number, number];

const EPSILON = 1e-6;

// Which sides each corner position contributes to, and its range on that side
// N/S edges: left-to-right (TL=[0,0.5], TR=[0.5,1])
// W/E edges: top-to-bottom (TL=[0,0.5], BL=[0.5,1])
const SIDE_CONTRIBUTIONS: Record<Side, { pos: CornerPos; range: EdgeInterval }[]> = {
  N: [{ pos: 'TL', range: [0, 0.5] }, { pos: 'TR', range: [0.5, 1] }],
  S: [{ pos: 'BL', range: [0, 0.5] }, { pos: 'BR', range: [0.5, 1] }],
  W: [{ pos: 'TL', range: [0, 0.5] }, { pos: 'BL', range: [0.5, 1] }],
  E: [{ pos: 'TR', range: [0, 0.5] }, { pos: 'BR', range: [0.5, 1] }],
};

// Which sides of the micro-block each corner POSITION can provide coverage for
const CORNER_SIDES: Record<CornerPos, Side[]> = {
  TL: ['N', 'W'],
  TR: ['N', 'E'],
  BL: ['S', 'W'],
  BR: ['S', 'E'],
};

// Corner-index (0=TL,1=TR,2=BL,3=BR) → trimmed-corner shape. Shared by the manual
// edge-cut tool and the auto-trim pass so the bevel mapping has one source.
// Outer (convex) corner: cutting keeps the two inner edges (TL→keep SE→tri-SE).
export const OUTER_TRI: Record<number, CornerTrim> = { 0: 'tri-SE', 1: 'tri-SW', 2: 'tri-NE', 3: 'tri-NW' };
// Inner (concave) corner / Γ-patch: the patch fills toward the corner (TL→tri-NW).
export const INNER_TRI: Record<number, CornerTrim> = { 0: 'tri-NW', 1: 'tri-NE', 2: 'tri-SW', 3: 'tri-SE' };

// Which sides each directed triangle preserves
const TRI_SIDES: Record<string, Side[]> = {
  'tri-NW': ['N', 'W'],
  'tri-NE': ['N', 'E'],
  'tri-SW': ['S', 'W'],
  'tri-SE': ['S', 'E'],
};

function shapeProvidesCoverage(shape: CornerTrim, cornerPos: CornerPos, side: Side): boolean {
  if (shape === 'empty') return false;
  if (!CORNER_SIDES[cornerPos].includes(side)) return false;
  if (shape === 'square' || shape === 'fan') return true;
  return (TRI_SIDES[shape] ?? []).includes(side);
}

export function computeCellEdgeCoverage(
  corners: Corners | undefined,
  side: Side,
): EdgeInterval[] {
  if (!corners) return [[0, 1]];
  const raw: EdgeInterval[] = [];
  for (const { pos, range } of SIDE_CONTRIBUTIONS[side]) {
    const shape = corners[CORNER_INDEX[pos]]!;
    if (shapeProvidesCoverage(shape, pos, side)) {
      raw.push(range);
    }
  }
  // Merge adjacent/overlapping intervals (clone to avoid mutating SIDE_CONTRIBUTIONS)
  if (raw.length <= 1) return raw.map(([a, b]) => [a, b] as EdgeInterval);
  raw.sort((a, b) => a[0] - b[0]);
  const merged: EdgeInterval[] = [[raw[0]![0], raw[0]![1]]];
  for (let i = 1; i < raw.length; i++) {
    const prev = merged[merged.length - 1]!;
    const cur = raw[i]!;
    if (cur[0] <= prev[1] + EPSILON) {
      prev[1] = Math.max(prev[1], cur[1]);
    } else {
      merged.push([cur[0], cur[1]]);
    }
  }
  return merged;
}

function intervalsOverlap(a: EdgeInterval[], b: EdgeInterval[]): boolean {
  for (const [a0, a1] of a) {
    for (const [b0, b1] of b) {
      const lo = Math.max(a0, b0);
      const hi = Math.min(a1, b1);
      if (hi - lo > EPSILON) return true;
    }
  }
  return false;
}

/**
 * Mirror intervals so that position 0 maps to 1 and vice versa.
 * When two cells share an edge, the corner at the "top" of one cell's side
 * corresponds to the "bottom" of the neighbor's opposite side, so we flip
 * the neighbor's intervals before comparing.
 */
function flipIntervals(intervals: EdgeInterval[]): EdgeInterval[] {
  return intervals.map(([a, b]) => [1 - b, 1 - a] as EdgeInterval);
}

const OPPOSITE: Record<Side, Side> = { N: 'S', S: 'N', E: 'W', W: 'E' };

export function hasPositiveEdgeContact(
  candidateCorners: Corners | undefined,
  candidateSide: Side,
  neighborCorners: Corners | undefined,
  neighborSide: Side,
): boolean {
  const a = computeCellEdgeCoverage(candidateCorners, candidateSide);
  const bRaw = computeCellEdgeCoverage(neighborCorners, neighborSide);
  const b = flipIntervals(bRaw);
  return intervalsOverlap(a, b);
}

function getNeighborCorners(state: GridState, x: number, y: number, layer: 'terrain' | 'road'): Corners | undefined {
  if (layer === 'terrain') {
    const cell = getCell(state.cells, x, y);
    return cell?.terrain?.corners;
  }
  // ONE road predicate: findRoadAt is the canonical "coating at (x,y)" lookup
  // (non-patch, catalog-coated, O(1) via the object index).
  return findRoadAt(state, x, y)?.corners;
}

export function validateCut(
  state: GridState,
  x: number, y: number,
  layer: 'terrain' | 'road',
  candidateCorners: Corners,
): boolean {
  const offsets: [Side, number, number][] = [['N', 0, -1], ['S', 0, 1], ['W', -1, 0], ['E', 1, 0]];
  const connectedSides: Side[] = [];

  for (const [side, dx, dy] of offsets) {
    const nx = x + dx, ny = y + dy;
    let hasNeighbor = false;
    if (layer === 'terrain') {
      const nc = getCell(state.cells, nx, ny);
      const cell = getCell(state.cells, x, y);
      if (nc?.terrain && cell?.terrain &&
          nc.terrain.type === cell.terrain.type &&
          nc.terrain.elevation === cell.terrain.elevation &&
          !nc.terrain.patchOnly) {
        hasNeighbor = true;
      }
    } else {
      hasNeighbor = hasRoadAt(state, nx, ny);
    }

    if (hasNeighbor) {
      connectedSides.push(side);
      if (layer === 'road') {
        // GEOMETRY-FAITHFUL road contact. Road corner arrays are SYMBOLIC canonical-state tokens (stored
        // canonical; validated in the actual frame via canonicalToActual), NOT quadrant-faithful geometry —
        // drawRoadShape pattern-matches them. Judging the seam by token coverage both misread the frame
        // (a neighbour's stored canonical tokens were compared as actual-frame quadrants) and misread the
        // shape (triangle tokens under-claim the connected edge that the drawn diagonal fully keeps, while
        // fan tokens over-claim their cut edges) — so a fan could validate where its same-direction
        // triangle twin was refused, and some trimmed neighbours dead-locked a cell entirely. Judge both
        // sides of the seam from the drawn geometry's kept-edge table instead; corner arrays that match no
        // canonical state fall back to the token-coverage check.
        const cand = findRoadAt(state, x, y);
        const nbr = findRoadAt(state, nx, ny);
        const cConn = cand ? detectRoadConn(state, cand) : 'left';
        const nConn = nbr ? detectRoadConn(state, nbr) : 'left';
        const cState = matchActualRoadState(candidateCorners, cConn);
        const nState = matchCanonicalRoadState(nbr?.corners);
        if (cState !== null && nState !== null) {
          if (!roadSideKept(cState, cConn, side) || !roadSideKept(nState, nConn, OPPOSITE[side])) {
            return false;
          }
          continue;
        }
      }
      const neighborCorners = getNeighborCorners(state, nx, ny, layer);
      if (!hasPositiveEdgeContact(candidateCorners, side, neighborCorners, OPPOSITE[side])) {
        return false;
      }
    }
  }

  if (layer === 'road' && connectedSides.length >= 2) {
    const hasOpposite = (connectedSides.includes('N') && connectedSides.includes('S'))
      || (connectedSides.includes('W') && connectedSides.includes('E'));
    if (hasOpposite || connectedSides.length >= 3) {
      if (!candidateCorners.every(c => c === 'square')) return false;
    } else {
      // L-shape (2 adjacent): non-square corners adjacent to a connected side
      // must be triangles (straight edge), not fans (curved notch).
      const connSet = new Set(connectedSides);
      const cornerAdj: Side[][] = [['N', 'W'], ['N', 'E'], ['S', 'W'], ['S', 'E']];
      for (let i = 0; i < 4; i++) {
        const shape = candidateCorners[i];
        if (shape === 'square') continue;
        const adjToConn = cornerAdj[i]!.some(s => connSet.has(s));
        if (adjToConn && shape === 'fan') return false;
      }
    }
  }

  return true;
}

/** Is corner `cornerIdx` of (cellX,cellY) a Γ notch of the `terrainType`@`elevation` silhouette this cell
 *  may be FILLED into? True when the silhouette wraps the corner AND the cell itself sits strictly below
 *  the reference tier (empty, a patch, or a hidden lower block) — a cell at/above the tier is part of the
 *  structure, not a notch. */
export function isInnerCorner(
  state: GridState,
  cellX: number, cellY: number,
  cornerIdx: number,
  terrainType: TerrainType,
  elevation: number,
): boolean {
  const t = getCell(state.cells, cellX, cellY)?.terrain;
  if (t && t.type !== TerrainType.None && !t.patchOnly && t.elevation >= elevation) return false;
  return cornerWrappedAt(state, cellX, cellY, cornerIdx, terrainType, elevation);
}
