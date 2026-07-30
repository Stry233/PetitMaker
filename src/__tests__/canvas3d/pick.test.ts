/**
 * Surface picking: a pointer ray marches the terrain heightfield and lands on
 * the FIRST visible surface — a hilltop occludes the cell behind it, a cliff
 * wall attributes to its column's cell, water picks at its surface, the sea at
 * sea level. Coordinates honour the dual grid: terrain columns sit on the
 * micro grid (−0.5 world offset), ground slabs on the macro grid.
 */
import { describe, it, expect } from 'vitest';
import { pickSurface } from '../../canvas/map3d/interaction/pick';
import { GROUND_SLAB_Y, layerToY, mapCenterOffset } from '../../canvas/map3d/core/coords';
import { CellZone, TerrainType } from '../../core/model/types';
import type { GridState } from '../../core/model/types';
import { makeState, setTerrain } from '../rules/_helpers';

/** A ray from high above (wx, wz) pointing straight down. */
const down = (wx: number, wz: number) => ({ origin: { x: wx, y: 50, z: wz }, dir: { x: 0, y: -1, z: 0 } });
/** World X/Z of the CENTER of macro cell (x, y) on a w×h map. */
function center(state: GridState, x: number, y: number) {
  const off = mapCenterOffset(state.template.width, state.template.height);
  return { wx: x + 0.5 - off.x, wz: y + 0.5 - off.z };
}

describe('pickSurface', () => {
  it('straight down onto flat ground picks the macro cell at slab height', () => {
    const s = makeState(20, 20) as GridState;
    const { wx, wz } = center(s, 7, 9);
    const hit = pickSurface(s, down(wx, wz).origin, down(wx, wz).dir)!;
    expect(hit.cell).toEqual({ x: 7, y: 9 });
    expect(hit.kind).toBe('ground');
    expect(hit.elevation).toBe(0);
    expect(hit.point.y).toBeCloseTo(GROUND_SLAB_Y, 4);
  });

  it('picks a mountain top at its surface, and the surface elevation rides the stack', () => {
    const s = makeState(20, 20) as GridState;
    setTerrain(s, 5, 5, TerrainType.Mountain, 3);
    const { wx, wz } = center(s, 5, 5);
    // Terrain renders on the micro grid (−0.5): the column of cell (5,5) covers
    // [wx−1, wx] in world space, so sample at the column's own center.
    const hit = pickSurface(s, { x: wx - 0.5, y: 50, z: wz - 0.5 }, { x: 0, y: -1, z: 0 })!;
    expect(hit.cell).toEqual({ x: 5, y: 5 });
    expect(hit.kind).toBe('terrain');
    expect(hit.elevation).toBe(3);
    expect(hit.point.y).toBeCloseTo(layerToY(3), 3);
  });

  it('a hill in front occludes the cell behind it (oblique ray hits the near column)', () => {
    const s = makeState(20, 20) as GridState;
    setTerrain(s, 10, 10, TerrainType.Mountain, 4);
    const tallTop = center(s, 10, 10);
    // Aim at the GROUND far behind the column, from low in front of it: the ray
    // must clip the column's wall/top first.
    const behind = center(s, 10, 6);
    const origin = { x: tallTop.wx - 0.5, y: layerToY(2), z: tallTop.wz + 6 };
    const target = { x: behind.wx - 0.5, y: GROUND_SLAB_Y, z: behind.wz };
    const len = Math.hypot(target.x - origin.x, target.y - origin.y, target.z - origin.z);
    const dir = { x: (target.x - origin.x) / len, y: (target.y - origin.y) / len, z: (target.z - origin.z) / len };
    const hit = pickSurface(s, origin, dir)!;
    expect(hit.cell).toEqual({ x: 10, y: 10 });
    expect(hit.kind).toBe('terrain');
  });

  it('water picks at its rendered surface', () => {
    const s = makeState(20, 20) as GridState;
    setTerrain(s, 3, 8, TerrainType.Water, 0);
    const { wx, wz } = center(s, 3, 8);
    const hit = pickSurface(s, { x: wx - 0.5, y: 50, z: wz - 0.5 }, { x: 0, y: -1, z: 0 })!;
    expect(hit.cell).toEqual({ x: 3, y: 8 });
    expect(hit.kind).toBe('water');
  });

  it('void cells pick the sea; rays that never land return null', () => {
    const s = makeState(20, 20) as GridState;
    s.cells[0]![0]!.zone = CellZone.Void;
    const { wx, wz } = center(s, 0, 0);
    const hit = pickSurface(s, down(wx, wz).origin, down(wx, wz).dir)!;
    expect(hit.kind).toBe('sea');
    expect(hit.cell).toEqual({ x: 0, y: 0 });
    expect(pickSurface(s, { x: 0, y: 50, z: 0 }, { x: 0, y: 1, z: 0 })).toBeNull();
    expect(pickSurface(s, { x: 500, y: 50, z: 0 }, { x: 0, y: -1, z: 0 })).toBeNull();
  });
});
