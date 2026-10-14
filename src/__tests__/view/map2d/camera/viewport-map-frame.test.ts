import { describe, expect, it } from 'vitest';
import { Viewport } from '../../../../view/map2d/camera/viewport';
import { TILE_SIZE } from '../../../../view/map2d/geometry/world';

describe('offset map framing', () => {
  it('fits the complete sea rectangle and keeps saved coordinates in place', () => {
    const view = new Viewport(1040, 960);
    view.fitToMap(208, 192, -15, -23);
    expect(view.getZoom()).toBe(5 / TILE_SIZE);
    expect(view.screenToWorld(0, 0)).toEqual({ x: -15 * TILE_SIZE, y: -23 * TILE_SIZE });
    expect(view.screenToWorld(1040, 960)).toEqual({ x: 193 * TILE_SIZE, y: 169 * TILE_SIZE });
    expect(view.screenToWorld(15 * 5, 23 * 5)).toEqual({ x: 0, y: 0 });
    view.pan(100_000, 100_000);
    const bottomRight = view.getOffset();
    expect(bottomRight).toEqual({ x: 193 * 5 - 160, y: 169 * 5 - 160 });
    view.pan(-100_000, -100_000);
    expect(view.getOffset()).toEqual({ x: -15 * 5 + 160 - 1040, y: -23 * 5 + 160 - 960 });
  });
});
