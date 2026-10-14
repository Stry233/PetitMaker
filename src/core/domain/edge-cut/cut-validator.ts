import type { Corners, CornerTrim, GridState, MacroCoord } from '../../model/types';
import { TerrainType } from '../../model/types';
import { getCell } from '../../model/grid-model';
import { type Side, OPPOSITE_SIDE, SIDES, SIDE_DELTA } from '../../grid/directions';
import { cornerWrappedAt, enclosedGap } from './silhouette';
import { surfaceElevation } from '../terrain/terrain-surface';
import { CORNERS, cornerTri, cornersOnSide, isSquareCorners } from '../../model/corners';
import type { RoadLookup } from '../../model/road-lookup';
import {
  detectRoadConn, isRoadNeighbor, matchActualRoadState, matchCanonicalRoadState, roadSideKept,
} from './road-cut-states';

type EdgeInterval = [number, number];

const EPSILON = 1e-6;

// Along N and S an edge runs left to right, along W and E top to bottom; the first of a side's two
// corners covers [0, 0.5] of it and the second [0.5, 1].
const SIDE_HALVES: readonly EdgeInterval[] = [[0, 0.5], [0.5, 1]];

// Corner index → trimmed-corner shape, shared by the manual edge-cut tool and the auto-trim pass.
// Outer (convex) corner: cutting keeps the two inner edges (TL keeps SE, so tri-SE).
export const OUTER_TRI: Record<number, CornerTrim> = Object.fromEntries(CORNERS.map((_, i) => [i, cornerTri(3 - i)]));
// Inner (concave) corner or Γ patch: the patch fills toward the corner (TL, so tri-NW).
export const INNER_TRI: Record<number, CornerTrim> = Object.fromEntries(CORNERS.map((_, i) => [i, cornerTri(i)]));

/** Whether corner `i`, trimmed to `shape`, covers its half of `side`. A triangle keeps the two sides
 *  of the corner it is named for. */
function shapeProvidesCoverage(shape: CornerTrim, i: number, side: Side): boolean {
  if (shape === 'empty') return false;
  if (!CORNERS[i]!.sides.includes(side)) return false;
  if (shape === 'square' || shape === 'fan') return true;
  const kept = CORNERS.find((c) => shape === `tri-${c.compass}`);
  return !!kept && kept.sides.includes(side);
}

function computeCellEdgeCoverage(
  corners: Corners | undefined,
  side: Side,
): EdgeInterval[] {
  if (!corners) return [[0, 1]];
  const raw: EdgeInterval[] = [];
  cornersOnSide(side).forEach((i, half) => {
    if (shapeProvidesCoverage(corners[i]!, i, side)) raw.push(SIDE_HALVES[half]!);
  });
  // Merge adjacent or overlapping intervals (cloned so SIDE_HALVES is never written)
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

function hasPositiveEdgeContact(
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

/**
 * Whether the cell at `cell` may take `candidateCorners` on `layer`: every side it shares with a
 * connected neighbour keeps positive contact across the seam, and a road's connections leave room
 * for its cut.
 */
export function validateCut(
  state: GridState,
  roads: RoadLookup,
  cell: MacroCoord,
  layer: 'terrain' | 'road',
  candidateCorners: Corners,
): boolean {
  return layer === 'terrain' ? validateTerrainCut(state, cell, candidateCorners) : validateRoadCut(roads, cell, candidateCorners);
}

/** A terrain cut: a neighbour of the same type and elevation, and no patch, is connected. */
function validateTerrainCut(state: GridState, { x, y }: MacroCoord, candidateCorners: Corners): boolean {
  const own = getCell(state.cells, x, y)?.terrain;
  if (!own) return true;
  for (const side of SIDES) {
    const [dx, dy] = SIDE_DELTA[side];
    const n = getCell(state.cells, x + dx, y + dy)?.terrain;
    if (!n || n.type !== own.type || n.elevation !== own.elevation || n.patchOnly) continue;
    if (!hasPositiveEdgeContact(candidateCorners, side, n.corners, OPPOSITE_SIDE[side])) return false;
  }
  return true;
}

/** A road cut: a neighbour of the same material is connected, and the seam is judged from the
 *  drawn geometry. Road corner arrays are canonical-state tokens validated in the actual frame
 *  (`canonicalToActual`), not quadrant geometry, so token coverage would misread both sides of the
 *  seam; corner arrays that match no canonical state fall back to it. A road joined on opposite
 *  sides or on three stays square, and one joined on two adjacent sides cuts only triangles next to
 *  them, never fans. */
function validateRoadCut(roads: RoadLookup, { x, y }: MacroCoord, candidateCorners: Corners): boolean {
  const cand = roads(x, y);
  if (!cand) return true;
  const connected = new Set<Side>();
  for (const side of SIDES) {
    const [dx, dy] = SIDE_DELTA[side];
    const nx = x + dx, ny = y + dy;
    if (!isRoadNeighbor(roads, cand, nx, ny)) continue;
    connected.add(side);
    const nbr = roads(nx, ny);
    const cConn = detectRoadConn(roads, cand);
    const nConn = nbr ? detectRoadConn(roads, nbr) : 'W';
    const cState = matchActualRoadState(candidateCorners, cConn);
    const nState = matchCanonicalRoadState(nbr?.corners);
    if (cState !== null && nState !== null) {
      if (!roadSideKept(cState, cConn, side) || !roadSideKept(nState, nConn, OPPOSITE_SIDE[side])) return false;
    } else if (!hasPositiveEdgeContact(candidateCorners, side, nbr?.corners, OPPOSITE_SIDE[side])) {
      return false;
    }
  }
  if (connected.size < 2) return true;
  const opposite = (connected.has('N') && connected.has('S')) || (connected.has('W') && connected.has('E'));
  if (opposite || connected.size >= 3) return isSquareCorners(candidateCorners);
  return candidateCorners.every((shape, i) => shape !== 'fan' || !CORNERS[i]!.sides.some((side) => connected.has(side)));
}

/**
 * Is corner `cornerIdx` of (cellX,cellY) a Γ notch of the `terrainType`@`elevation` silhouette this
 * cell may be filled into? True when the silhouette wraps the corner and the cell sits strictly
 * below the reference tier. A fillet is a grounded column walled down to the cell's support, so one
 * fillet rounds a notch several tiers high. It never sits at or below the surface it decorates, nor
 * fills a pit the surface closes all round (`enclosedGap`), where it would hold no support.
 */
export function isInnerCorner(
  state: GridState,
  cellX: number, cellY: number,
  cornerIdx: number,
  fill: { type: TerrainType; elevation: number },
): boolean {
  const { elevation } = fill;
  const t = getCell(state.cells, cellX, cellY)?.terrain;
  if (t && t.type !== TerrainType.None && !t.patchOnly && t.elevation >= elevation) return false;
  if (elevation <= surfaceElevation(t)) return false;
  if (enclosedGap(state, cellX, cellY)) return false;
  return cornerWrappedAt(state, cellX, cellY, cornerIdx, fill);
}
