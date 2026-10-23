import { describe, it, expect } from 'vitest';
import { computeLockedCorners } from '../../../../core/domain/edge-cut/trim-lock';
import { TerrainType } from '../../../../core/model/types';
import { makeState, setTerrain } from '../../../_support/map-state';
import { roadLookup } from '../../../../state/object-index';

/** Waterfall-frame: a cap mountain flanking a waterfall face keeps its corner at the fall's lip
 *  square, and its flow-side corner away from the water stays free. */
describe('waterfall-side corner locking', () => {
  function waterfallSouth() {
    const state = makeState(12, 12);
    // water at (5,5) elev 1 flowing south ((5,6) is ground), capped E/W at exactly elev 1
    setTerrain(state, 5, 5, TerrainType.Water, 1);
    setTerrain(state, 4, 5, TerrainType.Mountain, 1);
    setTerrain(state, 6, 5, TerrainType.Mountain, 1);
    // backdrop so the water isn't floating context-wise (not required by trim-lock)
    setTerrain(state, 5, 4, TerrainType.Mountain, 1);
    return state;
  }

  it('locks each cap’s corner at the lip and leaves its outer flow-side corner free', () => {
    const state = waterfallSouth();
    const west = computeLockedCorners(state, roadLookup(state), 4, 5, 'terrain');
    const east = computeLockedCorners(state, roadLookup(state), 6, 5, 'terrain');
    // corner order [TL, TR, BL, BR]; south side = BL(2), BR(3)
    expect([west[2], west[3]]).toEqual([false, true]);
    expect([east[2], east[3]]).toEqual([true, false]);
  });

  it('locks the lip corner even where the fall lands in water on its other edge', () => {
    // The bank lock frees a corner with water on both edges; the lip still stays square.
    const state = waterfallSouth();
    for (const x of [4, 5, 6]) setTerrain(state, x, 6, TerrainType.Water, 0);
    const west = computeLockedCorners(state, roadLookup(state), 4, 5, 'terrain');
    expect(west[3]).toBe(true);
  });

  it('locks the falling water itself whole: no corner of a face cell is cuttable', () => {
    // Every corner of a face cell resists cutting, the corners away from the flow included —
    // against the back wall and caps they pin nothing (not same-type) and drop nothing, and a cut
    // there would round the back of the fall.
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
