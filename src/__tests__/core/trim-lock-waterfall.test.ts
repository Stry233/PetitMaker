import { describe, it, expect } from 'vitest';
import { computeLockedCorners } from '../../core/edge-cut/trim-lock';
import { TerrainType } from '../../core/model/types';
import { makeState, setTerrain } from '../rules/_helpers';

/**
 * WATERFALL-FRAME: the cap mountains flanking a waterfall face keep their
 * corners on the FLOW side square — cutting them breaks the fall's frame.
 * (The BANK lock already covers the caps' water-facing corners; the flow-side
 * corners border open lower ground and would otherwise read as free convex corners.)
 */
describe('waterfall-side corner locking', () => {
  function waterfallSouth() {
    const state = makeState(12, 12);
    // water at (5,5) elev 1 flowing SOUTH ((5,6) is ground), capped E/W at exactly elev 1
    setTerrain(state, 5, 5, TerrainType.Water, 1);
    setTerrain(state, 4, 5, TerrainType.Mountain, 1);
    setTerrain(state, 6, 5, TerrainType.Mountain, 1);
    // backdrop so the water isn't floating context-wise (not required by trim-lock)
    setTerrain(state, 5, 4, TerrainType.Mountain, 1);
    return state;
  }

  it('locks the cap mountains’ south (flow-side) corners', () => {
    const state = waterfallSouth();
    const west = computeLockedCorners(state, 4, 5, 'terrain');
    const east = computeLockedCorners(state, 6, 5, 'terrain');
    // corner order [TL, TR, BL, BR] — south side = BL(2), BR(3)
    expect(west[2]).toBe(true);
    expect(west[3]).toBe(true);
    expect(east[2]).toBe(true);
    expect(east[3]).toBe(true);
  });

  it('a plain mountain beside non-waterfall water keeps its ground-side corners free', () => {
    const state = makeState(12, 12);
    // ground-level lake: not a waterfall (no lower neighbor face)
    setTerrain(state, 5, 5, TerrainType.Water, 0);
    setTerrain(state, 4, 5, TerrainType.Mountain, 1);
    const locked = computeLockedCorners(state, 4, 5, 'terrain');
    // BL corner (away from the water) stays cuttable
    expect(locked[2]).toBe(false);
  });
});
