import { TerrainType } from '../model/types';
import type { TerrainCell } from '../model/types';
import { cornerRevealTier, cornerEdgeCoverTier, EDGE_NEIGHBORS } from './terrain-silhouette';

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
 *  - A cut on a REAL cell goes through its whole pillar, so what shows is NEIGHBOUR mass. A cut MOUNTAIN
 *    corner reveals the highest EDGE-adjacent same-type mass below its top (a plateau step → that step's
 *    tier; a lone pillar → nothing → ground, unless it is an islet, which shows the water it sits in).
 *    A cut WATER corner is FILLED by the mountain at the corner (the render half of the reveal rule: a cut
 *    corner shows the surface actually behind it) — the bank AT the waterline, or, where mountain flanks
 *    BOTH edges of the corner (`cornerEdgeCoverTier`), the corner that mountain turns over this cell.
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
    // A Γ patch is a COSMETIC fillet — it backs only the REAL support it sits on (`patchBase`), so a cut
    // never paints a base that was not there: a from-empty gamma (patchBase 0) shows NO base at all and
    // the notch it fillets stays open, while a gamma rounding a genuinely real lower block backs that
    // full block under every quadrant. Patches saved before `patchBase` existed default to elevation-1.
    const support = terrain.patchBase ?? (renderElevation - 1);
    if (support >= 1) {
      const base: CutBacking = { type: terrain.type, elevation: support };
      return [base, base, base, base];
    }
    return out;
  }

  // A GROUND-islet cut (a cell of type None carrying corners — ground is a cuttable surface, the inverse
  // of a water pond). The kept shape draws grass; behind the rounded-away part shows the WATER
  // the islet sits in — the EDGE-adjacent water at that corner.
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
    } else if (isWater) {
      // The case the waterline rule cannot answer: mountain FLANKING BOTH EDGES of this corner meets itself
      // here, so the rounded-away quadrant opens onto that mountain — not onto the ground buried under it.
      // Water at layer 0 can never have a bank AT its own layer (mass starts at layer 1), so without this
      // every mountain/water junction shows a wedge of ground: down the steps of a Γ notch, and at the
      // point where two diagonally-attached shores meet. Both are one figure and get one answer, at the
      // LOWER of the two flanking tiers — the tier at which the shores actually meet.
      // ONE mountain edge is a river running ALONG a cliff, not a corner it turns: that keeps its ground bank.
      const flank = cornerEdgeCoverTier(neighborAt, i, TerrainType.Mountain);
      if (flank > renderElevation) out[i] = { type: TerrainType.Mountain, elevation: flank };
    } else {
      // A cut MOUNTAIN corner with no lower mountain step behind it — a mountain ISLET poking into water —
      // reveals the water it sits in (the same generic rule as a cut ground islet, and symmetric to cut
      // water revealing its mountain rim above). EDGE-adjacent only. (A mountain that merely BANKS water on
      // one edge is not cuttable here — trim-lock locks that corner — so this only fires for islet tips.)
      for (const [dx, dy] of EDGE_NEIGHBORS[i] ?? []) {
        const n = neighborAt(dx, dy);
        if (n && n.type === TerrainType.Water) { out[i] = { type: TerrainType.Water, elevation: n.elevation }; break; }
      }
    }
  }
  return out;
}
