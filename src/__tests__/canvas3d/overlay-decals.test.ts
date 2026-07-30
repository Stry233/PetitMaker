/**
 * Ghost/flash decal geometry: one surface-draped quad per cell, at the cell's
 * own standable height (a ghost across a cliff drapes each cell where it
 * stands), on the grid the tool paints (micro for terrain, macro for objects).
 */
import { describe, it, expect } from 'vitest';
import { cellDecals, DECAL_LIFT } from '../../canvas/map3d/build/overlay-decals';
import { GROUND_SLAB_Y, layerToY } from '../../canvas/map3d/core/coords';
import { TerrainType } from '../../core/model/types';
import type { GridState } from '../../core/model/types';
import { makeState, setTerrain } from '../rules/_helpers';

describe('cellDecals', () => {
  it('drapes each cell at its own surface height', () => {
    const s = makeState(20, 20) as GridState;
    setTerrain(s, 5, 5, TerrainType.Mountain, 3);
    const m = cellDecals(s, [{ x: 5, y: 5 }, { x: 6, y: 5 }], true);
    expect(m.positions.length).toBe(2 * 4 * 3);
    const ys = [m.positions[1]!, m.positions[13]!];
    expect(ys[0]).toBeCloseTo(layerToY(3) + DECAL_LIFT, 4);
    expect(ys[1]).toBeCloseTo(GROUND_SLAB_Y + DECAL_LIFT, 4);
  });

  it('terrain grid offsets by half a cell; macro grid does not', () => {
    const s = makeState(20, 20) as GridState;
    const micro = cellDecals(s, [{ x: 5, y: 5 }], true);
    const macro = cellDecals(s, [{ x: 5, y: 5 }], false);
    expect(macro.positions[0]! - micro.positions[0]!).toBeCloseTo(0.5, 5);
  });

  it('skips far off-map cells (the sky-ray sentinel)', () => {
    const s = makeState(20, 20) as GridState;
    const m = cellDecals(s, [{ x: -10_000, y: -10_000 }], true);
    expect(m.positions.length).toBe(0);
  });
});
