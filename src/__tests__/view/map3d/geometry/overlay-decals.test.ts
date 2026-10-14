/**
 * Ghost/flash decal geometry: surface-draped quads at the standable height under each part of a
 * cell (a ghost across a cliff drapes each cell where it stands), on the grid the tool paints
 * (terrain cells for terrain, placement cells for objects). A placement cell lies across four
 * terrain cells and drapes on each of them.
 */
import { describe, it, expect } from 'vitest';
import { cellDecals, rectDecals, DECAL_LIFT } from '../../../../view/map3d/geometry/overlay-decals';
import { GROUND_SLAB_Y, layerToY } from '../../../../view/map3d/geometry/coords';
import { TerrainType } from '../../../../core/model/types';
import type { GridState } from '../../../../core/model/types';
import { makeState, setTerrain } from '../../../_support/map-state';

describe('cellDecals', () => {
  it('drapes each cell at its own surface height', () => {
    const s = makeState(20, 20) as GridState;
    setTerrain(s, 5, 5, TerrainType.Mountain, 3);
    const m = cellDecals(s, [{ x: 5, y: 5 }, { x: 6, y: 5 }], 'terrain');
    expect(m.positions.length).toBe(2 * 4 * 3);
    const ys = [m.positions[1]!, m.positions[13]!];
    expect(ys[0]).toBeCloseTo(layerToY(3) + DECAL_LIFT, 4);
    expect(ys[1]).toBeCloseTo(GROUND_SLAB_Y + DECAL_LIFT, 4);
  });

  it('terrain grid offsets by half a cell; macro grid does not', () => {
    const s = makeState(20, 20) as GridState;
    const micro = bounds(cellDecals(s, [{ x: 5, y: 5 }], 'terrain'));
    const macro = bounds(cellDecals(s, [{ x: 5, y: 5 }], 'object'));
    expect(macro.x0 - micro.x0).toBeCloseTo(0.5, 5);
    expect(macro.x1 - macro.x0).toBeCloseTo(1, 5);
    expect(macro.z1 - macro.z0).toBeCloseTo(1, 5);
  });

  it('drapes a placement cell over a step on both tiers, each part at the terrain under it', () => {
    // Terrain cell (5, 5) covers [4.5, 5.5): placement cell (5, 5) is a quarter on it and three
    // quarters on the ground, and neither part may take the other's height.
    const s = makeState(20, 20) as GridState;
    setTerrain(s, 5, 5, TerrainType.Mountain, 3);
    const m = cellDecals(s, [{ x: 5, y: 5 }], 'object');
    const parts = quads(m);
    expect(parts).toHaveLength(4);
    const high = parts.filter((q) => Math.abs(q.y - (layerToY(3) + DECAL_LIFT)) < 1e-4);
    const low = parts.filter((q) => Math.abs(q.y - (GROUND_SLAB_Y + DECAL_LIFT)) < 1e-4);
    expect(high).toHaveLength(1);
    expect(low).toHaveLength(3);
    expect(high[0]!.x1 - high[0]!.x0).toBeCloseTo(0.5, 5);
    expect(high[0]!.x0).toBeCloseTo(bounds(m).x0, 5);
    expect(high[0]!.z0).toBeCloseTo(bounds(m).z0, 5);
  });

  it('skips far off-map cells (the sky-ray sentinel)', () => {
    const s = makeState(20, 20) as GridState;
    const m = cellDecals(s, [{ x: -10_000, y: -10_000 }], 'terrain');
    expect(m.positions.length).toBe(0);
  });
});

/** Each four-vertex quad of a decal mesh: its X/Z extent and its height. */
function quads(m: { positions: number[] }): Array<{ x0: number; x1: number; z0: number; z1: number; y: number }> {
  const out: Array<{ x0: number; x1: number; z0: number; z1: number; y: number }> = [];
  for (let i = 0; i < m.positions.length; i += 12) {
    const q = { positions: m.positions.slice(i, i + 12) };
    out.push({ ...bounds(q), y: q.positions[1]! });
  }
  return out;
}

/** The X/Z extent of a decal mesh, in world units. */
function bounds(m: { positions: number[] }): { x0: number; x1: number; z0: number; z1: number } {
  const xs: number[] = [], zs: number[] = [];
  for (let i = 0; i < m.positions.length; i += 3) { xs.push(m.positions[i]!); zs.push(m.positions[i + 2]!); }
  return { x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs) };
}

describe('rectDecals (a BODY, not a cell set)', () => {
  it('covers exactly the rect, half-grid origin and fractional size included', () => {
    const s = makeState(20, 20) as GridState;
    const body = rectDecals(s, [{ x: 5.5, y: 6.5, w: 3, h: 2 }], 'object');
    const b = bounds(body);
    const cell = bounds(cellDecals(s, [{ x: 5.5, y: 6.5 }], 'object'));
    // Same origin as the cell decal at the same coordinate; extent = the rect's own w/h.
    expect(b.x0).toBeCloseTo(cell.x0, 5);
    expect(b.z0).toBeCloseTo(cell.z0, 5);
    expect(b.x1 - b.x0).toBeCloseTo(3, 5);
    expect(b.z1 - b.z0).toBeCloseTo(2, 5);
  });

  it('never draws past a fractional edge', () => {
    const s = makeState(20, 20) as GridState;
    const b = bounds(rectDecals(s, [{ x: 5.5, y: 5.5, w: 1.5, h: 1.5 }], 'object'));
    expect(b.x1 - b.x0).toBeCloseTo(1.5, 5);
    expect(b.z1 - b.z0).toBeCloseTo(1.5, 5);
  });

  it('splits at terrain cell boundaries so each piece drapes on its own terrace', () => {
    // [5, 7) × [5, 6) crosses terrain columns 5, 6, 7 and rows 5, 6; only terrain cell (5, 5),
    // which covers [4.5, 5.5), is raised, so only the rect's corner over it lies on the terrace.
    const s = makeState(20, 20) as GridState;
    setTerrain(s, 5, 5, TerrainType.Mountain, 3);
    const m = rectDecals(s, [{ x: 5, y: 5, w: 2, h: 1 }], 'object');
    const parts = quads(m);
    expect(parts).toHaveLength(6);
    const high = parts.filter((q) => Math.abs(q.y - (layerToY(3) + DECAL_LIFT)) < 1e-4);
    expect(high).toHaveLength(1);
    expect(high[0]!.x1 - high[0]!.x0).toBeCloseTo(0.5, 5);
    expect(high[0]!.z1 - high[0]!.z0).toBeCloseTo(0.5, 5);
    expect(parts.filter((q) => Math.abs(q.y - (GROUND_SLAB_Y + DECAL_LIFT)) < 1e-4)).toHaveLength(5);
  });

  it('takes the terrain shift like every other decal, and drops empty bodies', () => {
    const s = makeState(20, 20) as GridState;
    const micro = rectDecals(s, [{ x: 5, y: 5, w: 1, h: 1 }], 'terrain');
    const macro = rectDecals(s, [{ x: 5, y: 5, w: 1, h: 1 }], 'object');
    expect(macro.positions[0]! - micro.positions[0]!).toBeCloseTo(0.5, 5);
    expect(rectDecals(s, [{ x: 5, y: 5, w: 0, h: 2 }], 'object').positions.length).toBe(0);
  });
});
