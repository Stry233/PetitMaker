/*
 * road-shape.ts — the DRAWN outline of a trimmed road tile, as plain points.
 *
 * A road's stored corners are symbolic canonical-state tokens (see road-cut-states), not
 * quadrant-faithful geometry: the same tokens that make a `tri-SE` at TL mean a `\` diagonal
 * across the whole cell. So the only way to know what a cut road COVERS is to build the polygon
 * the renderers fill, which is what this does — once, for all of them: the 2D road painter, the
 * 3D road-trim mesher, and the ghost previews in both views.
 *
 * Two spaces. `roadCanonicalPoly` answers in the CANONICAL (left-connected) frame, where a cell is
 * [0,2]² and every state is written the one way; `roadTxPt` maps that frame onto the grid for a
 * road's actual connection side. Splitting them is what lets the arcs be sampled once, in the
 * frame the states are authored in: every connection side is a similarity of it, so a uniformly
 * sampled canonical arc transforms to a uniformly sampled one wherever the road points.
 */
import type { Corners, CornerTrim, PlacedObject } from '../model/types';
import type { RoadLookup } from '../model/road-lookup';
import {
  detectRoadConn, fromCanonicalSide, matchCanonicalRoadState, roadSideKept,
  type RoadConnSide, type RoadSide,
} from './road-cut-states';

export type RoadPt = [number, number];

/** The FEATHER at a road surface's outer boundary, as a fraction of a cell: the surface fades
 *  from nothing at its outline to full over this width, INSIDE its own region — against grass,
 *  terrain, the map edge or another material alike. It is a property of the surface's outline,
 *  not of what lies beyond it: where two materials meet, each fades at its own edge and the
 *  ground glowing through the two fades IS the seam — nothing draws a line. */
export const ROAD_FEATHER = 0.25;

const SIDE_DELTA: Record<RoadSide, readonly [number, number]> = {
  N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0],
};
const OPPOSITE: Record<RoadSide, RoadSide> = { N: 'S', S: 'N', E: 'W', W: 'E' };

/** Whether `road`'s own drawn shape reaches its full edge on grid side `side`. */
function keepsOwnSide(roads: RoadLookup, road: PlacedObject, side: RoadSide): boolean {
  const state = matchCanonicalRoadState(road.corners);
  if (state === null) return true; // foreign corner sets draw as the whole cell
  return roadSideKept(state, detectRoadConn(roads, road), side);
}

/**
 * Which grid sides of a road tile are its surface's BOUNDARY — where the feather fades — versus
 * interior, where the surface continues unbroken: the same material at the same level with both
 * shapes keeping the shared edge, or a foreign cut tile this tile FEEDS (the fill there is this
 * tile's own material, one surface across the cell line). One derivation for both renderers.
 */
export function roadBoundarySides(
  roads: RoadLookup, road: PlacedObject,
): { n: boolean; e: boolean; s: boolean; w: boolean } {
  const { x, y } = road.position;
  const at = (side: RoadSide): boolean => {
    const [dx, dy] = SIDE_DELTA[side];
    const o = roads(x + dx, y + dy);
    const continues = !!o && o.elevation === road.elevation && (
      (o.catalogId === road.catalogId && keepsOwnSide(roads, road, side) && keepsOwnSide(roads, o, OPPOSITE[side]))
      || (o.catalogId !== road.catalogId
        && roadCutFeeds(roads, o).some((f) => f.feeders.some((w) => w.id === road.id)))
    );
    return !continues;
  };
  return { n: at('N'), e: at('E'), s: at('S'), w: at('W') };
}

/**
 * A road tile's BODY outline, inset by `t` cells along its fading edges — `t = 0` is the drawn
 * shape itself, `t = ROAD_FEATHER` the fully-opaque core, and the renderers interpolate between
 * the two: the 2D painter as stepped alpha bands, the 3D mesher as a vertex-colour ring. A cut
 * state's arc always fades (it is the outline); a straight side fades when `roadBoundarySides`
 * says the run ends there. Every `t` yields the same point count in the same order, which is what
 * lets a mesher pair the rings vertex by vertex.
 */
export function roadBodyPoints(
  roads: RoadLookup, road: PlacedObject,
  x: number, y: number, w: number, h: number, t: number,
): RoadPt[] {
  const b = roadBoundarySides(roads, road);
  const state = matchCanonicalRoadState(road.corners);
  const conn = detectRoadConn(roads, road);
  const fade = (side: RoadSide): boolean =>
    (state !== null && state > 0 && !roadSideKept(state, conn, side))
    || (side === 'N' ? b.n : side === 'E' ? b.e : side === 'S' ? b.s : b.w);
  const iN = fade('N') ? t : 0, iE = fade('E') ? t : 0, iS = fade('S') ? t : 0, iW = fade('W') ? t : 0;
  const rx = x + iW * w, ry = y + iN * h;
  const rw = w - (iW + iE) * w, rh = h - (iN + iS) * h;
  const shaped = state !== null && state > 0
    ? roadShapePoints(road.corners, conn, rx, ry, rw, rh)
    : null;
  return shaped ?? [[rx, ry], [rx + rw, ry], [rx + rw, ry + rh], [rx, ry + rh]];
}

/** One primitive of a road outline in EXACT form: a straight segment, or a circular arc from `a`
 *  to `b` about centre `c` whose radius grows (`dr = 1`) or shrinks (`dr = -1`) as the outline
 *  insets toward the surface's interior. The region feather offsets these analytically — a line
 *  to a parallel line, an arc to a concentric arc — so nothing downstream is ever derived from a
 *  sampled chord, which is what keeps straight edges exactly straight and junctions exactly
 *  trimmed at every inset. */
export type RoadEl =
  | { kind: 'line'; a: RoadPt; b: RoadPt }
  | { kind: 'arc'; c: RoadPt; a: RoadPt; b: RoadPt; dr: 1 | -1 };

/** One fill of a cut tile's vacated area: the wrapping roads whose material draws it (one per
 *  wrapped side, all the same material — `feeders[0]` answers for its colour), and its outline at
 *  inset `t` — `t = 0` touches the cut's own arc exactly, and growing `t` retreats toward the
 *  fill's interior, so the two surfaces' feathers meet over the arc and the ground glowing
 *  through them is the seam. Same point count at every `t`, and every polygon is star-shaped
 *  from its FIRST vertex, so a mesher may fan-triangulate from there (the arcs make these
 *  concave — a fan from any other vertex overdraws across the arc). `elements` is the same
 *  outline at `t = 0` in exact form, for the region feather. */
export interface RoadFeed {
  feeders: readonly PlacedObject[];
  points(x: number, y: number, w: number, h: number, t: number): RoadPt[];
  elements(x: number, y: number, w: number, h: number): RoadEl[];
}

/** An offset arc, sampled like the kept shapes' arcs, every point held inside the canonical
 *  cell — clamped RADIALLY, along its own ray from the arc's centre, never slid sideways along
 *  a cell edge: rings at two insets then correspond point-for-point on shared rays, so the fade
 *  bands between them are clean trapezoids (a sideways clamp crossed them into bowties). Near
 *  the cell edges the fade tapers out where the two surfaces meet at the tangent. */
function clampedArc(cx: number, cy: number, a0: number, a1: number, r: number): RoadPt[] {
  const p: RoadPt[] = [];
  for (let i = 0; i <= ROAD_ARC_STEPS; i++) {
    const a = a0 + (a1 - a0) * (i / ROAD_ARC_STEPS);
    const c = Math.cos(a), s = Math.sin(a);
    // The farthest the ray from (cx, cy) can run before leaving [0,2]², per axis.
    let tMax = Infinity;
    if (c > 1e-12) tMax = Math.min(tMax, (2 - cx) / c);
    else if (c < -1e-12) tMax = Math.min(tMax, (0 - cx) / c);
    if (s > 1e-12) tMax = Math.min(tMax, (2 - cy) / s);
    else if (s < -1e-12) tMax = Math.min(tMax, (0 - cy) / s);
    const t = Math.min(r, tMax);
    p.push([cx + t * c, cy + t * s]);
  }
  return p;
}

/** A feed part in the canonical frame at inset `tc` (canonical units): the sides it must be
 *  wrapped from, and its polygon — the exact complement of the kept shape at `tc = 0`. The fans
 *  split at their arc's 45° into one part per vacated side, so each half is fed by whatever
 *  stands on ITS side; a triangle or wedge complement has no natural halves and stays whole.
 *  Every polygon leads with the vertex the whole region is visible from — the far corner behind
 *  an arc, the notch apex of the wedge complement — the star vertex `RoadFeed` promises. */
function feedPart(state: number, half: number, tc: number): { sides: readonly RoadSide[]; poly: RoadPt[] } | null {
  const c = tc * Math.SQRT2; // where an offset diagonal meets a cell edge
  const r = 2 + tc;
  const q = Math.PI / 4;
  switch (state) {
    case 1: return half === 0
      ? { sides: ['E'], poly: [[2, 2], ...clampedArc(0, 0, 0, q, r)] }
      : half === 1 ? { sides: ['S'], poly: [[2, 2], ...clampedArc(0, 0, q, 2 * q, r)] }
      : { sides: ['E', 'S'], poly: [[2, 2], ...clampedArc(0, 0, 0, 2 * q, r)] };
    case 2: return half === 0
      ? { sides: ['E'], poly: [[2, 0], ...clampedArc(0, 2, -q, 0, r)] }
      : half === 1 ? { sides: ['N'], poly: [[2, 0], ...clampedArc(0, 2, -2 * q, -q, r)] }
      : { sides: ['E', 'N'], poly: [[2, 0], ...clampedArc(0, 2, -2 * q, 0, r)] };
    case 3: return half === 0 ? { sides: ['N', 'E'], poly: [[2, 0], [2, 2 - c], [c, 0]] } : null;
    case 4: return half === 0 ? { sides: ['E', 'S'], poly: [[2, 2], [c, 2], [2, c]] } : null;
    case 5: return half === 0
      ? { sides: ['N', 'E', 'S'], poly: [[1 + c, 1], [c, 0], [2, 0], [2, 2], [c, 2]] } : null;
    default: return null;
  }
}

const SQ2 = Math.SQRT2;

/** The exact elements of a feed part in the canonical frame — the same shapes `feedPart` samples,
 *  with the arcs kept as arcs (`dr = 1`: a fill's arc grows away from the cut as it insets). */
function feedElements(state: number, half: number): RoadEl[] {
  const L = (ax: number, ay: number, bx: number, by: number): RoadEl => ({ kind: 'line', a: [ax, ay], b: [bx, by] });
  const A = (cx: number, cy: number, ax: number, ay: number, bx: number, by: number): RoadEl =>
    ({ kind: 'arc', c: [cx, cy], a: [ax, ay], b: [bx, by], dr: 1 });
  switch (state) {
    case 1: return half === 0
      ? [L(2, 2, 2, 0), A(0, 0, 2, 0, SQ2, SQ2), L(SQ2, SQ2, 2, 2)]
      : half === 1 ? [L(2, 2, SQ2, SQ2), A(0, 0, SQ2, SQ2, 0, 2), L(0, 2, 2, 2)]
      : [L(2, 2, 2, 0), A(0, 0, 2, 0, 0, 2), L(0, 2, 2, 2)];
    case 2: return half === 0
      ? [L(2, 0, SQ2, 2 - SQ2), A(0, 2, SQ2, 2 - SQ2, 2, 2), L(2, 2, 2, 0)]
      : half === 1 ? [L(2, 0, 0, 0), A(0, 2, 0, 0, SQ2, 2 - SQ2), L(SQ2, 2 - SQ2, 2, 0)]
      : [L(2, 0, 0, 0), A(0, 2, 0, 0, 2, 2), L(2, 2, 2, 0)];
    case 3: return [L(2, 0, 2, 2), L(2, 2, 0, 0), L(0, 0, 2, 0)];
    case 4: return [L(2, 2, 0, 2), L(0, 2, 2, 0), L(2, 0, 2, 2)];
    case 5: return [L(1, 1, 0, 0), L(0, 0, 2, 0), L(2, 0, 2, 2), L(2, 2, 0, 2), L(0, 2, 1, 1)];
    default: return [];
  }
}

/** The exact elements of a canonical KEPT shape (`dr = -1`: a kept arc shrinks as it insets);
 *  the full square for anything without a trimmed shape. */
function keptElements(state: number | null): RoadEl[] {
  const L = (ax: number, ay: number, bx: number, by: number): RoadEl => ({ kind: 'line', a: [ax, ay], b: [bx, by] });
  const A = (cx: number, cy: number, ax: number, ay: number, bx: number, by: number): RoadEl =>
    ({ kind: 'arc', c: [cx, cy], a: [ax, ay], b: [bx, by], dr: -1 });
  switch (state) {
    case 1: return [L(0, 0, 2, 0), A(0, 0, 2, 0, 0, 2), L(0, 2, 0, 0)];
    case 2: return [L(0, 2, 2, 2), A(0, 2, 2, 2, 0, 0), L(0, 0, 0, 2)];
    case 3: return [L(0, 0, 0, 2), L(0, 2, 2, 2), L(2, 2, 0, 0)];
    case 4: return [L(0, 0, 2, 0), L(2, 0, 0, 2), L(0, 2, 0, 0)];
    case 5: return [L(0, 0, 1, 1), L(1, 1, 0, 2), L(0, 2, 0, 0)];
    default: return [L(0, 0, 2, 0), L(2, 0, 2, 2), L(2, 2, 0, 2), L(0, 2, 0, 0)];
  }
}

function txEl(el: RoadEl, conn: RoadConnSide, x: number, y: number, hw: number, hh: number): RoadEl {
  const tx = ([u, v]: RoadPt): RoadPt => roadTxPt(u, v, conn, x, y, hw, hh);
  return el.kind === 'line'
    ? { kind: 'line', a: tx(el.a), b: tx(el.b) }
    : { kind: 'arc', c: tx(el.c), a: tx(el.a), b: tx(el.b), dr: el.dr };
}

/** A road tile's drawn outline as exact elements — the `t = 0` shape `roadBodyPoints` samples. */
export function roadBodyElements(
  roads: RoadLookup, road: PlacedObject, x: number, y: number, w: number, h: number,
): RoadEl[] {
  const state = matchCanonicalRoadState(road.corners);
  const conn = detectRoadConn(roads, road);
  return keptElements(state).map((el) => txEl(el, conn, x, y, w / 2, h / 2));
}

/**
 * The fills of this cut tile's vacated area — the concave (gamma) half of a cut pair, matching
 * how the game interlocks two surfaces around a curve. Each part is fed by the foreign road on
 * its own side(s): same material across the part's sides, standing at the tile's level, each
 * presenting a full (kept) edge to continue from; a part whose wrap is missing shows ground.
 * A fan wrapped by one material draws as one whole. Derived, never stored: like the terrain cut
 * backing, a feed exists exactly while its context holds, so the pair cannot desync.
 */
export function roadCutFeeds(roads: RoadLookup, road: PlacedObject): RoadFeed[] {
  const state = matchCanonicalRoadState(road.corners);
  if (!state) return [];
  const conn = detectRoadConn(roads, road);

  const feederOn = (cSide: RoadSide): PlacedObject | null => {
    const side = fromCanonicalSide(conn, cSide);
    const [dx, dy] = SIDE_DELTA[side];
    const n = roads(road.position.x + dx, road.position.y + dy);
    if (!n || n.catalogId === road.catalogId || n.elevation !== road.elevation) return null;
    return keepsOwnSide(roads, n, OPPOSITE[side]) ? n : null;
  };

  const halves = state === 1 || state === 2 ? [0, 1] : [0];
  const fed: { feeders: PlacedObject[]; half: number }[] = [];
  for (const half of halves) {
    const part = feedPart(state, half, 0);
    if (!part) continue;
    const wraps: PlacedObject[] = [];
    for (const cSide of part.sides) {
      const n = feederOn(cSide);
      if (!n || (wraps.length > 0 && wraps[0]!.catalogId !== n.catalogId)) { wraps.length = 0; break; }
      wraps.push(n);
    }
    if (wraps.length > 0) fed.push({ feeders: wraps, half });
  }

  // A fan wrapped by one material draws as one unbroken fill (half 2 = the whole complement).
  if (fed.length === 2 && fed[0]!.feeders[0]!.catalogId === fed[1]!.feeders[0]!.catalogId) {
    fed.splice(0, 2, { feeders: [...fed[0]!.feeders, ...fed[1]!.feeders], half: 2 });
  }

  return fed.map(({ feeders, half }) => ({
    feeders,
    points: (x: number, y: number, w: number, h: number, t: number) =>
      feedPart(state, half, t * 2)!.poly.map(([u, v]) => roadTxPt(u, v, conn, x, y, w / 2, h / 2)),
    elements: (x: number, y: number, w: number, h: number) =>
      feedElements(state, half).map((el) => txEl(el, conn, x, y, w / 2, h / 2)),
  }));
}

/** Fan subdivisions. The curve is a quarter circle; 16 is what both renderers have always drawn it with. */
export const ROAD_ARC_STEPS = 16;

/**
 * The FILLED polygon of a canonical road state, in (u,v) ∈ [0,2]² — 'square' marks a KEPT corner.
 * null for a full square or a corner set matching no canonical state; both draw as the whole cell.
 */
export function roadCanonicalPoly(corners: Corners | undefined): RoadPt[] | null {
  if (!corners) return null;
  const sq = (s: CornerTrim): boolean => s === 'square';
  const [tl, tr, bl, br] = corners;
  const arc = (cx: number, cy: number, a0: number, a1: number): RoadPt[] => {
    const p: RoadPt[] = [];
    for (let i = 0; i <= ROAD_ARC_STEPS; i++) {
      const a = a0 + (a1 - a0) * (i / ROAD_ARC_STEPS);
      p.push([cx + 2 * Math.cos(a), cy + 2 * Math.sin(a)]);
    }
    return p;
  };
  if (sq(tl) && sq(tr) && sq(bl) && !sq(br)) return [[0, 0], ...arc(0, 0, 0, Math.PI / 2)];   // BR fan
  if (sq(tl) && !sq(tr) && sq(bl) && sq(br)) return [[0, 2], ...arc(0, 2, 0, -Math.PI / 2)];  // TR fan
  if (!sq(tl) && !sq(tr) && sq(bl) && sq(br)) return [[0, 0], [0, 2], [2, 2]];                 // diagonal \
  if (sq(tl) && sq(tr) && !sq(bl) && !sq(br)) return [[0, 0], [2, 0], [0, 2]];                 // diagonal /
  if (sq(tl) && !sq(tr) && sq(bl) && !sq(br)) return [[0, 0], [1, 1], [0, 2]];                 // wedge
  return null;
}

/** Does this corner set have a canonical trimmed shape? (A full square does not: it is drawn as a cell.) */
export function hasRoadTrimShape(corners: Corners | undefined): boolean {
  return roadCanonicalPoly(corners) !== null;
}

/** A canonical point (u,v) placed on the grid: cell corner (x,y), half-extents (hw,hh), for a road
 *  connected on `side`. */
export function roadTxPt(
  u: number, v: number, side: RoadConnSide,
  x: number, y: number, hw: number, hh: number,
): RoadPt {
  switch (side) {
    case 'left': return [x + u * hw, y + v * hh];
    case 'right': return [x + (2 - u) * hw, y + v * hh];
    case 'top': return [x + v * hw, y + u * hh];
    case 'bottom': return [x + (2 - v) * hw, y + (2 - u) * hh];
  }
}

/** The drawn polygon of a trimmed road tile occupying (x,y)–(x+w,y+h). null = draw the whole cell. */
export function roadShapePoints(
  corners: Corners | undefined,
  side: RoadConnSide,
  x: number, y: number, w: number, h: number,
): RoadPt[] | null {
  const poly = roadCanonicalPoly(corners);
  if (!poly) return null;
  const hw = w / 2, hh = h / 2;
  return poly.map(([u, v]) => roadTxPt(u, v, side, x, y, hw, hh));
}
