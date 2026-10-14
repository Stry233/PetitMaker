import type { Corners, CornerTrim, PlacedObject, Rotation } from '../../model/types';
import type { RoadLookup } from '../../model/road-lookup';
import { isSquareCorners, sameCorners } from '../../model/corners';
import type { Side } from '../../grid/directions';

// Canonical road states (left-connected form): TL+BL always square, TR+BR get cuts.
// drawRoadShape + connSide handles rotation for other directions.
export const CANONICAL_ROAD_STATES: (Corners | undefined)[] = [
  undefined,
  ['square', 'square', 'square', 'fan'],            // 1: BR fan (round)
  ['square', 'fan', 'square', 'square'],             // 2: TR fan (round)
  ['tri-SE', 'tri-SE', 'square', 'square'],          // 3: diagonal \ (direct)
  ['square', 'square', 'tri-NE', 'tri-NE'],          // 4: diagonal / (direct)
  ['square', 'fan', 'square', 'fan'],                // 5: wedge (round)
];

/** The side of a road cell its connection runs out of; the canonical road frame is left-connected. */
export type RoadConnSide = Side;
export const CONN_SIDES: readonly RoadConnSide[] = ['W', 'E', 'N', 'S'];
export const ROTATION_TO_CONN: Record<Rotation, RoadConnSide> = {
  0: 'W', 90: 'N', 180: 'E', 270: 'S',
};

const TRI_ROTATE: Record<RoadConnSide, Record<string, CornerTrim>> = {
  W: { 'tri-NW': 'tri-NW', 'tri-NE': 'tri-NE', 'tri-SW': 'tri-SW', 'tri-SE': 'tri-SE' },
  E: { 'tri-NW': 'tri-NE', 'tri-NE': 'tri-NW', 'tri-SW': 'tri-SE', 'tri-SE': 'tri-SW' },
  N: { 'tri-NW': 'tri-SW', 'tri-NE': 'tri-NW', 'tri-SW': 'tri-SE', 'tri-SE': 'tri-NE' },
  S: { 'tri-NW': 'tri-NE', 'tri-NE': 'tri-SE', 'tri-SW': 'tri-NW', 'tri-SE': 'tri-SW' },
};

function rotateCornerTrim(trim: CornerTrim, conn: RoadConnSide): CornerTrim {
  return TRI_ROTATE[conn][trim] ?? trim;
}

// Convert canonical (left-connected) corners to actual positions for validation.
export function canonicalToActual(canonical: Corners, conn: RoadConnSide): Corners {
  const r = (t: CornerTrim) => rotateCornerTrim(t, conn);
  switch (conn) {
    case 'W':
      // Canonical form is already left-connected; return a fresh array (no rotation needed).
      return [...canonical];
    case 'E':  return [r(canonical[1]), r(canonical[0]), r(canonical[3]), r(canonical[2])];
    case 'N':    return [r(canonical[2]), r(canonical[0]), r(canonical[3]), r(canonical[1])];
    case 'S': return [r(canonical[1]), r(canonical[3]), r(canonical[0]), r(canonical[2])];
  }
}

export function cornersMatch(a: Corners | undefined, b: Corners | undefined): boolean {
  if (!a && !b) return true;
  if (!a || !b) {
    const c = a ?? b;
    return !!c && isSquareCorners(c);
  }
  return sameCorners(a, b);
}

/** Is there a (non-patch) road of `road`'s own material at (nx,ny), other than `road` itself?
 *  Shared by connection detection + neighbour count — and by the cut validator, so every
 *  connectivity question gives one answer. Different materials never connect: in the game two
 *  surfaces meet with a hairline of ground between them, so a foreign road is no neighbour for
 *  orientation, endpoint or cut-legality purposes (a trimmed endpoint keeps its cut when another
 *  surface is laid beside it). */
export function isRoadNeighbor(roads: RoadLookup, road: PlacedObject, nx: number, ny: number): boolean {
  const o = roads(nx, ny);
  return !!o && o.id !== road.id && o.catalogId === road.catalogId;
}

export function detectRoadConn(roads: RoadLookup, road: PlacedObject): RoadConnSide {
  const { x, y } = road.position;
  if (isRoadNeighbor(roads, road, x - 1, y)) return 'W';
  if (isRoadNeighbor(roads, road, x + 1, y)) return 'E';
  if (isRoadNeighbor(roads, road, x, y - 1)) return 'N';
  if (isRoadNeighbor(roads, road, x, y + 1)) return 'S';
  return ROTATION_TO_CONN[road.rotation] ?? 'W';
}

export function countRoadNeighbors(roads: RoadLookup, road: PlacedObject): number {
  const { x, y } = road.position;
  return ([[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]] as const)
    .filter(([nx, ny]) => isRoadNeighbor(roads, road, nx, ny)).length;
}

/**
 * The kept-edge table of each canonical road state in the canonical (left-connected) frame, derived
 * from drawRoadShape's drawn geometry: every cut state keeps its full connected edge, the fans and
 * diagonals keep exactly one full lateral edge, the wedge keeps only the connected edge. The pairs
 * {1,4} and {2,3} keep identical edges, differing only in the cut's curve.
 *
 * The per-quadrant corner tokens are symbolic markers drawRoadShape pattern-matches (state 3 stores
 * tri-SE at TL but keeps that quadrant's SW half), so coverage derived from them is wrong for roads.
 */
const STATE_KEPT_EDGES: readonly (readonly Side[])[] = [
  ['N', 'E', 'S', 'W'], // 0: raw square
  ['W', 'N'],           // 1: BR fan    — cut toward the far bottom
  ['W', 'S'],           // 2: TR fan    — cut toward the far top
  ['W', 'S'],           // 3: diagonal \ — state 2's straight twin
  ['W', 'N'],           // 4: diagonal / — state 1's straight twin
  ['W'],                // 5: wedge
];

/** actual grid side → canonical-frame side, inverting drawRoadShape's txPt per connection side. */
const TO_CANONICAL_SIDE: Record<RoadConnSide, Record<Side, Side>> = {
  W: { N: 'N', E: 'E', S: 'S', W: 'W' },
  E: { N: 'N', E: 'W', S: 'S', W: 'E' },
  N: { N: 'W', E: 'S', S: 'E', W: 'N' },
  S: { N: 'E', E: 'N', S: 'W', W: 'S' },
};

/** Which canonical state a road's stored corners are (roads store canonical tokens), or null if foreign. */
export function matchCanonicalRoadState(corners: Corners | undefined): number | null {
  for (let i = 0; i < CANONICAL_ROAD_STATES.length; i++) {
    if (cornersMatch(corners, CANONICAL_ROAD_STATES[i])) return i;
  }
  return null;
}

/** Which canonical state an ACTUAL-frame corner array is, given the road's connection side (the frame the
 *  validators receive candidates in, via canonicalToActual), or null if it matches no canonical state. */
export function matchActualRoadState(corners: Corners | undefined, conn: RoadConnSide): number | null {
  if (isSquareCorners(corners)) return 0;
  for (let i = 1; i < CANONICAL_ROAD_STATES.length; i++) {
    if (cornersMatch(corners, canonicalToActual([...CANONICAL_ROAD_STATES[i]!], conn))) return i;
  }
  return null;
}

/** Does canonical road state `stateIdx`, drawn with connection `conn`, keep its full edge on grid side
 *  `actualSide`? The geometry-faithful contact question for road seams. */
export function roadSideKept(stateIdx: number, conn: RoadConnSide, actualSide: Side): boolean {
  return STATE_KEPT_EDGES[stateIdx]?.includes(TO_CANONICAL_SIDE[conn][actualSide]) ?? false;
}

/** A canonical-frame side placed on the grid for connection `conn` — the inverse of the mapping
 *  `roadSideKept` reads, for callers that start from a canonical fact (which sides a state's
 *  vacated area touches) and need the grid cells behind them. */
export function fromCanonicalSide(conn: RoadConnSide, canonicalSide: Side): Side {
  const row = TO_CANONICAL_SIDE[conn];
  return (Object.keys(row) as Side[]).find((s) => row[s] === canonicalSide)!;
}

/** Round = fan-based states (BR/TR fan, wedge); direct = triangle-based (\, /). */
export function classifyRoadKind(corners: Corners | undefined): 'round' | 'direct' | null {
  if (!corners) return null;
  if (corners.some(c => c === 'fan')) return 'round';
  if (corners.some(c => c === 'tri-NW' || c === 'tri-NE' || c === 'tri-SW' || c === 'tri-SE')) return 'direct';
  return null;
}
