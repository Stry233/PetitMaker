/** A map rect's box on screen, read through any projection, a turned one included. */
import { describe, it, expect } from 'vitest';
import { projectedBox } from '../../../../ui/chrome/floating/projected-box';
import type { ViewProjection } from '../../../../tools/pointer/runtime';
import { mapPoint } from '../../../../core/grid/grids';

/** A flat projection 10 px a cell about (500, 300), turned a quarter turn counter-clockwise. */
const quarterTurn = {
  screenToPoint: (sx: number, sy: number) => mapPoint({ x: (300 - sy) / 10, y: (sx - 500) / 10 }),
  cellToScreen: (x: number, y: number) => ({ x: 500 + y * 10, y: 300 - x * 10, scale: 10 }),
} as ViewProjection;

describe('projectedBox', () => {
  it('bounds a footprint by its four projected corners, whatever way the map is turned', () => {
    expect(projectedBox(quarterTurn, { x: 2, y: 1, w: 2, h: 1 })).toEqual({ x: 510, y: 260, w: 10, h: 20 });
  });

  it('places nothing whose corner stands behind the camera', () => {
    const behind = { ...quarterTurn, cellToScreen: (x: number, y: number) => ({ ...quarterTurn.cellToScreen(x, y), behind: x > 3 }) } as ViewProjection;
    expect(projectedBox(behind, { x: 2, y: 1, w: 2, h: 1 })).toBeNull();
  });
});
