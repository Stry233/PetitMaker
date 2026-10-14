import { describe, it, expect } from 'vitest';
import { waterfallAdjacentUniformityRule } from '../../rules/waterfall-uniformity';
import { TerrainType, type MacroCoord } from '../../core/model/types';
import { makeState, setTerrain } from '../_support/map-state';

describe('V-WTR-03: Waterfall Adjacent Row Uniformity', () => {
  it('allows uniform front row (all same elevation)', () => {
    // M W M at y=3 elev 2, capped E/W, wall at y=2.
    // Front row at y=4: all at elev 1.
    const state = makeState(10, 10);
    setTerrain(state, 4, 3, TerrainType.Mountain, 2);
    setTerrain(state, 5, 3, TerrainType.Water, 2);
    setTerrain(state, 6, 3, TerrainType.Mountain, 2);
    setTerrain(state, 5, 2, TerrainType.Mountain, 2);
    // Front row at y=4: all at elev 1
    setTerrain(state, 4, 4, TerrainType.Mountain, 1);
    setTerrain(state, 5, 4, TerrainType.Mountain, 1);
    setTerrain(state, 6, 4, TerrainType.Mountain, 1);
    expect(waterfallAdjacentUniformityRule.validate(state)).toHaveLength(0);
  });

  it('rejects non-uniform front row', () => {
    // M W M at y=3 elev 2, capped E/W, wall at y=2.
    // Front row at y=4: (4,4)=M@1, (5,4)=ground(0), (6,4)=M@1 -> non-uniform
    const state = makeState(10, 10);
    setTerrain(state, 4, 3, TerrainType.Mountain, 2);
    setTerrain(state, 5, 3, TerrainType.Water, 2);
    setTerrain(state, 6, 3, TerrainType.Mountain, 2);
    setTerrain(state, 5, 2, TerrainType.Mountain, 2);
    // Front row at y=4: non-uniform
    setTerrain(state, 4, 4, TerrainType.Mountain, 1);
    // (5,4) is ground (elev 0) -- different from 1
    setTerrain(state, 6, 4, TerrainType.Mountain, 1);
    expect(waterfallAdjacentUniformityRule.validate(state).length).toBeGreaterThan(0);
  });

  it('allows uniform mixed row (mountain + water at same elev)', () => {
    const state = makeState(10, 10);
    setTerrain(state, 4, 3, TerrainType.Mountain, 2);
    setTerrain(state, 5, 3, TerrainType.Water, 2);
    setTerrain(state, 6, 3, TerrainType.Mountain, 2);
    setTerrain(state, 5, 2, TerrainType.Mountain, 2);
    // Front row: M W M all at elev 1
    setTerrain(state, 4, 4, TerrainType.Mountain, 1);
    setTerrain(state, 5, 4, TerrainType.Water, 1);
    setTerrain(state, 6, 4, TerrainType.Mountain, 1);
    expect(waterfallAdjacentUniformityRule.validate(state)).toHaveLength(0);
  });

  it('no violations for map with no waterfalls', () => {
    const state = makeState(10, 10);
    setTerrain(state, 5, 5, TerrainType.Mountain, 3);
    expect(waterfallAdjacentUniformityRule.validate(state)).toHaveLength(0);
  });

  it('wide waterfall: all n cells must be uniform', () => {
    // M W W W M at y=3 elev 2, wall at y=2. Flow south.
    // Front row at y=4: one cell different.
    const state = makeState(10, 10);
    setTerrain(state, 3, 3, TerrainType.Mountain, 2);
    setTerrain(state, 4, 3, TerrainType.Water, 2);
    setTerrain(state, 5, 3, TerrainType.Water, 2);
    setTerrain(state, 6, 3, TerrainType.Water, 2);
    setTerrain(state, 7, 3, TerrainType.Mountain, 2);
    for (let x = 3; x <= 7; x++) setTerrain(state, x, 2, TerrainType.Mountain, 2);
    // Front row at y=4: all at elev 1 except (5,4) at elev 2
    for (let x = 3; x <= 7; x++) setTerrain(state, x, 4, TerrainType.Mountain, 1);
    setTerrain(state, 5, 4, TerrainType.Mountain, 2); // different!
    expect(waterfallAdjacentUniformityRule.validate(state).length).toBeGreaterThan(0);
  });

  it('allows waterfall with no open face (wall blocks flow)', () => {
    // Mountain wall on south side. Water flows north only.
    // North adjacent row is uniform (all at same elevation).
    const state = makeState(10, 10);
    setTerrain(state, 4, 3, TerrainType.Mountain, 1);
    setTerrain(state, 5, 3, TerrainType.Water, 1);
    setTerrain(state, 6, 3, TerrainType.Mountain, 1);
    // Wall on south side at y=4 (same elev -> no south face)
    setTerrain(state, 4, 4, TerrainType.Mountain, 1);
    setTerrain(state, 5, 4, TerrainType.Mountain, 1);
    setTerrain(state, 6, 4, TerrainType.Mountain, 1);
    // North side at y=2: uniform ground (all 0)
    expect(waterfallAdjacentUniformityRule.validate(state)).toHaveLength(0);
  });

  it('front row at map edge -- no violation (all out-of-bounds)', () => {
    const state = makeState(10, 10);
    // Waterfall near north edge, flow north -> front row is off-map
    setTerrain(state, 4, 1, TerrainType.Mountain, 1);
    setTerrain(state, 5, 1, TerrainType.Water, 1);
    setTerrain(state, 6, 1, TerrainType.Mountain, 1);
    setTerrain(state, 5, 2, TerrainType.Mountain, 1);
    // North flow: front row at y=0 is all ground (elev 0) -> uniform
    expect(waterfallAdjacentUniformityRule.validate(state)).toHaveLength(0);
  });

  it('allows fully enclosed water (no waterfall face)', () => {
    // Water surrounded by mountains on all sides at same elev -> no face
    const state = makeState(10, 10);
    for (let y = 3; y <= 5; y++)
      for (let x = 2; x <= 7; x++)
        setTerrain(state, x, y, TerrainType.Mountain, 2);
    for (let x = 3; x <= 6; x++)
      setTerrain(state, x, 4, TerrainType.Water, 2);
    expect(waterfallAdjacentUniformityRule.validate(state)).toHaveLength(0);
  });

  describe('a strip holding a patch-only water cell (a fillet whose support is a tier lower)', () => {
    /** The (x, y) `along` cells down the strip axis and `across` rows deep, the axes swapped when `vertical`. */
    const at = (vertical: boolean, along: number, across: number): [number, number] => (vertical ? [across, along] : [along, across]);

    it.each([false, true])('keeps the far cap and reports the front cell off the row (vertical %s)', (vertical) => {
      // Strip M@2, W@2, patch water (elevation 2, base 1), M@2 at row 3; wall behind at row 2;
      // front row 4 is M@1 under the first three and bare ground under the far cap.
      const state = makeState(10, 10);
      const put = (along: number, across: number, type: TerrainType, elevation: number) => {
        const [x, y] = at(vertical, along, across);
        setTerrain(state, x, y, type, elevation);
      };
      put(3, 3, TerrainType.Mountain, 2);
      put(4, 3, TerrainType.Water, 2);
      const [px, py] = at(vertical, 5, 3);
      state.cells[py]![px]!.terrain = { type: TerrainType.Water, elevation: 2, patchOnly: true, patchBase: 1, corners: ['square', 'square', 'fan', 'square'] };
      put(6, 3, TerrainType.Mountain, 2);
      put(4, 2, TerrainType.Mountain, 2);
      put(5, 2, TerrainType.Mountain, 2);
      for (const along of [3, 4, 5]) put(along, 4, TerrainType.Mountain, 1);
      const [fx, fy] = at(vertical, 6, 4);
      expect(waterfallAdjacentUniformityRule.validate(state).flatMap((e): MacroCoord[] => e.cells ?? [])).toEqual([{ x: fx, y: fy }]);
    });
  });
});
