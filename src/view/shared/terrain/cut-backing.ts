import { TerrainType } from '../../../core/model/types';
import type { TerrainCell } from '../../../core/model/types';
import { CORNERS } from '../../../core/model/corners';
import { solidTopOf, terrainSolidAt } from '../../../core/domain/terrain/terrain-surface';

export interface CutBacking {
  type: TerrainType;
  elevation: number;
}

/**
 * Decide, per corner, what fills behind a trimmed corner so a cut never falls through to bare ground.
 * Returns one full-quadrant backing per corner (TL/TR/BL/BR), or null where nothing backs it.
 *
 * Two distinct sources, mirroring the kernel's terrainSolidAt:
 *  - A Γ (gamma) patch is a fillet at tier N sitting on its own solid base (mass 1..N-1 across the whole
 *    cell) → the base renders as a full block: every quadrant backs with tier N-1, not just the fillet's.
 *    (A tier-1 fillet has no base — it sits straight on the ground.)
 *  - A cut on a real cell goes through its whole pillar, so what shows is neighbour mass. A cut mountain
 *    corner reveals the highest EDGE-adjacent same-type mass below its top (a plateau step → that step's
 *    tier; a lone pillar → nothing → ground, unless it is an islet, which shows the water it sits in).
 *    A cut water corner is filled by the mountain at the corner (the render half of the reveal rule: a cut
 *    corner shows the surface actually behind it) — where mountain flanks both edges of the corner above
 *    the water (`cornerEdgeCoverTier`), the corner that mountain turns over this cell, else the bank at
 *    the waterline.
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
    // A Γ patch is a cosmetic fillet — it backs only the real support it sits on (`patchBase`), so a cut
    // never paints a base that was not there: a from-empty gamma (patchBase 0) shows no base at all and
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
  // of a water pond). The kept shape draws grass; behind the rounded-away part shows the water
  // the islet sits in — the EDGE-adjacent water at that corner.
  if (terrain.type === TerrainType.None) {
    for (let i = 0; i < 4; i++) {
      const c = corners[i];
      if (c === 'square' || c === 'empty') continue;
      for (const [dx, dy] of CORNERS[i]?.edges ?? []) {
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
    // Mountain flanking both edges of a cut water corner above the water meets itself here, so the
    // rounded-away quadrant opens onto that mountain at the lower of the two flanking tiers, the tier at
    // which the shores actually meet: not onto the ground under a river, nor onto the waterline bank of
    // an elevated pool, either of which leaves a step down the notch of a Γ wall and at the point where
    // two diagonally-attached shores meet. One mountain edge is a shore running along a cliff, not a
    // corner it turns: that keeps the waterline answer below.
    const flank = isWater ? cornerEdgeCoverTier(neighborAt, i, TerrainType.Mountain) : 0;
    const reveal = cornerRevealTier(neighborAt, i, terrain.type, renderElevation);
    if (flank > renderElevation) {
      out[i] = { type: TerrainType.Mountain, elevation: flank };
    } else if (reveal >= 1) {
      out[i] = { type: isWater ? TerrainType.Mountain : terrain.type, elevation: reveal };
    } else if (!isWater) {
      // A cut mountain corner with no lower mountain step behind it — a mountain islet poking into water —
      // reveals the water it sits in (the same generic rule as a cut ground islet, and symmetric to cut
      // water revealing its mountain rim above). EDGE-adjacent only. (A mountain that merely banks water on
      // one edge is not cuttable here — trim-lock locks that corner — so this only fires for islet tips.)
      for (const [dx, dy] of CORNERS[i]?.edges ?? []) {
        const n = neighborAt(dx, dy);
        if (n && n.type === TerrainType.Water) { out[i] = { type: TerrainType.Water, elevation: n.elevation }; break; }
      }
    }
  }
  return out;
}

/** The highest tier at which `type` mass stands on both edges of corner `i` — the tier at which the two
 *  flanking masses meet here. 0 when either edge is bare of it. Mass fills every layer up to its top, so
 *  the answer is just the lower of the two tops.
 *
 *  Diagonal-blind, unlike `cornerWrappedBy`, and that is the whole distinction between the two: the
 *  diagonal governs whether mass may be added at a corner (a Γ fillet over an open diagonal would bridge
 *  two blocks that touch only at a point, and you could then walk between them), which is a question about
 *  a fillet. A corner already cut asks a different one — what shows behind it — and answering it adds
 *  nothing, so the pinch has no say. */
export function cornerEdgeCoverTier(
  neighborAt: (dx: number, dy: number) => TerrainCell | null | undefined,
  i: number, type: TerrainType,
): number {
  const c = CORNERS[i];
  if (!c) return 0;
  const [a, b] = c.edges;
  return Math.min(solidTopOf(neighborAt(a[0], a[1]), type), solidTopOf(neighborAt(b[0], b[1]), type));
}

/** The tier a cut at corner `i` of a `type` cell topped at `top` would reveal: the highest mass that still
 *  meets the corner behind the cut. Judged from the two edge neighbours only — a diagonal cell touches the
 *  corner at a point and can't fill the revealed quadrant (an edge-blind scan leaks a point-contact step or
 *  a disconnected hill into the cut).
 *   - mountain: the highest EDGE-adjacent same-type step strictly below `top` (a plateau step → that tier;
 *     a lone wall → nothing → ground).
 *   - water at layer `top`: an edge mountain that is solid at the water's own layer backs the rounded water
 *     (an elevated pool's rim at the same level, or a wall the water laps). A mountain that doesn't reach
 *     the water's layer (e.g. an L2 cliff beside an L0 river) is not its bank — the cut reveals ground.
 *  0 = nothing meets it; the cut falls through to bare ground (the BaseLayer zone shows — a shore/bank). */
export function cornerRevealTier(
  neighborAt: (dx: number, dy: number) => TerrainCell | null | undefined,
  i: number, type: TerrainType, top: number,
): number {
  let best = 0;
  for (const [dx, dy] of CORNERS[i]?.edges ?? []) {
    const n = neighborAt(dx, dy);
    if (type === TerrainType.Water) {
      // The reveal is the wall at the waterline — the bank. A taller cliff
      // still banks the pool at the pool's own layer (its higher mass rises
      // Behind the corner, it isn't what the rounded water opens onto), so the
      // 2D fill takes the bank layer's color and the 3D backing column stays
      // at pool height. Taller mountain on both edges turns its corner over the
      // cell instead, which `cutBackingByCorner` answers first.
      if (terrainSolidAt(n, TerrainType.Mountain, top) && top > best) best = top;
    } else {
      const own = solidTopOf(n, type);
      if (own < top && own > best) best = own;
    }
  }
  return best;
}
