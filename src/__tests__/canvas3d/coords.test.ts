import { describe, it, expect } from 'vitest';
import { LAYER_HEIGHT, cellCornerWorld, layerToY, mapCenterOffset } from '../../canvas/map3d/core/coords';

describe('preview3d/core/coords', () => {
  it('centres a w×h map so its middle sits at the origin', () => {
    const off = mapCenterOffset(10, 6);
    expect(off).toEqual({ x: 5, z: 3 });
  });

  it('maps a cell corner to world X/Z relative to the centre offset', () => {
    // cell (0,0) low corner is at (0,0) in grid space → minus offset (5,3)
    const p = cellCornerWorld(0, 0, 10, 6);
    expect(p.x).toBeCloseTo(-5);
    expect(p.z).toBeCloseTo(-3);
  });

  it('maps elevation layers to world height', () => {
    expect(layerToY(0)).toBe(0);
    expect(layerToY(2)).toBeCloseTo(2 * LAYER_HEIGHT);
  });
});
