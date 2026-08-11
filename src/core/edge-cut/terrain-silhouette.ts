/*
 * terrain-silhouette.ts — the ONE geometric primitive under all edge-cut logic.
 *
 * A cell at elevation N is a vertical STACK of layers, so every trim question is really a question
 * about the silhouette of solid terrain at a specific layer e:
 *   - "is this corner cuttable?"        → is it a FREE corner of the silhouette at the cell's top layer?
 *   - "is this a Γ (gamma) notch?"      → does the silhouette at layer e WRAP the corner?
 *   - "what shows behind a cut?"        → the silhouette of the layers below it.
 *
 * Everything here is geometry. Design POLICIES (water rounds toward land / mountain fills toward water /
 * a waterfall's lip stays square / generation never raises blocks) live with their consumers, named, on
 * top of these primitives — never mixed into them.
 */
import { TerrainType } from '../model/types';
import type { GridState, TerrainCell } from '../model/types';
import { getCell, NEIGHBORS4 } from '../model/grid-model';

/** Corner index (0=TL, 1=TR, 2=BL, 3=BR) → the three cells that meet at that corner: the two
 *  edge-sharing neighbours FIRST, then the diagonal. Single source for all corner adjacency.
 *  The CONCAVE (Γ-wrap) test (`cornerWrappedBy`/`cornerWrappedAt`) reads the two EDGE cells as the
 *  wrapping mass and requires the diagonal to CLOSE the corner at the wrapping tier; the
 *  convex/reveal tests use just the two edges. */
export const CORNER_NEIGHBORS: readonly (readonly (readonly [number, number])[])[] = [
  [[-1, 0], [0, -1], [-1, -1]], // TL
  [[1, 0], [0, -1], [1, -1]],   // TR
  [[-1, 0], [0, 1], [-1, 1]],   // BL
  [[1, 0], [0, 1], [1, 1]],     // BR
];

/** Corner index → the TWO edge-sharing neighbours only (no diagonal). Use this for CONVEX questions —
 *  "is this a free corner?" and "what shows behind a cut?". A diagonal cell touches the corner at a single
 *  point: it neither pins a convex corner nor can it fill the quadrant revealed behind a cut. Only an edge
 *  neighbour, which shares a whole half-edge, does either. (= CORNER_NEIGHBORS[i] minus the trailing diagonal.) */
export const EDGE_NEIGHBORS: readonly (readonly (readonly [number, number])[])[] = [
  [[-1, 0], [0, -1]], // TL
  [[1, 0], [0, -1]],  // TR
  [[-1, 0], [0, 1]],  // BL
  [[1, 0], [0, 1]],   // BR
];

/** The REAL structural top a cell contributes as mass. A Γ patch is a COSMETIC fillet: it adds NO mass of
 *  its own — its support is whatever the cell ALREADY was when the corner was cut (`patchBase`): 0 for a
 *  from-empty gamma (no base block, like a tier-1 fillet at any tier), N-1 when it rounds a genuinely real
 *  lower block. Falls back to elevation-1 for patches saved before patchBase existed. A real (non-patch)
 *  block contributes its full elevation. An edge cut never changes THIS — only the corners. */
export function structuralTop(t: TerrainCell): number {
  return t.patchOnly ? (t.patchBase ?? t.elevation - 1) : t.elevation;
}

/** Does this terrain hold solid mass of `type` at layer `e`? Mountain at elevation N fills layers 1..N;
 *  water at elevation N fills 0..N (a lake sits at ground level; a waterfall is a column down to its
 *  pool). A Γ patch contributes only its `patchBase` support — its cosmetic fillet tier holds no mass. */
export function terrainSolidAt(t: TerrainCell | null | undefined, type: TerrainType, e: number): boolean {
  if (!t || t.type !== type) return false;
  const top = structuralTop(t);
  return type === TerrainType.Water ? e >= 0 && e <= top : e >= 1 && e <= top;
}

/** Does the layer-`e` silhouette of `type` WRAP corner `i` of (x,y) — a CONCAVE (Γ) corner? True when BOTH
 *  EDGE-sharing neighbours hold solid `type` mass there AND the DIAGONAL cell CLOSES the corner AT layer e —
 *  either a same-type stack that reaches layer e, OR water (a Γ cut only ADDS a cosmetic fillet, never removes
 *  mass, so a water pond on the diagonal is always safe to round around — it can't bridge a gap or break the
 *  bank). A diagonal that does NOT reach layer e — an empty gap, OR a LOWER same-type block such as the base
 *  beneath a diagonal pinch — leaves the corner OPEN: filling it would bridge two blocks that only touch at a
 *  point. This is what makes edge-cutting elevation-INDEPENDENT: a diagonal pinch behaves identically whether
 *  the cells between the two blocks are empty ground or a lower base. Says nothing about the cell itself: the
 *  notch may be empty OR hold a lower (hidden) block; the caller decides what to do with it. */
export function cornerWrappedAt(state: GridState, x: number, y: number, i: number, type: TerrainType, e: number): boolean {
  return cornerWrappedBy((dx, dy) => getCell(state.cells, x + dx, y + dy)?.terrain, i, type, e);
}

/** `cornerWrappedAt` addressed by OFFSET instead of by cell — the form the RENDER side needs, which holds a
 *  layer-clamped neighbour accessor rather than the grid. Same geometry, one answer for both callers. */
export function cornerWrappedBy(
  neighborAt: (dx: number, dy: number) => TerrainCell | null | undefined,
  i: number, type: TerrainType, e: number,
): boolean {
  const adj = CORNER_NEIGHBORS[i];
  if (!adj) return false;
  const edgesWrapped = terrainSolidAt(neighborAt(adj[0]![0], adj[0]![1]), type, e)
    && terrainSolidAt(neighborAt(adj[1]![0], adj[1]![1]), type, e);
  if (!edgesWrapped) return false;
  const diag = neighborAt(adj[2]![0], adj[2]![1]);
  if (!diag || diag.type === TerrainType.None) return false;            // empty gap — not enclosed
  return terrainSolidAt(diag, type, e) || diag.type === TerrainType.Water; // reaches the tier, or a (safe) pond
}

/** The highest tier at which `type` mass stands on BOTH EDGES of corner `i` — the tier at which the two
 *  flanking masses meet here. 0 when either edge is bare of it. Mass fills every layer up to its top, so
 *  the answer is just the lower of the two tops.
 *
 *  DIAGONAL-BLIND, unlike `cornerWrappedBy`, and that is the whole distinction between the two: the
 *  diagonal governs whether MASS may be ADDED at a corner (a Γ fillet over an open diagonal would bridge
 *  two blocks that touch only at a point, and you could then walk between them), which is a question about
 *  a fillet. A corner already CUT asks a different one — what shows behind it — and answering it adds
 *  nothing, so the pinch has no say. */
export function cornerEdgeCoverTier(
  neighborAt: (dx: number, dy: number) => TerrainCell | null | undefined,
  i: number, type: TerrainType,
): number {
  const adj = CORNER_NEIGHBORS[i];
  if (!adj) return 0;
  return Math.min(
    solidTopOf(neighborAt(adj[0]![0], adj[0]![1]), type),
    solidTopOf(neighborAt(adj[1]![0], adj[1]![1]), type),
  );
}

/**
 * Is (x,y) a PIT in the surface rather than a notch in it — a cell with nothing of its own to
 * render, with terrain standing on all FOUR edges?
 *
 * A Γ fillet rounds a corner the mass wraps and the ground walks out of: a notch is open on at
 * least one side, and the bare ground inside it is the same ground that continues outside. Where
 * terrain stands all the way round, that is not a notch but a hole in the surface. Filleting its
 * corners floats a fillet at the wrapping tier with bare ground under it — a cell that LOOKS like
 * terrain, renders as a scrap of grass inside the mass, and refuses the paint that would fill it
 * because it holds no support ("no base"). With all four corners cut it reads as a diamond of
 * grass inside a solid plateau.
 *
 * A cell that holds a real block (a pit one level down, a pond) is NOT this — its own surface
 * renders, and rounding the rim above it is exactly what a fillet is for. Neither is a cell ringed
 * by ground-level water: an island in a pond stands at the same height as the ground inside it, and
 * rounds through its own path (`groundConvexCornerInWater`).
 */
export function enclosedGap(state: GridState, x: number, y: number): boolean {
  const t = getCell(state.cells, x, y)?.terrain;
  const bare = !t || t.type === TerrainType.None || (!!t.patchOnly && (t.patchBase ?? t.elevation - 1) < 1);
  if (!bare) return false;
  return NEIGHBORS4.every(([dx, dy]) => surfaceElevation(getCell(state.cells, x + dx, y + dy)?.terrain) >= 1);
}

/** The top solid layer this terrain holds as `type` mass (a Γ patch counts as its real base = patchBase,
 *  0 for a from-empty gamma), or 0. */
export function solidTopOf(t: TerrainCell | null | undefined, type: TerrainType): number {
  if (!t || t.type !== type) return 0;
  return structuralTop(t);
}

/**
 * Is corner `i` of (x,y) a GROUND cell's CONVEX corner poking into water — the corner of a ground island
 * (or peninsula) that should round OUT, revealing the water it sits in? True when the cell holds NO real
 * terrain (plain ground = no TerrainCell, OR a `None` island-cut cell carrying corners) AND both EDGE
 * neighbours at the corner are water.
 *
 * This is the symmetric inverse of a water pond's convex corner: a pond is a WATER cell whose corner rounds
 * to reveal ground; an island is a GROUND cell whose corner rounds to reveal water. The cut lives ON the
 * ground cell (materialised as a `type: None` cell with corners) so it renders at the island's own corner —
 * not on a diagonal water cell. Requiring BOTH edges to be water excludes the seam between two island cells
 * (only one edge is water there) and straight coastlines (the corner isn't convex into water).
 */
export function groundConvexCornerInWater(state: GridState, x: number, y: number, i: number): boolean {
  const t = getCell(state.cells, x, y)?.terrain;
  if (t && t.type !== TerrainType.None) return false; // real mountain/water here, not a ground corner
  const adj = CORNER_NEIGHBORS[i];
  if (!adj) return false;
  // The corner must be FULLY wrapped by GROUND-LEVEL water — all three meeting cells water at elevation 0.
  //  - all three (edges AND diagonal): the two-edges-only test also fires on the empty GAP between two
  //    diagonal water cells, wrongly turning that gap into an "island"; the gap's diagonal is ground.
  //  - elevation 0 specifically: a ground island is always elevation 0, and elevated water around a lower
  //    ground cell is illegal terrain (V-WTR-02 uncapped / V-WTR-03 waterfall-onto-a-pit). Accepting the
  //    cut there only to have post-stroke silently revert it is misleading — so we don't offer it at all.
  return adj.every(([dx, dy]) => {
    const n = getCell(state.cells, x + dx, y + dy)?.terrain;
    return !!n && n.type === TerrainType.Water && n.elevation === 0;
  });
}

/**
 * The cell's REAL standable surface, for placement/support questions. A Γ patch is COSMETIC: it reads as
 * its real support (`patchBase`), NOT its fillet tier — so a from-empty gamma (patchBase 0) is bare ground
 * (null) at any tier, and a gamma rounding a real lower block reads as that block. Placement validity must
 * go through this — raw `terrain.elevation` reads see the fillet as a full block and phantom-block /
 * phantom-allow placements.
 */
export function realSurface(t: TerrainCell | null | undefined): { type: TerrainType; elevation: number } | null {
  const top = surfaceTop(t);
  return top < 0 ? null : { type: t!.type, elevation: top };
}

/** Placement elevation of a cell's real surface (ground = 0). Allocation-free equivalent of
 *  `realSurface(t)?.elevation ?? 0` — this runs inside per-footprint placement sweeps. */
export function surfaceElevation(t: TerrainCell | null | undefined): number {
  const top = surfaceTop(t);
  return top < 0 ? 0 : top;
}

/** The ONE scalar core behind realSurface/surfaceElevation: the standable-surface elevation, or
 *  −1 when the cell has no real surface (empty/None, a mountain with no real block, a fully
 *  cosmetic water fillet). A water column still holds water below its fillet, hence >= 0. */
function surfaceTop(t: TerrainCell | null | undefined): number {
  if (!t || t.type === TerrainType.None) return -1;
  const top = structuralTop(t);
  if (t.type === TerrainType.Mountain) return top >= 1 ? top : -1;
  return top >= 0 ? top : -1;
}

/** The tier a cut at corner `i` of a `type` cell topped at `top` would REVEAL: the highest mass that still
 *  meets the corner behind the cut. Judged from the TWO EDGE neighbours only — a diagonal cell touches the
 *  corner at a point and can't fill the revealed quadrant (an edge-blind scan leaks a point-contact step or
 *  a disconnected hill into the cut).
 *   - MOUNTAIN: the highest EDGE-adjacent same-type step strictly below `top` (a plateau step → that tier;
 *     a lone wall → nothing → ground).
 *   - WATER at layer `top`: an EDGE mountain that is solid AT THE WATER'S OWN LAYER backs the rounded water
 *     (an elevated pool's rim at the same level, or a wall the water laps). A mountain that doesn't reach
 *     the water's layer (e.g. an L2 cliff beside an L0 river) is NOT its bank — the cut reveals ground.
 *  0 = nothing meets it; the cut falls through to bare ground (the BaseLayer zone shows — a shore/bank). */
export function cornerRevealTier(
  neighborAt: (dx: number, dy: number) => TerrainCell | null | undefined,
  i: number, type: TerrainType, top: number,
): number {
  let best = 0;
  for (const [dx, dy] of EDGE_NEIGHBORS[i] ?? []) {
    const n = neighborAt(dx, dy);
    if (type === TerrainType.Water) {
      // The reveal is the wall AT THE WATERLINE — the bank. A taller cliff
      // still banks the pool at the pool's own layer (its higher mass rises
      // BEHIND the corner, it isn't what the rounded water opens onto), so the
      // 2D fill takes the bank layer's color and the 3D backing column stays
      // at pool height.
      if (terrainSolidAt(n, TerrainType.Mountain, top) && top > best) best = top;
    } else {
      const own = solidTopOf(n, type);
      if (own < top && own > best) best = own;
    }
  }
  return best;
}

/** The HIGHEST orthogonally-adjacent real (non-patch) terrain — the reference tier a Γ corner is rounded
 *  toward: a concave corner belongs to the tallest structure wrapping it, and its fill must match that
 *  tier (not a lower neighbour that happens to be scanned first). */
export function highestNeighborTerrain(state: GridState, x: number, y: number): { type: TerrainType; elevation: number } | null {
  let best: { type: TerrainType; elevation: number } | null = null;
  for (const [dx, dy] of NEIGHBORS4) {
    const t = getCell(state.cells, x + dx, y + dy)?.terrain;
    if (t && t.type !== TerrainType.None && !t.patchOnly && (!best || t.elevation > best.elevation)) {
      best = { type: t.type, elevation: t.elevation };
    }
  }
  return best;
}
