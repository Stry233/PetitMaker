import { TerrainType } from '../model/types';
import type { TerrainCell } from '../model/types';
import { cornerRevealTier, EDGE_NEIGHBORS } from './terrain-silhouette';

export interface CutBacking {
  type: TerrainType;
  elevation: number;
}

/**
 * Decide, PER CORNER, what fills behind a trimmed corner so a cut never falls through to bare ground.
 * Returns one full-quadrant backing per corner (TL/TR/BL/BR), or null where nothing backs it.
 *
 * Two distinct sources, mirroring the kernel's terrainSolidAt:
 *  - A Γ (gamma) PATCH is a fillet at tier N sitting ON its own solid base (mass 1..N-1 across the WHOLE
 *    cell) → the base renders as a FULL block: every quadrant backs with tier N-1, not just the fillet's.
 *    (A tier-1 fillet has no base — it sits straight on the ground.)
 *  - A cut on a REAL cell goes through its whole pillar, so what shows is NEIGHBOUR mass — judged from
 *    the THREE cells meeting that corner (two edge neighbours + the diagonal; an ortho-only scan misses
 *    diagonal mass and leaks ground). A cut MOUNTAIN corner reveals the highest same-type mass below its
 *    top (a plateau step → that step's tier; a lone pillar → nothing → ground). A cut WATER corner is
 *    FILLED by the adjacent mountain at the corner (the render half of the reveal rule: a cut corner
 *    shows the surface actually behind it — the water rounds, and the adjacent mountain rim fills in
 *    behind it).
 *
 * @param renderElevation the tier this cell is drawn at (its elevation, unless layers are hidden)
 * @param neighborAt the terrain at offset (dx,dy) from this cell
 */
export function cutBackingByCorner(
  terrain: TerrainCell,
  renderElevation: number,
  neighborAt: (dx: number, dy: number) => TerrainCell | null | undefined,
): [CutBacking | null, CutBacking | null, CutBacking | null, CutBacking | null] {
  const out: [CutBacking | null, CutBacking | null, CutBacking | null, CutBacking | null] = [null, null, null, null];
  const corners = terrain.corners;
  if (!corners) return out;

  if (terrain.patchOnly) {
    // A Γ patch is a COSMETIC fillet — it backs only the REAL support it sits on (`patchBase`): a from-
    // empty gamma (patchBase 0) shows NO base at all (the previously-empty notch stays open); a gamma that
    // rounds a genuinely real lower block backs that full block under every quadrant. Compatibility:
    // patches saved before `patchBase` existed default to elevation-1. So an edge cut never paints a base
    // that wasn't real.
    const support = terrain.patchBase ?? (renderElevation - 1);
    if (support >= 1) {
      const base: CutBacking = { type: terrain.type, elevation: support };
      return [base, base, base, base];
    }
    return out;
  }

  // A GROUND-island cut (a cell of type None carrying corners — see Edge-Cut: ground is a cuttable surface,
  // the inverse of a water pond). The kept shape draws grass; behind the rounded-away part shows the WATER
  // the island sits in — the EDGE-adjacent water at that corner.
  if (terrain.type === TerrainType.None) {
    for (let i = 0; i < 4; i++) {
      const c = corners[i];
      if (c === 'square' || c === 'empty') continue;
      for (const [dx, dy] of EDGE_NEIGHBORS[i] ?? []) {
        const n = neighborAt(dx, dy);
        if (n && n.type === TerrainType.Water) { out[i] = { type: TerrainType.Water, elevation: n.elevation }; break; }
      }
    }
    return out;
  }

  const isWater = terrain.type === TerrainType.Water;
  for (let i = 0; i < 4; i++) {
    const c = corners[i];
    if (c === 'square' || c === 'empty') continue;
    const reveal = cornerRevealTier(neighborAt, i, terrain.type, renderElevation);
    if (reveal >= 1) {
      out[i] = { type: isWater ? TerrainType.Mountain : terrain.type, elevation: reveal };
    } else if (!isWater) {
      // A cut MOUNTAIN corner with no lower mountain step behind it — a mountain ISLAND poking into water —
      // reveals the water it sits in (the same generic rule as a cut ground island, and symmetric to cut
      // water revealing its mountain rim above). EDGE-adjacent only. (A mountain that merely BANKS water on
      // one edge is not cuttable here — trim-lock locks that corner — so this only fires for island tips.)
      for (const [dx, dy] of EDGE_NEIGHBORS[i] ?? []) {
        const n = neighborAt(dx, dy);
        if (n && n.type === TerrainType.Water) { out[i] = { type: TerrainType.Water, elevation: n.elevation }; break; }
      }
    }
  }
  return out;
}
