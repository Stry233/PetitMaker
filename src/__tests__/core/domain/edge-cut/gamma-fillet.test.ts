/**
 * Where a Γ fillet may go: it rounds the concave corner of the mass around it and adds no mass, so it
 * needs a notch open on at least one side (a closed pit would read as terrain, hold no support and
 * refuse the paint that fills it) and a floor below its tier to rest on.
 */
import { describe, it, expect } from 'vitest';
import { enclosedGap } from '../../../../core/domain/edge-cut/silhouette';
import { isInnerCorner } from '../../../../core/domain/edge-cut/cut-validator';
import { TerrainType, type GridState, type MacroCoord } from '../../../../core/model/types';
import { makeState, setTerrain, makeExecutor } from '../../../_support/map-state';
import { EdgeCutTool } from '../../../../tools/pointer/edge-cut/edge-cut-tool';
import { makeToolCtx } from '../../../_support/tool-ctx';
import { cell, point } from '../../../_support/grid';

/** A plateau at `tier` covering the 5x5 around (10,10), with holes where told. */
function plateau(tier: number, holes: MacroCoord[] = [], fill?: (s: GridState) => void): GridState {
  const state = makeState(24, 24);
  const hole = new Set(holes.map((h) => `${h.x},${h.y}`));
  for (let y = 8; y <= 12; y++) {
    for (let x = 8; x <= 12; x++) {
      if (hole.has(`${x},${y}`)) continue;
      setTerrain(state, x, y, TerrainType.Mountain, tier);
    }
  }
  fill?.(state);
  return state;
}

describe('enclosedGap', () => {
  it('is true for a bare cell the mass surrounds on all four edges', () => {
    const state = plateau(3, [{ x: 10, y: 10 }]);
    expect(enclosedGap(state, 10, 10)).toBe(true);
  });

  it('and for a pit in a SLOPE, where the surrounding heights differ', () => {
    // Neighbours at 1, 2, 2 and 1 share no tier, but the cell is still a hole in the surface.
    const state = makeState(24, 24);
    setTerrain(state, 9, 10, TerrainType.Mountain, 1);
    setTerrain(state, 11, 10, TerrainType.Mountain, 2);
    setTerrain(state, 10, 9, TerrainType.Mountain, 2);
    setTerrain(state, 10, 11, TerrainType.Mountain, 1);
    expect(enclosedGap(state, 10, 10)).toBe(true);
  });

  it('but not for an islet ringed by ground-level water, which stands at the ground\'s own height', () => {
    const state = makeState(24, 24);
    for (const [x, y] of [[9, 10], [11, 10], [10, 9], [10, 11]] as [number, number][]) {
      setTerrain(state, x, y, TerrainType.Water, 0);
    }
    expect(enclosedGap(state, 10, 10)).toBe(false);
  });

  it('is false for a notch — the ground walks out of it', () => {
    // Open to the east.
    const state = plateau(3, [{ x: 10, y: 10 }, { x: 11, y: 10 }]);
    expect(enclosedGap(state, 10, 10)).toBe(false);
  });

  it('is false where a real block sits in the hole — its rim is exactly what a fillet rounds', () => {
    const state = plateau(3, [{ x: 10, y: 10 }], (s) => setTerrain(s, 10, 10, TerrainType.Mountain, 2));
    expect(enclosedGap(state, 10, 10)).toBe(false);
  });

  it('and false for a pond in the hole, which renders its own surface', () => {
    const state = plateau(3, [{ x: 10, y: 10 }], (s) => setTerrain(s, 10, 10, TerrainType.Water, 0));
    expect(enclosedGap(state, 10, 10)).toBe(false);
  });

  it('is false when the mass only reaches three sides', () => {
    const state = plateau(3, [{ x: 10, y: 10 }, { x: 10, y: 11 }]);
    expect(enclosedGap(state, 10, 10)).toBe(false);
  });
});

describe('the Γ corner test', () => {
  it('offers no fillet on a hole the mass has closed round', () => {
    const state = plateau(3, [{ x: 10, y: 10 }]);
    for (let i = 0; i < 4; i++) {
      expect(isInnerCorner(state, 10, 10, i, { type: TerrainType.Mountain, elevation: 3 }), `corner ${i}`).toBe(false);
    }
  });

  it('still offers one on a notch the fillet can rest in', () => {
    const state = plateau(1, [{ x: 10, y: 10 }, { x: 11, y: 10 }]);
    const offered = [0, 1, 2, 3].filter((i) => isInnerCorner(state, 10, 10, i, { type: TerrainType.Mountain, elevation: 1 }));
    expect(offered.length).toBeGreaterThan(0);
  });

  it('a tall notch rounds as one grounded column, and never below or at its own floor', () => {
    // A tier-3 mass around a ground-floored notch: the fillet renders as a column walled down to the
    // floor.
    const state = plateau(3, [{ x: 10, y: 10 }, { x: 11, y: 10 }]);
    const offeredTall = [0, 1, 2, 3].filter((i) => isInnerCorner(state, 10, 10, i, { type: TerrainType.Mountain, elevation: 3 }));
    expect(offeredTall.length).toBeGreaterThan(0);
    // Floored at 2, the wall tier still rounds; a fillet at the floor's own tier would add nothing.
    setTerrain(state, 10, 10, TerrainType.Mountain, 2);
    const offered = [0, 1, 2, 3].filter((i) => isInnerCorner(state, 10, 10, i, { type: TerrainType.Mountain, elevation: 3 }));
    expect(offered.length).toBeGreaterThan(0);
    for (let i = 0; i < 4; i++) expect(isInnerCorner(state, 10, 10, i, { type: TerrainType.Mountain, elevation: 2 })).toBe(false);
  });
});

describe('the edge-cut tool on a pit', () => {
  it('leaves it alone, wherever in the cell you click', () => {
    // A bare cell in a slope, terrain at 1, 2, 2 and 1 around it: a fillet here would hang a tier-2
    // scrap over bare ground.
    const state = makeState(24, 24);
    setTerrain(state, 9, 10, TerrainType.Mountain, 1);
    setTerrain(state, 11, 10, TerrainType.Mountain, 2);
    setTerrain(state, 10, 9, TerrainType.Mountain, 2);
    setTerrain(state, 10, 11, TerrainType.Mountain, 1);
    setTerrain(state, 11, 9, TerrainType.Mountain, 2);
    const executor = makeExecutor(state);
    const ctx = makeToolCtx(state, executor, 1, 1);
    const tool = new EdgeCutTool();
    tool.onActivate(ctx);
    // A click governs the four corners around an intersection, so these four reach every corner of
    // cell (10,10).
    for (const [ix, iy] of [[9, 9], [10, 9], [9, 10], [10, 10]] as [number, number][]) {
      tool.onPointerDown(cell({ x: ix, y: iy }), point({ x: ix, y: iy }), ctx);
      expect(state.cells[10]![10]!.terrain, `click at intersection ${ix},${iy}`).toBeNull();
    }
  });

  it('still fillets the notch beside it, which is open on two sides', () => {
    const state = makeState(24, 24);
    setTerrain(state, 9, 10, TerrainType.Mountain, 1);
    setTerrain(state, 10, 9, TerrainType.Mountain, 1);
    setTerrain(state, 9, 9, TerrainType.Mountain, 1);
    const executor = makeExecutor(state);
    const ctx = makeToolCtx(state, executor, 1, 1);
    const tool = new EdgeCutTool();
    tool.onActivate(ctx);
    // Intersection (9,9) is the cell's top-left corner, the one the mass wraps.
    tool.onPointerDown(cell({ x: 9, y: 9 }), point({ x: 9, y: 9 }), ctx);
    expect(state.cells[10]![10]!.terrain?.patchOnly, 'the Γ corner still rounds').toBe(true);
  });
});
