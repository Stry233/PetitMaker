import { describe, it, expect } from 'vitest';
import { computeLockedCorners } from '../../core/edge-cut/trim-lock';
import { TerrainType } from '../../core/model/types';
import { makeState, setTerrain } from '../rules/_helpers';

describe('computeLockedCorners — terrain', () => {
  it('isolated mountain: all 4 corners free', () => {
    const state = makeState(10, 10);
    setTerrain(state, 5, 5, TerrainType.Mountain, 1);
    const locked = computeLockedCorners(state, 5, 5, 'terrain');
    expect(locked).toEqual([false, false, false, false]);
  });

  it('mountain with right neighbor: TR and BR locked (Rule A)', () => {
    const state = makeState(10, 10);
    setTerrain(state, 5, 5, TerrainType.Mountain, 1);
    setTerrain(state, 6, 5, TerrainType.Mountain, 1);
    const locked = computeLockedCorners(state, 5, 5, 'terrain');
    expect(locked).toEqual([false, true, false, true]);
  });

  it('mountain with left neighbor: TL and BL locked', () => {
    const state = makeState(10, 10);
    setTerrain(state, 5, 5, TerrainType.Mountain, 1);
    setTerrain(state, 4, 5, TerrainType.Mountain, 1);
    const locked = computeLockedCorners(state, 5, 5, 'terrain');
    expect(locked).toEqual([true, false, true, false]);
  });

  it('mountain with top neighbor: TL and TR locked', () => {
    const state = makeState(10, 10);
    setTerrain(state, 5, 5, TerrainType.Mountain, 1);
    setTerrain(state, 5, 4, TerrainType.Mountain, 1);
    const locked = computeLockedCorners(state, 5, 5, 'terrain');
    expect(locked).toEqual([true, true, false, false]);
  });

  it('mountain with bottom neighbor: BL and BR locked', () => {
    const state = makeState(10, 10);
    setTerrain(state, 5, 5, TerrainType.Mountain, 1);
    setTerrain(state, 5, 6, TerrainType.Mountain, 1);
    const locked = computeLockedCorners(state, 5, 5, 'terrain');
    expect(locked).toEqual([false, false, true, true]);
  });

  it('middle of 3-in-a-row: all 4 locked', () => {
    const state = makeState(10, 10);
    setTerrain(state, 4, 5, TerrainType.Mountain, 1);
    setTerrain(state, 5, 5, TerrainType.Mountain, 1);
    setTerrain(state, 6, 5, TerrainType.Mountain, 1);
    const locked = computeLockedCorners(state, 5, 5, 'terrain');
    expect(locked).toEqual([true, true, true, true]);
  });

  it('diagonal-only same-type neighbour does NOT pin — the pinch corner stays cuttable (Bug 2.1)', () => {
    const state = makeState(10, 10);
    setTerrain(state, 5, 5, TerrainType.Mountain, 1);
    setTerrain(state, 6, 6, TerrainType.Mountain, 1); // touches only at the BR point (a pinch, not a seam)
    const locked = computeLockedCorners(state, 5, 5, 'terrain');
    expect(locked).toEqual([false, false, false, false]); // BR is a free convex corner; a diagonal can't pin it
  });

  it('mountain+water diagonal pinch: BOTH free — no special case for mountain+water (a diagonal never pins)', () => {
    const state = makeState(10, 10);
    setTerrain(state, 5, 5, TerrainType.Mountain, 1);
    setTerrain(state, 6, 6, TerrainType.Water, 0); // touching only at the BR point (a pinch)
    // a diagonal never pins a convex corner — same as mountain+mountain / water+water. (The BANK lock is
    // EDGE-only, so it only fires when water shares an EDGE; here the shared point is a diagonal.)
    expect(computeLockedCorners(state, 5, 5, 'terrain')[3], 'mountain BR rounds toward the diagonal water').toBe(false);
    expect(computeLockedCorners(state, 6, 6, 'terrain')[0], 'water TL rounds toward the diagonal mountain').toBe(false);
  });

  it('a mountain SHORE banks the water on its edge — its water-facing corners are LOCKED (the bank stays)', () => {
    const state = makeState(10, 10);
    setTerrain(state, 5, 5, TerrainType.Mountain, 1);
    setTerrain(state, 6, 5, TerrainType.Water, 1); // water on the RIGHT edge → the mountain banks it there
    // cutting an E-facing corner would peel the mountain off the water (no river bank on the rendered map),
    // so the E-side corners stay square. The W (open-land) side corners still round.
    expect(computeLockedCorners(state, 5, 5, 'terrain')).toEqual([false, true, false, true]);
  });

  it('a mountain ISLAND (water on all sides) IS fully cuttable — every corner has water on BOTH edges', () => {
    const state = makeState(10, 10);
    setTerrain(state, 5, 5, TerrainType.Mountain, 1); // a rock in a lake
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) setTerrain(state, 5 + dx, 5 + dy, TerrainType.Water, 0);
    expect(computeLockedCorners(state, 5, 5, 'terrain')).toEqual([false, false, false, false]);
  });

  it('a mountain at a DIAGONAL water pinch (mountain CONTINUES on the diagonal) is a bank, not a tip — locked', () => {
    // (6,5).BL has water on its W(5,5) and S(6,6) edges, but those two water cells meet only at the diagonal
    // point and the mountain CONTINUES on the SW diagonal (5,6) — a diagonal water pinch around continuous
    // terrain (e.g. a base), NOT a rock in water. So the corner stays square, mirroring the m+m / m+w pinch:
    // all three combos behave identically at a pinch, on the ground or on a base.
    const s = makeState(10, 10);
    const Mt = TerrainType.Mountain, Wt = TerrainType.Water;
    setTerrain(s, 5, 5, Wt, 0); setTerrain(s, 6, 6, Wt, 0); // the two diagonal water cells (edges of (6,5).BL)
    setTerrain(s, 6, 5, Mt, 1);                             // the mountain at the pinch
    setTerrain(s, 5, 6, Mt, 1);                             // SW diagonal — the mountain continues → not a tip
    expect(computeLockedCorners(s, 6, 5, 'terrain')[2], 'pinch around continuous terrain → locked').toBe(true);
    setTerrain(s, 5, 6, Wt, 0);                             // remove the continuation → now fully in water
    expect(computeLockedCorners(s, 6, 5, 'terrain')[2], 'a genuine peninsula tip → free').toBe(false);
  });

  it("a mountain banking water beside a ground pocket keeps its bank (the user's water/mountain junction)", () => {
    // w*(2,2) water; m*(3,2)/m*(2,3) mountains bank it; ground pocket at (3,3). Each m* corner toward the
    // pocket has water on its OTHER edge → it is the water's bank → locked (cutting it unbanks the pond).
    const s = makeState(10, 10);
    const M = TerrainType.Mountain, W = TerrainType.Water;
    setTerrain(s, 2, 2, W, 0);
    setTerrain(s, 3, 2, M, 1); setTerrain(s, 4, 2, M, 1); setTerrain(s, 3, 1, M, 1);
    setTerrain(s, 2, 3, M, 1); setTerrain(s, 1, 3, M, 1); setTerrain(s, 2, 4, M, 1);
    expect(computeLockedCorners(s, 3, 2, 'terrain')[2], 'm*(3,2) BL (W=water, S=pocket) bank → locked').toBe(true);
    expect(computeLockedCorners(s, 2, 3, 'terrain')[1], 'm*(2,3) TR (N=water, E=pocket) bank → locked').toBe(true);
  });

  it('a same-type mountain seam still pins (a real run/2x2 interior corner stays square)', () => {
    const state = makeState(10, 10);
    setTerrain(state, 5, 5, TerrainType.Mountain, 1);
    setTerrain(state, 6, 5, TerrainType.Mountain, 1); // mountain on the RIGHT edge → seam pins TR+BR
    expect(computeLockedCorners(state, 5, 5, 'terrain')).toEqual([false, true, false, true]);
  });

  it('WATER toward a mountain: NOT pinned — the water rounds (the mountain backs the cut)', () => {
    const state = makeState(10, 10);
    setTerrain(state, 5, 5, TerrainType.Water, 0);    // ground-level lake
    setTerrain(state, 6, 5, TerrainType.Mountain, 2); // mountain on the right → water still free to cut
    expect(computeLockedCorners(state, 5, 5, 'terrain')).toEqual([false, false, false, false]);
  });

  it('ELEVATED water (waterfall): its open (drop) side stays square — we can\'t round the falling lip', () => {
    const state = makeState(10, 10);
    setTerrain(state, 5, 5, TerrainType.Water, 2); // waterfall, all neighbours empty → all sides pinned
    expect(computeLockedCorners(state, 5, 5, 'terrain')).toEqual([true, true, true, true]);
  });

  it('ELEVATED water pins its lip toward ANY lower edge neighbour — a drop onto lower terrain, not just void (Bug 4b)', () => {
    const state = makeState(10, 10);
    setTerrain(state, 5, 5, TerrainType.Water, 2);    // elevated water (a pool lip)
    setTerrain(state, 4, 5, TerrainType.Mountain, 2); // west rim (same level → not a drop)
    setTerrain(state, 6, 5, TerrainType.Mountain, 2); // east rim (same level)
    setTerrain(state, 5, 4, TerrainType.Mountain, 2); // north rim (same level)
    setTerrain(state, 5, 6, TerrainType.Mountain, 1); // SOUTH bank lowered → a real drop (cascade / peeled bank)
    // only the south (drop) corners pin; the same-level rim leaves the others free to round
    expect(computeLockedCorners(state, 5, 5, 'terrain')).toEqual([false, false, true, true]);
  });

  it('water around a ground island stays interior — the island cut lives on the GROUND cell, not the water (Bug 1)', () => {
    const state = makeState(12, 12);
    // ground island at (5,5) (null terrain) ringed by water@0 on all 8 neighbours
    for (const [dx, dy] of [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]] as const) {
      setTerrain(state, 5 + dx, 5 + dy, TerrainType.Water, 0);
    }
    // the SE water cell (6,6): its island-facing TL corner is pinned (interior water) — we round the ground
    // island cell itself (option A), never the surrounding water.
    expect(computeLockedCorners(state, 6, 6, 'terrain')[0], 'water toward the island stays square').toBe(true);
  });

  it('same-type LOWER neighbor (a step) is NOT pinned — the bevel down to it is intended', () => {
    const state = makeState(10, 10);
    setTerrain(state, 5, 5, TerrainType.Mountain, 2);
    setTerrain(state, 6, 5, TerrainType.Mountain, 1); // lower step on the right → corners stay cuttable
    expect(computeLockedCorners(state, 5, 5, 'terrain')).toEqual([false, false, false, false]);
  });

  it('a TALLER same-type neighbour PINS — its stack covers this cell at this layer, so the corner is not convex here', () => {
    const state = makeState(10, 10);
    setTerrain(state, 5, 5, TerrainType.Mountain, 1);
    setTerrain(state, 6, 5, TerrainType.Mountain, 2); // taller cliff on the right: at LAYER 1 the cells are contiguous
    // The low cell's corners toward the cliff (TR, BR) are NOT corners of the layer-1 silhouette — the
    // taller neighbour's base covers that edge — so they stay square; only the open-ground corners cut.
    expect(computeLockedCorners(state, 5, 5, 'terrain')).toEqual([false, true, false, true]);
  });

  it('the asymmetry: the TALLER cell bevels DOWN toward a LOWER neighbour (a lower step does not reach this layer)', () => {
    const state = makeState(10, 10);
    setTerrain(state, 5, 5, TerrainType.Mountain, 2);
    setTerrain(state, 6, 5, TerrainType.Mountain, 1); // lower on the right → the tier-2 cell rounds toward it
    expect(computeLockedCorners(state, 5, 5, 'terrain')).toEqual([false, false, false, false]);
  });
});

describe('computeLockedCorners — road', () => {
  function addRoad(state: any, x: number, y: number) {
    state.objects.set(`road-${x}-${y}`, {
      id: `road-${x}-${y}`, catalogId: 'road-dirt',
      position: { x, y }, rotation: 0, category: 1, elevation: 0,
    });
  }

  it('isolated road: all 4 free', () => {
    const state = makeState(10, 10);
    addRoad(state, 5, 5);
    const locked = computeLockedCorners(state, 5, 5, 'road');
    expect(locked).toEqual([false, false, false, false]);
  });

  it('road with right neighbor (endpoint): TR and BR locked', () => {
    const state = makeState(10, 10);
    addRoad(state, 5, 5);
    addRoad(state, 6, 5);
    const locked = computeLockedCorners(state, 5, 5, 'road');
    expect(locked).toEqual([false, true, false, true]);
  });

  it('straight-line road (left+right): all 4 locked', () => {
    const state = makeState(10, 10);
    addRoad(state, 4, 5);
    addRoad(state, 5, 5);
    addRoad(state, 6, 5);
    const locked = computeLockedCorners(state, 5, 5, 'road');
    expect(locked).toEqual([true, true, true, true]);
  });

  it('L-shape (top+right): only BL free', () => {
    const state = makeState(10, 10);
    addRoad(state, 5, 5);
    addRoad(state, 5, 4);
    addRoad(state, 6, 5);
    const locked = computeLockedCorners(state, 5, 5, 'road');
    expect(locked).toEqual([true, true, false, true]);
  });
});
