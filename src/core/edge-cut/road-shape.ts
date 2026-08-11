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
import type { Corners, CornerTrim } from '../model/types';
import type { RoadConnSide } from './road-cut-states';

export type RoadPt = [number, number];

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
