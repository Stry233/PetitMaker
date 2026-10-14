/*
 * The one geometric primitive under all edge-cut logic.
 *
 * A cell at elevation N is a vertical stack of layers, so every trim question is really a question
 * about the silhouette of solid terrain at a specific layer e:
 *   - "is this corner cuttable?"        → is it a free corner of the silhouette at the cell's top layer?
 *   - "is this a Γ (gamma) notch?"      → does the silhouette at layer e wrap the corner?
 *   - "what shows behind a cut?"        → the silhouette of the layers below it.
 *
 * Everything here is geometry. Design policies (water rounds toward land / mountain fills toward water /
 * a waterfall's lip stays square / generation never raises blocks) live with their consumers, named, on
 * top of these primitives — never mixed into them.
 */
import { TerrainType } from '../../model/types';
import type { GridState, TerrainCell } from '../../model/types';
import { getCell } from '../../model/grid-model';
import { patchSupport, surfaceElevation, terrainSolidAt } from '../terrain/terrain-surface';
import { NEIGHBORS4 } from '../../grid/directions';
import { CORNERS } from '../../model/corners';

/** Does the layer-`e` silhouette of `type` wrap corner `i` of (x,y) — a concave (Γ) corner? True when both
 *  edge-sharing neighbours hold solid `type` mass there and the diagonal cell closes the corner at layer e —
 *  either a same-type stack that reaches layer e, or water (a Γ cut only adds a cosmetic fillet, never removes
 *  mass, so a water pond on the diagonal is always safe to round around — it can't bridge a gap or break the
 *  bank). A diagonal that does not reach layer e — an empty gap, or a lower same-type block such as the base
 *  beneath a diagonal pinch — leaves the corner open: filling it would bridge two blocks that only touch at a
 *  point. This is what makes edge-cutting independent of elevation: a diagonal pinch behaves identically whether
 *  the cells between the two blocks are empty ground or a lower base. Says nothing about the cell itself: the
 *  notch may be empty or hold a lower (hidden) block; the caller decides what to do with it. */
export function cornerWrappedAt(
  state: GridState, x: number, y: number, i: number, wall: { type: TerrainType; elevation: number },
): boolean {
  return cornerWrappedBy((dx, dy) => getCell(state.cells, x + dx, y + dy)?.terrain, i, wall.type, wall.elevation);
}

/** `cornerWrappedAt` addressed by offset instead of by cell. */
function cornerWrappedBy(
  neighborAt: (dx: number, dy: number) => TerrainCell | null | undefined,
  i: number, type: TerrainType, e: number,
): boolean {
  const c = CORNERS[i];
  if (!c) return false;
  const [a, b] = c.edges;
  const edgesWrapped = terrainSolidAt(neighborAt(a[0], a[1]), type, e) && terrainSolidAt(neighborAt(b[0], b[1]), type, e);
  if (!edgesWrapped) return false;
  const diag = neighborAt(c.diagonal[0], c.diagonal[1]);
  if (!diag || diag.type === TerrainType.None) return false;            // empty gap — not enclosed
  return terrainSolidAt(diag, type, e) || diag.type === TerrainType.Water; // reaches the tier, or a (safe) pond
}

/**
 * Is (x,y) a pit in the surface rather than a notch: a cell with nothing of its own to render and
 * terrain on all four edges? A Γ fillet rounds a notch open on at least one side; filleting a pit
 * floats a fillet over bare ground that renders as grass inside the mass and refuses paint for lack
 * of support. A cell holding a real block (a lower pit, a pond) is not a pit, nor is one ringed by
 * ground-level water (an islet rounds through `groundConvexCornerInWater`).
 */
export function enclosedGap(state: GridState, x: number, y: number): boolean {
  const t = getCell(state.cells, x, y)?.terrain;
  const bare = !t || t.type === TerrainType.None || (!!t.patchOnly && patchSupport(t) < 1);
  if (!bare) return false;
  return NEIGHBORS4.every(([dx, dy]) => surfaceElevation(getCell(state.cells, x + dx, y + dy)?.terrain) >= 1);
}

/**
 * Is corner `i` of (x,y) a ground cell's convex corner poking into water — the corner of a ground islet
 * (or peninsula) that should round out, revealing the water it sits in? True when the cell holds no real
 * terrain (plain ground = no TerrainCell, or a `None` islet-cut cell carrying corners) and both edge
 * neighbours at the corner are water.
 *
 * This is the symmetric inverse of a water pond's convex corner: a pond is a water cell whose corner rounds
 * to reveal ground; an islet is a ground cell whose corner rounds to reveal water. The cut lives on the
 * ground cell (materialised as a `type: None` cell with corners) so it renders at the islet's own corner —
 * not on a diagonal water cell. Requiring both edges to be water excludes the seam between two islet cells
 * (only one edge is water there) and straight coastlines (the corner isn't convex into water).
 */
export function groundConvexCornerInWater(state: GridState, x: number, y: number, i: number): boolean {
  const t = getCell(state.cells, x, y)?.terrain;
  if (t && t.type !== TerrainType.None) return false; // real mountain/water here, not a ground corner
  const c = CORNERS[i];
  if (!c) return false;
  // The corner must be fully wrapped by ground-level water — all three meeting cells water at elevation 0.
  //  - all three (edges and diagonal): the two-edges-only test also fires on the empty gap between two
  //    diagonal water cells, wrongly turning that gap into an "islet"; the gap's diagonal is ground.
  //  - elevation 0 specifically: a ground islet is always elevation 0, and elevated water around a lower
  //    ground cell is illegal terrain (V-WTR-02 uncapped / V-WTR-03 waterfall-onto-a-pit). Accepting the
  //    cut there only to have post-stroke silently revert it is misleading — so we don't offer it at all.
  return [...c.edges, c.diagonal].every(([dx, dy]) => {
    const n = getCell(state.cells, x + dx, y + dy)?.terrain;
    return !!n && n.type === TerrainType.Water && n.elevation === 0;
  });
}

/** The highest orthogonally-adjacent real (non-patch) terrain — the reference tier a Γ corner is rounded
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
