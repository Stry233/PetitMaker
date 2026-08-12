import { describe, it, expect } from 'vitest';
import { computeLockedCorners } from '../../core/edge-cut/trim-lock';
import { TerrainType } from '../../core/model/types';
import { makeState, setTerrain } from '../rules/_helpers';
import { roadLookup } from '../../state/object-index';

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
    const west = computeLockedCorners(state, roadLookup(state), 4, 5, 'terrain');
    const east = computeLockedCorners(state, roadLookup(state), 6, 5, 'terrain');
    // corner order [TL, TR, BL, BR] — south side = BL(2), BR(3)
    expect(west[2]).toBe(true);
    expect(west[3]).toBe(true);
    expect(east[2]).toBe(true);
    expect(east[3]).toBe(true);
  });

  it('locks the falling water itself whole: no corner of a face cell is cuttable', () => {
    // Issue #8: the drop side was locked but the lip's corners AWAY from the flow — against its
    // back wall and caps, which pin nothing (not same-type) and drop nothing — were offered, and
    // cutting them rounded the back of the fall.
    const state = waterfallSouth();
    const lip = computeLockedCorners(state, roadLookup(state), 5, 5, 'terrain');
    expect(lip).toEqual([true, true, true, true]);
  });

  it('an elevated pool with no face still rounds against its rim', () => {
    // A rimmed pool: water at 1 enclosed by mountain@1 on all sides. No drop → no face → the
    // ordinary geometry stands, and the pool's corners against the rim stay free.
    const state = makeState(12, 12);
    setTerrain(state, 5, 5, TerrainType.Water, 1);
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
      setTerrain(state, 5 + dx, 5 + dy, TerrainType.Mountain, 1);
    }
    const locked = computeLockedCorners(state, roadLookup(state), 5, 5, 'terrain');
    expect(locked).toEqual([false, false, false, false]);
  });

  it('a plain mountain beside non-waterfall water keeps its ground-side corners free', () => {
    const state = makeState(12, 12);
    // ground-level lake: not a waterfall (no lower neighbor face)
    setTerrain(state, 5, 5, TerrainType.Water, 0);
    setTerrain(state, 4, 5, TerrainType.Mountain, 1);
    const locked = computeLockedCorners(state, roadLookup(state), 4, 5, 'terrain');
    // BL corner (away from the water) stays cuttable
    expect(locked[2]).toBe(false);
  });
});
