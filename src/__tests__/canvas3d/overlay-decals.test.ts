/**
 * Ghost/flash decal geometry: one surface-draped quad per cell, at the cell's
 * own standable height (a ghost across a cliff drapes each cell where it
 * stands), on the grid the tool paints (micro for terrain, macro for objects).
 */
import { describe, it, expect } from 'vitest';
import { cellDecals, rectDecals, DECAL_LIFT } from '../../canvas/map3d/build/overlay-decals';
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

/** The X/Z extent of a decal mesh, in world units. */
function bounds(m: { positions: number[] }): { x0: number; x1: number; z0: number; z1: number } {
  const xs: number[] = [], zs: number[] = [];
  for (let i = 0; i < m.positions.length; i += 3) { xs.push(m.positions[i]!); zs.push(m.positions[i + 2]!); }
  return { x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs) };
}

describe('rectDecals (a BODY, not a cell set)', () => {
  it('covers exactly the rect, half-grid origin and fractional size included', () => {
    const s = makeState(20, 20) as GridState;
    const body = rectDecals(s, [{ x: 5.5, y: 6.5, w: 3, h: 2 }], false);
    const b = bounds(body);
    const cell = bounds(cellDecals(s, [{ x: 5.5, y: 6.5 }], false));
    // Same origin as the cell decal at the same coordinate; extent = the rect's own w/h.
    expect(b.x0).toBeCloseTo(cell.x0, 5);
    expect(b.z0).toBeCloseTo(cell.z0, 5);
    expect(b.x1 - b.x0).toBeCloseTo(3, 5);
    expect(b.z1 - b.z0).toBeCloseTo(2, 5);
  });

  it('never draws past a fractional edge', () => {
    const s = makeState(20, 20) as GridState;
    const b = bounds(rectDecals(s, [{ x: 5.5, y: 5.5, w: 1.5, h: 1.5 }], false));
    expect(b.x1 - b.x0).toBeCloseTo(1.5, 5);
    expect(b.z1 - b.z0).toBeCloseTo(1.5, 5);
  });

  it('splits at cell boundaries so each piece drapes on its own terrace', () => {
    const s = makeState(20, 20) as GridState;
    setTerrain(s, 5, 5, TerrainType.Mountain, 3);
    const m = rectDecals(s, [{ x: 5, y: 5, w: 2, h: 1 }], false);
    expect(m.positions.length).toBe(2 * 4 * 3); // two cells crossed → two quads
    expect(m.positions[1]!).toBeCloseTo(layerToY(3) + DECAL_LIFT, 4);
    expect(m.positions[13]!).toBeCloseTo(GROUND_SLAB_Y + DECAL_LIFT, 4);
  });

  it('takes the terrain shift like every other decal, and drops empty bodies', () => {
    const s = makeState(20, 20) as GridState;
    const micro = rectDecals(s, [{ x: 5, y: 5, w: 1, h: 1 }], true);
    const macro = rectDecals(s, [{ x: 5, y: 5, w: 1, h: 1 }], false);
    expect(macro.positions[0]! - micro.positions[0]!).toBeCloseTo(0.5, 5);
    expect(rectDecals(s, [{ x: 5, y: 5, w: 0, h: 2 }], false).positions.length).toBe(0);
  });
});
