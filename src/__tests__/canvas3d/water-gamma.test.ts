/**
 * A GROUND-ISLAND cut (the inner concave corner of an L-shaped water pool, and
 * any grass corner poking into water) must render on the SAME micro grid as the
 * water it sits in — mirroring 2D, where the None+corners cut draws at the
 * −HALF_TILE terrain offset over the full macro zone floor. The old mesher drew
 * it a half-cell off (macro grid) as a skirted island, so it floated detached
 * from the pool. Here we pin: the macro grass slab stays (no tiling gap) and the
 * revealed water lands on the micro grid, not the macro grid.
 */
import { describe, it, expect } from 'vitest';
import { buildChunkTerrain } from '../../canvas/map3d/build/terrain-geometry';
import { cellCornerWorld, GROUND_SLAB_Y, layerToY } from '../../canvas/map3d/core/coords';
import { TerrainType } from '../../core/model/types';
import type { GridState } from '../../core/model/types';
import { makeState, setTerrain } from '../rules/_helpers';

/** An L of water at (1,1),(2,1),(1,2) with (2,2) a grass island whose TL corner
 *  is cut (fan) to reveal the pool at the concave bend — the minimal repro of the
 *  L-pool inner corner. */
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

describe('ground-island cut (L-pool inner corner) alignment', () => {
  it('draws no coast-skirt false-cliff around a cut cell connected to grass', () => {
    const s = lPoolState();
    const c = cellCornerWorld(2, 2, 4, 4); // macro corner of the island cell
    const m = buildChunkTerrain(s, 0, 0);
    // The macro grass floor covers the cut cell at slab height (no gap).
    const topAtCorner: number[] = [];
    for (let i = 0; i < m.ground.positions.length; i += 3) {
      if (Math.abs(m.ground.positions[i]! - (c.x + 1)) < 1e-4 && Math.abs(m.ground.positions[i + 2]! - (c.z + 1)) < 1e-4) topAtCorner.push(m.ground.positions[i + 1]!);
    }
    expect(topAtCorner.some((y) => Math.abs(y - GROUND_SLAB_Y) < 1e-4), 'grass floor at the cut cell BR corner').toBe(true);
    // The old skirted island drove grass walls to GROUND_BOTTOM even on edges shared
    // with solid grass — a false detached cliff. A connected cut cell (no void/sea
    // neighbour) must produce none.
    let deep = 0;
    for (let i = 0; i < m.ground.positions.length; i += 3) {
      const x = m.ground.positions[i]!, y = m.ground.positions[i + 1]!, z = m.ground.positions[i + 2]!;
      if (Math.abs(y - -0.4) < 1e-4 && x > c.x - 0.6 && x < c.x + 1.1 && z > c.z - 0.6 && z < c.z + 1.1) deep++;
    }
    expect(deep, 'no coast skirt around the connected cut cell').toBe(0);
  });

  it('reveals the pool water on the MICRO grid, not the macro grid', () => {
    const s = lPoolState();
    const c = cellCornerWorld(2, 2, 4, 4);
    const m = buildChunkTerrain(s, 0, 0);
    // The old macro backing put a reveal quadrant at [c.x, c.x+0.5]×[c.z, c.z+0.5],
    // leaving a water vertex at the macro mid-cell corner. The micro-aligned reveal
    // (offset −0.5) never does. That vertex is unique to the buggy macro placement
    // (no pool cell reaches the island cell's +x/+z half).
    expect(has(m.water.positions, c.x + 0.5, c.z + 0.5), 'no water reveal on the macro grid').toBe(false);
    // The reveal lands at the micro TL corner of the cut cell (aligned with the pool).
    expect(has(m.water.positions, c.x - 0.5, c.z - 0.5), 'water reveal on the micro grid').toBe(true);
  });

  it('a cosmetic water Γ fillet (generator gamma, no real base) draws ONLY the fillet, not a full square', () => {
    // The generator emits patchOnly water fillets like [empty,empty,empty,fan] with patchBase
    // undefined → baseTier -1 (a cosmetic round over ground, no elevated pool beneath). 2D draws
    // no base body, just the wrapped corner's fillet over the grass floor. The old mesher flooded
    // the whole cell (emitSquareWater at the degenerate tier), inverting fill and empty.
    const s = makeState(6, 6) as GridState;
    // Water wrapping the BR corner of the patch cell, so patchCornerSplit sees it wrapped.
    setTerrain(s, 3, 2, TerrainType.Water, 0); // +x edge
    setTerrain(s, 2, 3, TerrainType.Water, 0); // +y edge
    setTerrain(s, 3, 3, TerrainType.Water, 0); // diagonal
    s.cells[2]![2]!.terrain = { type: TerrainType.Water, elevation: 0, patchOnly: true, corners: ['empty', 'empty', 'empty', 'fan'] };
    const c = cellCornerWorld(2, 2, 6, 6);
    const m = buildChunkTerrain(s, 0, 0);
    // The empty corners must stay grass: no water surface at the patch cell's micro TL corner
    // (which a flooding full-square base would occupy).
    expect(has(m.water.positions, c.x - 0.5, c.z - 0.5), 'no flood over the empty corner').toBe(false);
    // The fillet itself is present (some water in the BR quadrant).
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
    // A square reveal has only half-grid-aligned vertices; a fan reveal traces an arc with
    // off-grid points. The cut is a fan, so the reveal must curve — matching 2D's rounded corner.
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
    const c = cellCornerWorld(2, 2, 4, 4);
    const m = buildChunkTerrain(s, 0, 0);
    // The reveal's land-facing arc walls down to the floor. Its arc lies strictly INSIDE the cut
    // cell (the cell-side edges are interior to the pool and culled), so a near-floor water vertex
    // strictly inside the cell can only come from that shore wall — absent when the reveal is a
    // flat surface. (Pool-cell shore walls sit on cell boundaries, never strictly inside (2,2).)
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
    // fill only the rounded-off cap (revealPolygon), NOT a full quadrant — a full quadrant shows through
    // the translucent water and occludes the pool body so it reads as a thin surface (the reported bug).
    const s = makeState(5, 5) as GridState;
    setTerrain(s, 1, 2, TerrainType.Mountain, 2); // -x bank
    setTerrain(s, 2, 1, TerrainType.Mountain, 2); // -y bank
    setTerrain(s, 3, 2, TerrainType.Water, 2);
    setTerrain(s, 2, 3, TerrainType.Water, 2);
    s.cells[2]![2]!.terrain = { type: TerrainType.Water, elevation: 2, corners: ['fan', 'square', 'square', 'square'] };
    const c = cellCornerWorld(2, 2, 5, 5);
    const x0 = c.x - 0.5, z0 = c.z - 0.5;
    const m = buildChunkTerrain(s, 0, 0);
    const mtnY = layerToY(2);
    const solidAt = (x: number, z: number) => {
      for (let i = 0; i < m.solid.positions.length; i += 3) {
        if (Math.abs(m.solid.positions[i]! - x) < 1e-4 && Math.abs(m.solid.positions[i + 1]! - mtnY) < 0.02 && Math.abs(m.solid.positions[i + 2]! - z) < 1e-4) return true;
      }
      return false;
    };
    // A full-quadrant bank would put a mountain top at the cut cell's CENTER (the quadrant's inner
    // corner). The cut-away cap never reaches the center — the water body owns it.
    expect(solidAt(x0 + 0.5, z0 + 0.5), 'no full-quadrant bank at the water cell centre').toBe(false);
    // The bank IS present at the rounded-off outer corner.
    expect(solidAt(x0, z0), 'bank fills the cut-away corner').toBe(true);
  });

  it('a mountain ISLAND in an elevated pool reveals water only in the cut-away, not a full block over it', () => {
    // The concave inner corner of an elevated L-pool is a mountain@2 island whose corner rounds into the
    // water@2. The revealed water must fill only the rounded cap — a full-quadrant water surface sits ABOVE
    // the mountain fan (translucent) and covers the whole micro-block, hiding the terrain (the reported bug).
    const s = makeState(5, 5) as GridState;
    setTerrain(s, 1, 2, TerrainType.Water, 2);
    setTerrain(s, 2, 1, TerrainType.Water, 2);
    setTerrain(s, 3, 2, TerrainType.Mountain, 2);
    setTerrain(s, 2, 3, TerrainType.Mountain, 2);
    s.cells[2]![2]!.terrain = { type: TerrainType.Mountain, elevation: 2, corners: ['fan', 'square', 'square', 'square'] };
    const c = cellCornerWorld(2, 2, 5, 5);
    const x0 = c.x - 0.5, z0 = c.z - 0.5;
    const m = buildChunkTerrain(s, 0, 0);
    const waterY = Math.max(layerToY(2) + 0.05, 0.1);
    const waterAtCentre = (() => {
      for (let i = 0; i < m.water.positions.length; i += 3) {
        if (Math.abs(m.water.positions[i]! - (x0 + 0.5)) < 1e-4 && Math.abs(m.water.positions[i + 1]! - waterY) < 0.02 && Math.abs(m.water.positions[i + 2]! - (z0 + 0.5)) < 1e-4) return true;
      }
      return false;
    })();
    // The water reveal must NOT reach the cell centre — that belongs to the kept mountain fan.
    expect(waterAtCentre, 'no full-block water over the mountain island').toBe(false);
    // The mountain fan owns the cell centre.
    const solidAtCentre = (() => {
      for (let i = 0; i < m.solid.positions.length; i += 3) {
        if (Math.abs(m.solid.positions[i]! - (x0 + 0.5)) < 1e-4 && Math.abs(m.solid.positions[i + 2]! - (z0 + 0.5)) < 1e-4) return true;
      }
      return false;
    })();
    expect(solidAtCentre, 'mountain fan keeps the cell centre').toBe(true);
  });
});
