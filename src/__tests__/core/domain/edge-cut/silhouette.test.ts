import { describe, it, expect } from 'vitest';
import { cornerWrappedAt, highestNeighborTerrain, groundConvexCornerInWater } from '../../../../core/domain/edge-cut/silhouette';
import { makeState, setTerrain } from '../../../_support/map-state';
import { TerrainType } from '../../../../core/model/types';

const M = TerrainType.Mountain, W = TerrainType.Water;

describe('cornerWrappedAt — Γ notch of the layer-e silhouette', () => {
  it('an L of tier-2 wraps the notch corner at layer 2 (TL of the notch cell)', () => {
    const state = makeState(10, 10);
    setTerrain(state, 5, 5, M, 2); // diagonal
    setTerrain(state, 6, 5, M, 2); // above
    setTerrain(state, 5, 6, M, 2); // left
    expect(cornerWrappedAt(state, 6, 6, 0, { type: M, elevation: 2 })).toBe(true);
    expect(cornerWrappedAt(state, 6, 6, 3, { type: M, elevation: 2 })).toBe(false); // BR is open
  });

  it('a TALLER wrap still covers a lower layer — its stack reaches it', () => {
    const state = makeState(10, 10);
    setTerrain(state, 5, 5, M, 3);
    setTerrain(state, 6, 5, M, 2);
    setTerrain(state, 5, 6, M, 2);
    expect(cornerWrappedAt(state, 6, 6, 0, { type: M, elevation: 2 }), 'tier-3 diagonal is solid at layer 2').toBe(true);
    expect(cornerWrappedAt(state, 6, 6, 0, { type: M, elevation: 3 }), 'but the layer-3 silhouette does not wrap').toBe(false);
  });

  it('a LOWER same-type diagonal does NOT enclose — a base under a diagonal pinch leaves it open', () => {
    // Edges of (6,5).BL are W(5,5) + S(6,6); the diagonal is SW(5,6). This is the diagonal-pinch-on-a-base
    // case: two tier-2 blocks meet at the point, the cell between them is a tier-1 base. The base does not
    // reach the wrapping tier, so the corner is still open (filling it would bridge the pinch) — exactly as
    // when the cell between is empty ground. This is what makes edge-cutting elevation-independent.
    const state = makeState(10, 10);
    setTerrain(state, 5, 5, M, 2);
    setTerrain(state, 6, 6, M, 2);
    setTerrain(state, 5, 6, M, 1); // lower base on the diagonal
    expect(cornerWrappedAt(state, 6, 5, 2, { type: M, elevation: 2 }), 'lower base diagonal: open, not enclosed').toBe(false);
    setTerrain(state, 5, 6, M, 2); // raise it to the wrapping tier → now a real enclosed notch
    expect(cornerWrappedAt(state, 6, 5, 2, { type: M, elevation: 2 }), 'same-tier diagonal: enclosed').toBe(true);
    setTerrain(state, 5, 6, W, 0); // a water pond on the diagonal also encloses (a Γ fillet over water is safe)
    expect(cornerWrappedAt(state, 6, 5, 2, { type: M, elevation: 2 }), 'water diagonal: enclosed').toBe(true);
  });
});

describe('groundConvexCornerInWater — a ground islet corner poking into water (option A)', () => {
  it('true when the corner is fully WRAPPED by water (both edges AND the diagonal)', () => {
    const state = makeState(10, 10);
    for (const [dx, dy] of [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]] as const) setTerrain(state, 5 + dx, 5 + dy, W, 0);
    // (5,5) is a ground islet; its BR corner (idx 3) has E + S + SE all water → a convex corner into water
    expect(groundConvexCornerInWater(state, 5, 5, 3)).toBe(true);
  });

  it('false when the surrounding water is ELEVATED — a ground islet only ever borders water@0', () => {
    const state = makeState(10, 10);
    // water@1 ring around a ground@0 islet is illegal terrain (uncapped/waterfall-onto-a-pit); don't offer
    // the cut there (it would only be silently reverted post-stroke).
    for (const [dx, dy] of [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]] as const) setTerrain(state, 5 + dx, 5 + dy, W, 1);
    expect(groundConvexCornerInWater(state, 5, 5, 3)).toBe(false);
  });

  it('false for the GAP between two diagonal water cells — the diagonal is ground, not a real islet', () => {
    const state = makeState(10, 10);
    setTerrain(state, 5, 5, W, 0);
    setTerrain(state, 6, 6, W, 0);
    // gap cell (6,5) BL(2): edges W(5,5)=water + S(6,6)=water, but the diagonal SW(5,6) is ground → not wrapped
    expect(groundConvexCornerInWater(state, 6, 5, 2)).toBe(false);
  });

  it('false at a seam between two ground islet cells (one edge is ground, not water)', () => {
    const state = makeState(10, 10);
    // a 2-wide ground islet (5,5)+(6,5), water all around
    for (const [x, y] of [[4, 5], [7, 5], [5, 4], [6, 4], [5, 6], [6, 6]] as const) setTerrain(state, x, y, W, 0);
    // (5,5) BR(3): E(6,5)=the other islet cell (ground), S(5,6)=water → not both water → not a free corner
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
