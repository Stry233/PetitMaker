import type { Corners, CornerTrim, PlacedObject } from '../model/types';
import type { RoadLookup } from '../model/road-lookup';

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

export const CONN_SIDES: ('left' | 'right' | 'top' | 'bottom')[] = ['left', 'right', 'top', 'bottom'];
export const ROTATION_TO_CONN: Record<number, 'left' | 'right' | 'top' | 'bottom'> = {
  0: 'left', 90: 'top', 180: 'right', 270: 'bottom',
};

const TRI_ROTATE: Record<string, Record<string, CornerTrim>> = {
  left:   { 'tri-NW': 'tri-NW', 'tri-NE': 'tri-NE', 'tri-SW': 'tri-SW', 'tri-SE': 'tri-SE' },
  right:  { 'tri-NW': 'tri-NE', 'tri-NE': 'tri-NW', 'tri-SW': 'tri-SE', 'tri-SE': 'tri-SW' },
  top:    { 'tri-NW': 'tri-SW', 'tri-NE': 'tri-NW', 'tri-SW': 'tri-SE', 'tri-SE': 'tri-NE' },
  bottom: { 'tri-NW': 'tri-NE', 'tri-NE': 'tri-SE', 'tri-SW': 'tri-NW', 'tri-SE': 'tri-SW' },
};

function rotateCornerTrim(trim: CornerTrim, conn: string): CornerTrim {
  return TRI_ROTATE[conn]?.[trim] ?? trim;
}

// Convert canonical (left-connected) corners to actual positions for validation.
export function canonicalToActual(canonical: Corners, conn: string): Corners {
  const r = (t: CornerTrim) => rotateCornerTrim(t, conn);
  switch (conn) {
    case 'left':
      // Canonical form is already left-connected; return a fresh array (no rotation needed).
      return [...canonical];
    case 'right':  return [r(canonical[1]), r(canonical[0]), r(canonical[3]), r(canonical[2])];
    case 'top':    return [r(canonical[2]), r(canonical[0]), r(canonical[3]), r(canonical[1])];
    case 'bottom': return [r(canonical[1]), r(canonical[3]), r(canonical[0]), r(canonical[2])];
    default:       return canonical;
  }
}

export function cornersMatch(a: Corners | undefined, b: Corners | undefined): boolean {
  if (!a && !b) return true;
  if (!a || !b) {
    const c = a ?? b;
    return !!c && c.every(s => s === 'square');
  }
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];
}

/** Is there a (non-patch) road at (nx,ny) OTHER than `road`? Shared by connection detection + neighbour count. */
function isRoadNeighbor(roads: RoadLookup, road: PlacedObject, nx: number, ny: number): boolean {
  const o = roads(nx, ny);
  return !!o && o.id !== road.id;
}

export function detectRoadConn(roads: RoadLookup, road: PlacedObject): 'left' | 'right' | 'top' | 'bottom' {
  const { x, y } = road.position;
  if (isRoadNeighbor(roads, road, x - 1, y)) return 'left';
  if (isRoadNeighbor(roads, road, x + 1, y)) return 'right';
  if (isRoadNeighbor(roads, road, x, y - 1)) return 'top';
  if (isRoadNeighbor(roads, road, x, y + 1)) return 'bottom';
  return ROTATION_TO_CONN[road.rotation] ?? 'left';
}

export function countRoadNeighbors(roads: RoadLookup, road: PlacedObject): number {
  const { x, y } = road.position;
  return ([[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]] as const)
    .filter(([nx, ny]) => isRoadNeighbor(roads, road, nx, ny)).length;
}

export type RoadConnSide = 'left' | 'right' | 'top' | 'bottom';
export type RoadSide = 'N' | 'E' | 'S' | 'W';

/**
 * The TRUE kept-edge table of each canonical road state, in the CANONICAL (left-connected) frame — derived
 * from drawRoadShape's drawn geometry, which is what actually determines whether two road cells touch:
 * EVERY cut state keeps its FULL connected edge (all five shapes contain the whole u=0 edge); the fans and
 * diagonals each keep exactly ONE full lateral edge (the far edge shrinks to a point = not kept); the wedge
 * keeps only the connected edge. Note the fan/triangle pairs {1,4} and {2,3} keep IDENTICAL edges — a fan
 * and its same-direction triangle are interchangeable for connectivity, differing only in the cut's curve.
 *
 * The per-quadrant corner TOKENS must not be used for road edge coverage: they are symbolic state markers
 * that drawRoadShape pattern-matches (e.g. state 3 stores tri-SE at TL, but the drawn \ diagonal keeps the
 * SW half of that quadrant), so token-derived coverage under-claims the connected edge for triangles and
 * over-claims the cut edges for fans — which is exactly what made triangles fail validation where their
 * same-direction fan passed.
 */
const STATE_KEPT_EDGES: readonly (readonly RoadSide[])[] = [
  ['N', 'E', 'S', 'W'], // 0: raw square
  ['W', 'N'],           // 1: BR fan    — cut toward the far bottom
  ['W', 'S'],           // 2: TR fan    — cut toward the far top
  ['W', 'S'],           // 3: diagonal \ — state 2's straight twin
  ['W', 'N'],           // 4: diagonal / — state 1's straight twin
  ['W'],                // 5: wedge
];

/** actual grid side → canonical-frame side, inverting drawRoadShape's txPt per connection side. */
const TO_CANONICAL_SIDE: Record<RoadConnSide, Record<RoadSide, RoadSide>> = {
  left:   { N: 'N', E: 'E', S: 'S', W: 'W' },
  right:  { N: 'N', E: 'W', S: 'S', W: 'E' },
  top:    { N: 'W', E: 'S', S: 'E', W: 'N' },
  bottom: { N: 'E', E: 'N', S: 'W', W: 'S' },
};

/** Which canonical state a road's STORED corners are (roads store canonical tokens), or null if foreign. */
export function matchCanonicalRoadState(corners: Corners | undefined): number | null {
  for (let i = 0; i < CANONICAL_ROAD_STATES.length; i++) {
    if (cornersMatch(corners, CANONICAL_ROAD_STATES[i])) return i;
  }
  return null;
}

/** Which canonical state an ACTUAL-frame corner array is, given the road's connection side (the frame the
 *  validators receive candidates in, via canonicalToActual), or null if it matches no canonical state. */
export function matchActualRoadState(corners: Corners | undefined, conn: RoadConnSide): number | null {
  if (!corners || corners.every((c) => c === 'square')) return 0;
  for (let i = 1; i < CANONICAL_ROAD_STATES.length; i++) {
    if (cornersMatch(corners, canonicalToActual([...CANONICAL_ROAD_STATES[i]!], conn))) return i;
  }
  return null;
}

/** Does canonical road state `stateIdx`, drawn with connection `conn`, keep its FULL edge on grid side
 *  `actualSide`? The geometry-faithful contact question for road seams. */
export function roadSideKept(stateIdx: number, conn: RoadConnSide, actualSide: RoadSide): boolean {
  return STATE_KEPT_EDGES[stateIdx]?.includes(TO_CANONICAL_SIDE[conn][actualSide]) ?? false;
}

/** Round = fan-based states (BR/TR fan, wedge); direct = triangle-based (\, /). */
export function classifyRoadKind(corners: Corners | undefined): 'round' | 'direct' | null {
  if (!corners) return null;
  if (corners.some(c => c === 'fan')) return 'round';
  if (corners.some(c => c === 'tri-NW' || c === 'tri-NE' || c === 'tri-SW' || c === 'tri-SE')) return 'direct';
  return null;
}
