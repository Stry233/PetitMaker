import { describe, it, expect } from 'vitest';
import { LAYER_HEIGHT, SPAN_DECK_CLEARANCE, SEA_Y, bridgeDeckY, cellCornerWorld, layerToY, mapCenterOffset, surfaceY, waterSurfaceY } from '../../../../view/map3d/geometry/coords';
import { PLACEMENT_GRID } from '../../../../core/game/profile';

describe('preview3d/core/coords', () => {
  it('centres a w×h map so its middle sits at the origin', () => {
    const off = mapCenterOffset(10, 6);
    expect(off).toEqual({ x: 5, z: 3 });
  });

  it('maps a cell corner to world X/Z relative to the centre offset', () => {
    // cell (0,0) low corner is at (0,0) in grid space → minus offset (5,3)
    const p = cellCornerWorld(0, 0, 10, 6, PLACEMENT_GRID);
    expect(p.x).toBeCloseTo(-5);
    expect(p.z).toBeCloseTo(-3);
  });

  it.each([0, 1, 2, 3, 4, 5])('recesses tier %i water by a quarter cell while the bridge lands on its banks', tier => {
    expect(surfaceY(tier) - waterSurfaceY(tier)).toBeCloseTo(0.25);
    expect(bridgeDeckY(tier)).toBeCloseTo(surfaceY(tier) + SPAN_DECK_CLEARANCE);
    expect(waterSurfaceY(0)).toBe(SEA_Y);
  });

  it('maps elevation layers to world height', () => {
    expect(layerToY(0)).toBe(0);
    expect(layerToY(2)).toBeCloseTo(2 * LAYER_HEIGHT);
  });
});
