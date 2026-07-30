import { describe, it, expect } from 'vitest';
import { terrainSolidAt, cornerWrappedAt, cornerRevealTier, highestNeighborTerrain, groundConvexCornerInWater } from '../../core/edge-cut/terrain-silhouette';
import { makeState, setTerrain } from '../rules/_helpers';
import { TerrainType } from '../../core/model/types';
import type { TerrainCell } from '../../core/model/types';

const M = TerrainType.Mountain, W = TerrainType.Water;
const cell = (type: TerrainType, elevation: number, patchOnly?: boolean): TerrainCell => ({ type, elevation, ...(patchOnly ? { patchOnly } : {}) });
/** neighborAt over a sparse offset map keyed "dx,dy", e.g. {'1,0': cell(M,2)}. */
const at = (m: Record<string, TerrainCell>) => (dx: number, dy: number) => m[`${dx},${dy}`];

describe('terrainSolidAt — a cell at elevation N is a stack of layers', () => {
  it('mountain at N fills layers 1..N (not 0, not N+1)', () => {
    expect(terrainSolidAt(cell(M, 3), M, 1)).toBe(true);
    expect(terrainSolidAt(cell(M, 3), M, 3)).toBe(true);
    expect(terrainSolidAt(cell(M, 3), M, 0)).toBe(false);
    expect(terrainSolidAt(cell(M, 3), M, 4)).toBe(false);
  });

  it('water at N fills 0..N (a lake sits at ground level; a waterfall is a column)', () => {
    expect(terrainSolidAt(cell(W, 0), W, 0)).toBe(true);
    expect(terrainSolidAt(cell(W, 2), W, 0)).toBe(true);
    expect(terrainSolidAt(cell(W, 2), W, 2)).toBe(true);
    expect(terrainSolidAt(cell(W, 2), W, 3)).toBe(false);
  });

  it('type-filtered: mountain mass is not water mass', () => {
    expect(terrainSolidAt(cell(M, 3), W, 1)).toBe(false);
  });

  it('a Γ patch is a fillet ON a base: solid up to N-1, nothing at its fillet tier', () => {
    expect(terrainSolidAt(cell(M, 3, true), M, 1)).toBe(true);
    expect(terrainSolidAt(cell(M, 3, true), M, 2)).toBe(true);
    expect(terrainSolidAt(cell(M, 3, true), M, 3), 'the fillet tier itself is not mass').toBe(false);
    expect(terrainSolidAt(cell(M, 1, true), M, 1), 'a tier-1 fillet has no base').toBe(false);
  });

  it('null/None is never solid', () => {
    expect(terrainSolidAt(null, M, 1)).toBe(false);
    expect(terrainSolidAt(cell(TerrainType.None, 0), M, 1)).toBe(false);
  });
});

describe('cornerWrappedAt — Γ notch of the layer-e silhouette', () => {
  it('an L of tier-2 wraps the notch corner at layer 2 (TL of the notch cell)', () => {
    const state = makeState(10, 10);
    setTerrain(state, 5, 5, M, 2); // diagonal
    setTerrain(state, 6, 5, M, 2); // above
    setTerrain(state, 5, 6, M, 2); // left
    expect(cornerWrappedAt(state, 6, 6, 0, M, 2)).toBe(true);
    expect(cornerWrappedAt(state, 6, 6, 3, M, 2)).toBe(false); // BR is open
  });

  it('a TALLER wrap still covers a lower layer — its stack reaches it', () => {
    const state = makeState(10, 10);
    setTerrain(state, 5, 5, M, 3);
    setTerrain(state, 6, 5, M, 2);
    setTerrain(state, 5, 6, M, 2);
    expect(cornerWrappedAt(state, 6, 6, 0, M, 2), 'tier-3 diagonal is solid at layer 2').toBe(true);
    expect(cornerWrappedAt(state, 6, 6, 0, M, 3), 'but the layer-3 silhouette does not wrap').toBe(false);
  });

  it('a LOWER same-type diagonal does NOT enclose — a base under a diagonal pinch leaves it open', () => {
    // Edges of (6,5).BL are W(5,5) + S(6,6); the diagonal is SW(5,6). This is the diagonal-pinch-on-a-base
    // case: two tier-2 blocks meet at the point, the cell between them is a tier-1 base. The base does NOT
    // reach the wrapping tier, so the corner is still OPEN (filling it would bridge the pinch) — exactly as
    // when the cell between is empty ground. This is what makes edge-cutting elevation-independent.
    const state = makeState(10, 10);
    setTerrain(state, 5, 5, M, 2);
    setTerrain(state, 6, 6, M, 2);
    setTerrain(state, 5, 6, M, 1); // lower base on the diagonal
    expect(cornerWrappedAt(state, 6, 5, 2, M, 2), 'lower base diagonal: open, not enclosed').toBe(false);
    setTerrain(state, 5, 6, M, 2); // raise it to the wrapping tier → now a real enclosed notch
    expect(cornerWrappedAt(state, 6, 5, 2, M, 2), 'same-tier diagonal: enclosed').toBe(true);
    setTerrain(state, 5, 6, W, 0); // a water pond on the diagonal also encloses (a Γ fillet over water is safe)
    expect(cornerWrappedAt(state, 6, 5, 2, M, 2), 'water diagonal: enclosed').toBe(true);
  });
});

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
    // a river@0 with an L2 cliff on its EDGE: the cliff is solid only at layers 1..2, NOT at the water's layer 0
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
    // OWN layer — its higher mass rises behind the corner, it is not what the
    // rounded water opens onto — so the reveal is tier 2, never the cliff's 4.
    expect(cornerRevealTier(at({ '0,-1': cell(M, 4) }), 0, W, 2)).toBe(2);
  });
});

describe('groundConvexCornerInWater — a ground island corner poking into water (option A)', () => {
  it('true when the corner is fully WRAPPED by water (both edges AND the diagonal)', () => {
    const state = makeState(10, 10);
    for (const [dx, dy] of [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]] as const) setTerrain(state, 5 + dx, 5 + dy, W, 0);
    // (5,5) is a ground island; its BR corner (idx 3) has E + S + SE all water → a convex corner into water
    expect(groundConvexCornerInWater(state, 5, 5, 3)).toBe(true);
  });

  it('false when the surrounding water is ELEVATED — a ground island only ever borders water@0', () => {
    const state = makeState(10, 10);
    // water@1 ring around a ground@0 island is illegal terrain (uncapped/waterfall-onto-a-pit); don't offer
    // the cut there (it would only be silently reverted post-stroke).
    for (const [dx, dy] of [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]] as const) setTerrain(state, 5 + dx, 5 + dy, W, 1);
    expect(groundConvexCornerInWater(state, 5, 5, 3)).toBe(false);
  });

  it('false for the GAP between two diagonal water cells — the diagonal is ground, not a real island', () => {
    const state = makeState(10, 10);
    setTerrain(state, 5, 5, W, 0);
    setTerrain(state, 6, 6, W, 0);
    // gap cell (6,5) BL(2): edges W(5,5)=water + S(6,6)=water, but the diagonal SW(5,6) is ground → not wrapped
    expect(groundConvexCornerInWater(state, 6, 5, 2)).toBe(false);
  });

  it('false at a seam between two ground island cells (one edge is ground, not water)', () => {
    const state = makeState(10, 10);
    // a 2-wide ground island (5,5)+(6,5), water all around
    for (const [x, y] of [[4, 5], [7, 5], [5, 4], [6, 4], [5, 6], [6, 6]] as const) setTerrain(state, x, y, W, 0);
    // (5,5) BR(3): E(6,5)=the other island cell (ground), S(5,6)=water → not both water → not a free corner
    expect(groundConvexCornerInWater(state, 5, 5, 3)).toBe(false);
  });

  it('false on a real mountain/water cell — only ground rounds this way', () => {
    const state = makeState(10, 10);
    setTerrain(state, 5, 5, M, 1);
    setTerrain(state, 6, 5, W, 0);
    setTerrain(state, 5, 6, W, 0);
    expect(groundConvexCornerInWater(state, 5, 5, 3)).toBe(false);
  });
});

describe('highestNeighborTerrain', () => {
  it('returns the tallest orthogonal real terrain, ignoring patches', () => {
    const state = makeState(10, 10);
    setTerrain(state, 4, 5, M, 1);
    setTerrain(state, 6, 5, M, 3);
    setTerrain(state, 5, 4, M, 5);
    state.cells[4]![5]!.terrain!.patchOnly = true; // the tier-5 is a patch → ignored
    expect(highestNeighborTerrain(state, 5, 5)).toEqual({ type: M, elevation: 3 });
  });

  it('null when nothing real is adjacent', () => {
    expect(highestNeighborTerrain(makeState(10, 10), 5, 5)).toBeNull();
  });
});
