import { describe, it, expect } from 'vitest';
import { cornerRevealTier, cornerEdgeCoverTier } from '../../../../view/shared/terrain/cut-backing';
import { cornerWrappedAt } from '../../../../core/domain/edge-cut/silhouette';
import { makeState, setTerrain } from '../../../_support/map-state';
import { TerrainType } from '../../../../core/model/types';
import type { TerrainCell } from '../../../../core/model/types';

const M = TerrainType.Mountain, W = TerrainType.Water;
const cell = (type: TerrainType, elevation: number, patchOnly?: boolean): TerrainCell => ({ type, elevation, ...(patchOnly ? { patchOnly } : {}) });
/** neighborAt over a sparse offset map keyed "dx,dy", e.g. {'1,0': cell(M,2)}. */
const at = (m: Record<string, TerrainCell>) => (dx: number, dy: number) => m[`${dx},${dy}`];

describe('cornerRevealTier — EDGE-only, layer-gated (what shows behind a cut)', () => {
  // corner indices: 0=TL, 1=TR, 2=BL, 3=BR. Edge offsets for BR(3) are E(1,0)+S(0,1); diagonal is SE(1,1).
  it('mountain reveals the highest EDGE-adjacent lower step that covers the corner', () => {
    // cut TL(0): edges W(-1,0)=mtn@1, N(0,-1)=mtn@2 → the higher step (2) shows behind the bevel
    expect(cornerRevealTier(at({ '-1,0': cell(M, 1), '0,-1': cell(M, 2) }), 0, M, 3)).toBe(2);
  });

  it('a step touching ONLY at the diagonal does NOT back the cut (no point-contact leak)', () => {
    // cut BR(3): only the SE diagonal holds a lower step → reveal 0 (it touches at a point, can't fill a quadrant)
    expect(cornerRevealTier(at({ '1,1': cell(M, 1) }), 3, M, 2)).toBe(0);
  });

  it('cut WATER at layer 0 reveals GROUND (null) — an edge mountain that does not reach layer 0 is not its bank', () => {
    // a river@0 with an L2 cliff on its edge: the cliff is solid only at layers 1..2, not at the water's layer 0
    expect(cornerRevealTier(at({ '-1,0': cell(M, 2) }), 0, W, 0)).toBe(0);
  });

  it('cut WATER ignores a DIAGONAL mountain entirely (disconnected — bank is ground)', () => {
    expect(cornerRevealTier(at({ '-1,-1': cell(M, 2) }), 0, W, 0)).toBe(0);
  });

  it('elevated pool water@e is backed by its EDGE mountain rim solid at layer e', () => {
    // a pool@2 with a mountain rim@2 on its edge → the rim is solid at layer 2 → it backs the rounded water
    expect(cornerRevealTier(at({ '-1,0': cell(M, 2) }), 0, W, 2)).toBe(2);
  });

  it('water lapping a TALLER edge wall reveals the wall AT THE WATERLINE (the bank, not the cliff top)', () => {
    // a pool@2 against a taller cliff@4: the cliff banks the pool at the pool's
    // Own layer — its higher mass rises behind the corner, it is not what the
    // rounded water opens onto — so the reveal is tier 2, never the cliff's 4.
    expect(cornerRevealTier(at({ '0,-1': cell(M, 4) }), 0, W, 2)).toBe(2);
  });
});

describe('cornerEdgeCoverTier — the tier two flanking masses MEET at, judged by offset', () => {
  // corner indices: 0=TL, 1=TR, 2=BL, 3=BR. TL(0) edges are W(-1,0)+N(0,-1); its diagonal is NW(-1,-1).
  it('mass on both edges → the tier they meet at', () => {
    expect(cornerEdgeCoverTier(at({ '-1,0': cell(M, 1), '0,-1': cell(M, 1) }), 0, M)).toBe(1);
  });

  it('the tier is the LOWER of the two edges, not the taller one', () => {
    expect(cornerEdgeCoverTier(at({ '-1,0': cell(M, 4), '0,-1': cell(M, 2) }), 0, M)).toBe(2);
  });

  it('DIAGONAL-BLIND: an open diagonal (a pinch) does not change the answer', () => {
    // The pinch governs whether a Γ fillet may add mass at the corner, which `cornerWrappedAt` decides and
    // still refuses. This asks only where the two flanking masses meet, so the diagonal has no say.
    const open = at({ '-1,0': cell(M, 2), '0,-1': cell(M, 2) });
    expect(cornerEdgeCoverTier(open, 0, M)).toBe(2);
    const pinch = makeState(4, 4);
    setTerrain(pinch, 0, 1, M, 2);
    setTerrain(pinch, 1, 0, M, 2);
    expect(cornerWrappedAt(pinch, 1, 1, 0, { type: M, elevation: 2 }), 'the fillet question still answers pinch').toBe(false);
    expect(cornerEdgeCoverTier(at({ '-1,0': cell(M, 2), '0,-1': cell(M, 2), '-1,-1': cell(M, 2) }), 0, M)).toBe(2);
    expect(cornerEdgeCoverTier(at({ '-1,0': cell(M, 2), '0,-1': cell(M, 2), '-1,-1': cell(W, 0) }), 0, M)).toBe(2);
  });

  it('one bare edge → nothing meets here', () => {
    expect(cornerEdgeCoverTier(at({ '0,-1': cell(M, 2), '-1,-1': cell(M, 2) }), 0, M)).toBe(0);
  });

  it('reads the OTHER type as absent (a water edge holds no mountain)', () => {
    expect(cornerEdgeCoverTier(at({ '-1,0': cell(M, 2), '0,-1': cell(W, 0) }), 0, M)).toBe(0);
  });
});
