/**
 * A ground-islet cut (the concave corner of an L-shaped pool, or any grass corner poking into water)
 * renders on the water's micro grid, as 2D does; drawn a half-cell off it would float detached. The
 * kept grass and the revealed water partition the same trimmed footprint.
 */
import { describe, it, expect } from 'vitest';
import { buildChunkTerrain } from '../../../../view/map3d/geometry/terrain-geometry';
import { cellCornerWorld, GROUND_SLAB_Y, layerToY, waterSurfaceY } from '../../../../view/map3d/geometry/coords';
import { TerrainType } from '../../../../core/model/types';
import type { GridState } from '../../../../core/model/types';
import { makeState, setTerrain } from '../../../_support/map-state';
import { PLACEMENT_GRID } from '../../../../core/game/profile';

/** An L of water at (1,1),(2,1),(1,2) with (2,2) a grass islet whose TL corner
 *  is cut (fan) to reveal the pool at the concave bend: the smallest L-pool
 *  inner corner. */
function lPoolState(): GridState {
  const s = makeState(4, 4) as GridState;
  setTerrain(s, 1, 1, TerrainType.Water, 0);
  setTerrain(s, 2, 1, TerrainType.Water, 0);
  setTerrain(s, 1, 2, TerrainType.Water, 0);
  s.cells[2]![2]!.terrain = { type: TerrainType.None, elevation: 0, corners: ['fan', 'square', 'square', 'square'] };
  return s;
}

const has = (positions: readonly number[], x: number, z: number) => {
  for (let i = 0; i < positions.length; i += 3) {
    if (Math.abs(positions[i]! - x) < 1e-4 && Math.abs(positions[i + 2]! - z) < 1e-4) return true;
  }
  return false;
};

describe('ground-islet cut (L-pool inner corner) alignment', () => {
  it('draws no coast-skirt false-cliff around a cut cell connected to grass', () => {
    const s = lPoolState();
    const c = cellCornerWorld(2, 2, 4, 4, PLACEMENT_GRID); // macro corner of the islet cell
    const m = buildChunkTerrain(s, 0, 0);
    const topAtCorner: number[] = [];
    for (let i = 0; i < m.ground.positions.length; i += 3) {
      if (Math.abs(m.ground.positions[i]! - (c.x + 1)) < 1e-4 && Math.abs(
        m.ground.positions[i + 2]! - (c.z + 1),
      ) < 1e-4) topAtCorner.push(m.ground.positions[i + 1]!);
    }
    expect(topAtCorner.some((y) => Math.abs(y - GROUND_SLAB_Y) < 1e-4), 'grass floor at the cut cell BR corner').toBe(true);
    // A skirted islet would drive grass walls to GROUND_BOTTOM even on edges shared with solid
    // grass; a cut cell with no void or sea neighbour gets none.
    let deep = 0;
    for (let i = 0; i < m.ground.positions.length; i += 3) {
      const x = m.ground.positions[i]!, y = m.ground.positions[i + 1]!, z = m.ground.positions[i + 2]!;
      if (Math.abs(y - -0.4) < 1e-4 && x > c.x - 0.6 && x < c.x + 1.1 && z > c.z - 0.6 && z < c.z + 1.1) deep++;
    }
    expect(deep, 'no coast skirt around the connected cut cell').toBe(0);
  });

  it('reveals the pool water on the MICRO grid, not the macro grid', () => {
    const s = lPoolState();
    const c = cellCornerWorld(2, 2, 4, 4, PLACEMENT_GRID);
    const m = buildChunkTerrain(s, 0, 0);
    // Only a macro-aligned reveal would put a water vertex at the macro mid-cell corner: the micro
    // reveal sits 0.5 lower, and no pool cell reaches the islet cell's +x/+z half.
    expect(has(m.water.positions, c.x + 0.5, c.z + 0.5), 'no water reveal on the macro grid').toBe(false);
    expect(has(m.water.positions, c.x - 0.5, c.z - 0.5), 'water reveal on the micro grid').toBe(true);
  });

  it('a cosmetic water Γ fillet (generator gamma, no real base) draws ONLY the fillet, not a full square', () => {
    // A patchOnly fillet with no `patchBase` has base tier -1: a cosmetic round over ground. As in
    // 2D, only the wrapped corner's fillet is drawn, never a flooded base.
    const s = makeState(6, 6) as GridState;
    // Water wrapping the patch cell's BR corner, so `patchCornerSplit` sees it wrapped.
    setTerrain(s, 3, 2, TerrainType.Water, 0); // +x edge
    setTerrain(s, 2, 3, TerrainType.Water, 0); // +y edge
    setTerrain(s, 3, 3, TerrainType.Water, 0); // diagonal
    s.cells[2]![2]!.terrain = { type: TerrainType.Water, elevation: 0, patchOnly: true, corners: ['empty', 'empty', 'empty', 'fan'] };
    const c = cellCornerWorld(2, 2, 6, 6, PLACEMENT_GRID);
    const m = buildChunkTerrain(s, 0, 0);
    // A flooded base would put water at the patch cell's micro TL corner.
    expect(has(m.water.positions, c.x - 0.5, c.z - 0.5), 'no flood over the empty corner').toBe(false);
    let brWater = 0;
    for (let i = 0; i < m.water.positions.length; i += 3) {
      const x = m.water.positions[i]!, z = m.water.positions[i + 2]!;
      if (x >= c.x - 1e-6 && x <= c.x + 0.5 + 1e-6 && z >= c.z - 1e-6 && z <= c.z + 0.5 + 1e-6) brWater++;
    }
    expect(brWater, 'the wrapped-corner fillet is drawn').toBeGreaterThan(0);
  });

  it('reveals the water in the rounded fan shape, not a square quadrant', () => {
    const s = lPoolState();
    const m = buildChunkTerrain(s, 0, 0);
    // A square reveal has only half-grid vertices; a fan traces an arc through off-grid points.
    let offGrid = 0;
    for (let i = 0; i < m.water.positions.length; i += 3) {
      const x = m.water.positions[i]!, z = m.water.positions[i + 2]!;
      const onHalf = (v: number) => Math.abs(v * 2 - Math.round(v * 2)) < 1e-3;
      if (!onHalf(x) || !onHalf(z)) offGrid++;
    }
    expect(offGrid, 'the fan reveal traces an arc').toBeGreaterThan(0);
  });

  it('gives the revealed water the pool depth (a shore wall), not a flat sheet', () => {
    const s = lPoolState();
    const c = cellCornerWorld(2, 2, 4, 4, PLACEMENT_GRID);
    const m = buildChunkTerrain(s, 0, 0);
    // The reveal's arc lies strictly inside the cut cell, and pool-cell shore walls sit on cell
    // boundaries, so a near-floor water vertex strictly inside the cell comes from the reveal's wall.
    let wallBottom = 0;
    for (let i = 0; i < m.water.positions.length; i += 3) {
      const x = m.water.positions[i]!, y = m.water.positions[i + 1]!, z = m.water.positions[i + 2]!;
      if (y < 0.02 && x > c.x - 0.5 + 1e-3 && x < c.x + 1e-3 && z > c.z - 0.5 + 1e-3 && z < c.z + 1e-3) wallBottom++;
    }
    expect(wallBottom, 'reveal shore wall reaches the floor').toBeGreaterThan(0);
  });
});

describe('elevated trimmed water backing (round pool on a plateau)', () => {
  it('shapes the mountain bank to the cut-away, not a full quadrant occluding the water body', () => {
    // An elevated water@2 cell whose TL corner rounds against a mountain@2 bank. The bank backing must
    // fill only the rounded-off cap (revealPolygon), not a full quadrant that occludes the pool body.
    const s = makeState(5, 5) as GridState;
    setTerrain(s, 1, 2, TerrainType.Mountain, 2); // -x bank
    setTerrain(s, 2, 1, TerrainType.Mountain, 2); // -y bank
    setTerrain(s, 3, 2, TerrainType.Water, 2);
    setTerrain(s, 2, 3, TerrainType.Water, 2);
    s.cells[2]![2]!.terrain = { type: TerrainType.Water, elevation: 2, corners: ['fan', 'square', 'square', 'square'] };
    const c = cellCornerWorld(2, 2, 5, 5, PLACEMENT_GRID);
    const x0 = c.x - 0.5, z0 = c.z - 0.5;
    const m = buildChunkTerrain(s, 0, 0);
    const mtnY = layerToY(2);
    const solidAt = (x: number, z: number) => {
      for (let i = 0; i < m.solid.positions.length; i += 3) {
        if (Math.abs(m.solid.positions[i]! - x) < 1e-4 && Math.abs(
          m.solid.positions[i + 1]! - mtnY,
        ) < 0.02 && Math.abs(m.solid.positions[i + 2]! - z) < 1e-4) return true;
      }
      return false;
    };
    // A full-quadrant bank would put a mountain top at the cut cell's centre, which the water owns.
    expect(solidAt(x0 + 0.5, z0 + 0.5), 'no full-quadrant bank at the water cell centre').toBe(false);
    expect(solidAt(x0, z0), 'bank fills the cut-away corner').toBe(true);
  });

  it('a mountain ISLET in an elevated pool reveals water only in the cut-away, not a full block over it', () => {
    // The concave inner corner of an elevated L-pool is a mountain@2 islet whose corner rounds into the
    // water@2. The revealed water must fill only the rounded cap; a full quadrant hides the terrain.
    const s = makeState(5, 5) as GridState;
    setTerrain(s, 1, 2, TerrainType.Water, 2);
    setTerrain(s, 2, 1, TerrainType.Water, 2);
    setTerrain(s, 3, 2, TerrainType.Mountain, 2);
    setTerrain(s, 2, 3, TerrainType.Mountain, 2);
    s.cells[2]![2]!.terrain = { type: TerrainType.Mountain, elevation: 2, corners: ['fan', 'square', 'square', 'square'] };
    const c = cellCornerWorld(2, 2, 5, 5, PLACEMENT_GRID);
    const x0 = c.x - 0.5, z0 = c.z - 0.5;
    const m = buildChunkTerrain(s, 0, 0);
    const waterY = waterSurfaceY(2);
    const waterAtCentre = (() => {
      for (let i = 0; i < m.water.positions.length; i += 3) {
        if (Math.abs(m.water.positions[i]! - (x0 + 0.5)) < 1e-4 && Math.abs(m.water.positions[i + 1]! - waterY) < 0.02 && Math.abs(
          m.water.positions[i + 2]! - (z0 + 0.5),
        ) < 1e-4) return true;
      }
      return false;
    })();
    expect(waterAtCentre, 'no full-block water over the mountain islet').toBe(false);
    const solidAtCentre = (() => {
      for (let i = 0; i < m.solid.positions.length; i += 3) {
        if (Math.abs(m.solid.positions[i]! - (x0 + 0.5)) < 1e-4 && Math.abs(m.solid.positions[i + 2]! - (z0 + 0.5)) < 1e-4) return true;
      }
      return false;
    })();
    expect(solidAtCentre, 'mountain fan keeps the cell centre').toBe(true);
  });
});
