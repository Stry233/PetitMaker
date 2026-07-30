import { describe, it, expect } from 'vitest';
import { buildTerrainMeshes, waterSwellWeights } from '../../canvas/map3d/build/terrain-geometry';
import { TERRAIN_OFFSET, layerToY, cellCornerWorld } from '../../canvas/map3d/core/coords';
import { CellZone, TerrainType } from '../../core/model/types';

/** Count horizontal top-face triangles at world height `y` whose every vertex lies inside the
 *  [x0,x0+1]×[z0,z0+1] cell footprint (so a backing step shows up but neighbour tops don't). */
function topTrisInFootprint(mesh: { positions: number[]; index: number[] }, y: number, x0: number, z0: number): number {
  const p = mesh.positions, idx = mesh.index;
  const inFoot = (vi: number) => p[vi * 3]! >= x0 - 1e-6 && p[vi * 3]! <= x0 + 1 + 1e-6 && p[vi * 3 + 2]! >= z0 - 1e-6 && p[vi * 3 + 2]! <= z0 + 1 + 1e-6;
  let n = 0;
  for (let t = 0; t < idx.length; t += 3) {
    const [a, b, c] = [idx[t]!, idx[t + 1]!, idx[t + 2]!];
    if ([a, b, c].every((vi) => Math.abs(p[vi * 3 + 1]! - y) < 1e-6 && inFoot(vi))) n++;
  }
  return n;
}

/** Smallest X over a flat [x,y,z,...] positions array. */
function minX(positions: number[]): number {
  let m = Infinity;
  for (let i = 0; i < positions.length; i += 3) m = Math.min(m, positions[i]!);
  return m;
}
import type { GridState, MacroCell, MapTemplate, CornerTrim } from '../../core/model/types';

function gridFrom(rows: MacroCell[][]): GridState {
  const template: MapTemplate = {
    id: 't', name: { en: 't' }, width: rows[0]!.length, height: rows.length,
    zones: rows.map((r) => r.map((c) => c.zone)),
    plaza: { x: 0, y: 0, width: 0, height: 0, elevation: 0 },
  };
  return { template, cells: rows, objects: new Map(), lockedLayers: new Set() };
}
const grass = (): MacroCell => ({ zone: CellZone.Grass, terrain: null });
const mtn = (e: number): MacroCell => ({ zone: CellZone.Grass, terrain: { type: TerrainType.Mountain, elevation: e } });

describe('preview3d/terrain-geometry', () => {
  it('emits no solid geometry for an all-flat grass grid', () => {
    const m = buildTerrainMeshes(gridFrom([[grass(), grass()], [grass(), grass()]]));
    expect(m.solid.positions.length).toBe(0);
    // every non-void cell still gets a ground slab (4 cells × 4 verts)
    expect(m.ground.positions.length).toBeGreaterThan(0);
  });

  it('a lone mtn(2) emits a top face + 4 walls, each wall split into 2 layer strata (9 quads = 36 verts, 54 indices)', () => {
    const m = buildTerrainMeshes(gridFrom([[mtn(2)]]));
    // top (1 quad) + 4 sides × 2 elevation strata (layers 1,2) = 9 quads.
    expect(m.solid.positions.length / 3).toBe(36); // 9 quads × 4 verts
    expect(m.solid.index.length).toBe(54);          // 9 quads × 6 indices
  });

  it('culls the shared wall between two equal-height neighbors (per-layer strata)', () => {
    // two adjacent mtn(2): each emits top (1) + 3 exposed walls × 2 strata = 7
    // quads (the shared wall is culled both ways) → 14 quads total = 56 verts.
    const m = buildTerrainMeshes(gridFrom([[mtn(2), mtn(2)]]));
    expect(m.solid.positions.length / 3).toBe(56);
  });

  it('all-square corners take the fast path (identical to no corners)', () => {
    const sq = (): MacroCell => ({ zone: CellZone.Grass, terrain: { type: TerrainType.Mountain, elevation: 1, corners: ['square', 'square', 'square', 'square'] } });
    const a = buildTerrainMeshes(gridFrom([[mtn(1)]]));
    const b = buildTerrainMeshes(gridFrom([[sq()]]));
    expect(b.solid.positions.length).toBe(a.solid.positions.length);
  });

  it('a trimmed cell honours the edge-cut: an empty corner drops that quadrant', () => {
    const full = (): MacroCell => ({ zone: CellZone.Grass, terrain: { type: TerrainType.Mountain, elevation: 1, corners: ['tri-NW', 'square', 'square', 'square'] } });
    const cut = (): MacroCell => ({ zone: CellZone.Grass, terrain: { type: TerrainType.Mountain, elevation: 1, corners: ['empty', 'square', 'square', 'square'] } });
    const f = buildTerrainMeshes(gridFrom([[full()]]));
    const c = buildTerrainMeshes(gridFrom([[cut()]]));
    // both take the bevel path and emit geometry; the empty corner yields strictly less.
    expect(c.solid.positions.length).toBeGreaterThan(0);
    expect(c.solid.positions.length).toBeLessThan(f.solid.positions.length);
  });

  it('a cut mountain corner over a lower step is BACKED by that step (no hole) — mirrors 2D cut-backing', () => {
    // Cut cell mtn(2) at (1,1) with its TL corner rounded (an OUT-corner cut); the cells left + above it
    // are mtn(1), so the TL corner reveals tier 1. The fix backs the cut quadrant with a tier-1 top (a step
    // down) instead of leaving an open hole. A full-square mtn(2) in the same spot has NO tier-1 top.
    const cut = (): MacroCell => ({ zone: CellZone.Grass, terrain: { type: TerrainType.Mountain, elevation: 2, corners: ['fan', 'square', 'square', 'square'] } });
    const cutMeshes = buildTerrainMeshes(gridFrom([[mtn(1), mtn(1)], [mtn(1), cut()]]));
    const ctrlMeshes = buildTerrainMeshes(gridFrom([[mtn(1), mtn(1)], [mtn(1), mtn(2)]]));
    const c0 = cellCornerWorld(1, 1, 2, 2);
    const fx0 = c0.x + TERRAIN_OFFSET, fz0 = c0.z + TERRAIN_OFFSET, yB = layerToY(1);
    expect(topTrisInFootprint(cutMeshes.solid, yB, fx0, fz0), 'cut quadrant backed by a tier-1 step').toBeGreaterThan(0);
    expect(topTrisInFootprint(ctrlMeshes.solid, yB, fx0, fz0), 'a full square cell has no tier-1 top in its footprint').toBe(0);
  });

  it('a from-empty Γ (gamma) patch (patchBase 0) has no base — only the fillet renders, notch stays empty', () => {
    // A from-empty gamma is cosmetic (patchBase 0): the fillet renders at its tier, but there is no base
    // block at any quadrant. Patch mtn(3) fillet in the notch (1,1) of an L-shaped tier-3 mass.
    const patch = (): MacroCell => ({ zone: CellZone.Grass, terrain: { type: TerrainType.Mountain, elevation: 3, patchOnly: true, patchBase: 0, corners: ['fan', 'empty', 'empty', 'empty'] } });
    const m = buildTerrainMeshes(gridFrom([[mtn(3), mtn(3)], [mtn(3), patch()]]));
    const c0 = cellCornerWorld(1, 1, 2, 2);
    const fx0 = c0.x + TERRAIN_OFFSET, fz0 = c0.z + TERRAIN_OFFSET;
    // Every horizontal top-face triangle that lies ENTIRELY inside the patch cell must sit in its TL (fan)
    // quadrant — the three empty quadrants carry no geometry. (Whole-triangle scoping excludes neighbour
    // tops that merely touch the shared footprint edge.)
    const p = m.solid.positions, idx = m.solid.index;
    const inFoot = (v: number) => p[v * 3]! >= fx0 - 1e-6 && p[v * 3]! <= fx0 + 1 + 1e-6 && p[v * 3 + 2]! >= fz0 - 1e-6 && p[v * 3 + 2]! <= fz0 + 1 + 1e-6;
    const inTL = (v: number) => p[v * 3]! <= fx0 + 0.5 + 1e-6 && p[v * 3 + 2]! <= fz0 + 0.5 + 1e-6;
    for (let t = 0; t < idx.length; t += 3) {
      const vs = [idx[t]!, idx[t + 1]!, idx[t + 2]!];
      const horizontal = Math.abs(p[vs[0]! * 3 + 1]! - p[vs[1]! * 3 + 1]!) < 1e-6 && Math.abs(p[vs[1]! * 3 + 1]! - p[vs[2]! * 3 + 1]!) < 1e-6;
      if (!horizontal || !vs.every(inFoot)) continue;
      expect(vs.every(inTL), 'a backing block leaked into an empty notch corner of the gamma patch').toBe(true);
    }
  });

  it('a ground-island cut (type None + corners) keeps the full grass floor and reveals water at the cut', () => {
    const w0 = (): MacroCell => ({ zone: CellZone.Grass, terrain: { type: TerrainType.Water, elevation: 0 } });
    const island = (corners: ['square' | 'fan', 'square', 'square', 'square']): MacroCell =>
      ({ zone: CellZone.Grass, terrain: { type: TerrainType.None, elevation: 0, corners } });
    // The concave inner corner of an L pool: water on two edges, a grass cell whose TL corner is cut.
    const withCut = buildTerrainMeshes(gridFrom([[w0(), w0()], [w0(), island(['fan', 'square', 'square', 'square'])]]));
    const noCut = buildTerrainMeshes(gridFrom([[w0(), w0()], [w0(), island(['square', 'square', 'square', 'square'])]]));
    // The cut must NOT carve the grass slab: the macro grass floor is identical whether or not the
    // corner is cut.
    expect(withCut.ground.positions.length).toBe(noCut.ground.positions.length);
    // The cut instead OPENS onto the water it sits in — a reveal the uncut cell has no reason to draw.
    expect(withCut.water.positions.length).toBeGreaterThan(noCut.water.positions.length);
    // It reads as ground — no mountain solid.
    expect(withCut.solid.positions.length).toBe(0);
  });

  const water = (e: number, corners?: [CornerTrim, CornerTrim, CornerTrim, CornerTrim]): MacroCell =>
    ({ zone: CellZone.Grass, terrain: { type: TerrainType.Water, elevation: e, ...(corners ? { corners } : {}) } });

  it('all-square water corners take the fast path (identical to no corners)', () => {
    const a = buildTerrainMeshes(gridFrom([[water(1)]]));
    const b = buildTerrainMeshes(gridFrom([[water(1, ['square', 'square', 'square', 'square'])]]));
    expect(b.water.positions.length).toBe(a.water.positions.length);
    expect(b.fall.positions.length).toBe(a.fall.positions.length);
  });

  it('a trimmed water cell honours the edge-cut: the water surface follows the cut, unlike the full square', () => {
    // Before the fix the water branch ignored t.corners, so a cut produced the SAME full-square
    // surface as no cut. A real cut must reshape the translucent water footprint.
    const square = buildTerrainMeshes(gridFrom([[water(0, ['square', 'square', 'square', 'square'])]]));
    const cut = buildTerrainMeshes(gridFrom([[water(0, ['fan', 'square', 'square', 'square'])]]));
    expect(cut.water.positions.length).not.toBe(square.water.positions.length);
  });

  it('an empty water corner drops that quadrant (strictly less surface than a triangle cut)', () => {
    const tri = buildTerrainMeshes(gridFrom([[water(0, ['tri-NW', 'square', 'square', 'square'])]]));
    const gone = buildTerrainMeshes(gridFrom([[water(0, ['empty', 'square', 'square', 'square'])]]));
    expect(gone.water.positions.length).toBeGreaterThan(0);
    expect(gone.water.positions.length).toBeLessThan(tri.water.positions.length);
  });

  it('an elevated trimmed pond routes its tall cut faces to the animated fall mesh', () => {
    // e=1 → yTop ≥ FALL_MIN, so exposed faces are cascades (fall mesh). The fan corner creates a
    // new exposed cut face that must fall, just like a square pond rim does.
    const square = buildTerrainMeshes(gridFrom([[water(1)]]));
    const cut = buildTerrainMeshes(gridFrom([[water(1, ['fan', 'square', 'square', 'square'])]]));
    expect(square.fall.positions.length).toBeGreaterThan(0); // a lone pond's 4 rims fall
    expect(cut.fall.positions.length).toBeGreaterThan(0);     // the cut face also falls
  });

  const wallVerts = (m: ReturnType<typeof buildTerrainMeshes>) => m.water.positions.length + m.fall.positions.length;

  it('a fan water corner produces position-invariant walls (no float-epsilon phantom mid-line seams)', () => {
    // fanPoly's arc endpoints must land EXACTLY on the grid so a fan quadrant's straight edges cancel
    // against square siblings. If they are ~1e-16 off, cells near the map CENTRE (where the residue
    // survives double precision) sprout phantom interior walls down their mid-lines while off-centre
    // cells don't — so the same cell renders differently by position. Walls must be translation-invariant.
    const fan: MacroCell = { zone: CellZone.Grass, terrain: { type: TerrainType.Water, elevation: 1, corners: ['fan', 'square', 'square', 'square'] } };
    const atCentre = buildTerrainMeshes(gridFrom([[fan]])); // straddles the map centre (|mx| < 1.5)
    const offRow: MacroCell[] = [];
    for (let i = 0; i < 9; i++) offRow.push(i === 8 ? fan : grass()); // far from centre (|mx| ≈ 3.5)
    const offCentre = buildTerrainMeshes(gridFrom([offRow]));
    expect(wallVerts(atCentre)).toBe(wallVerts(offCentre));
  });

  it('a patchOnly inner-fan rim is cull-tested exactly (finding-2: side classification is float-exact)', () => {
    // A Γ-patch (inner) fan's straight edges lie on CELL SIDES and must get the rim neighbour-cull. The
    // same fanPoly endpoint snap keeps those endpoints exact so the `=== x0` side test matches; otherwise
    // a patch on the float-fragile centre column draws a phantom rim THROUGH its equal/taller water
    // neighbour. Body+patch topology is identical in both grids, so any delta is purely that float bug.
    const body: MacroCell = { zone: CellZone.Grass, terrain: { type: TerrainType.Water, elevation: 2 } };
    const patch: MacroCell = { zone: CellZone.Grass, terrain: { type: TerrainType.Water, elevation: 2, patchOnly: true, corners: ['fan', 'square', 'square', 'square'] } };
    const fragile = buildTerrainMeshes(gridFrom([[grass(), body, patch]])); // patch at cx=2 → its left side lands on world x=0
    const safeRow: MacroCell[] = [];
    for (let i = 0; i < 11; i++) safeRow.push(i === 10 ? patch : i === 9 ? body : grass()); // same pair, far from centre
    const safe = buildTerrainMeshes(gridFrom([safeRow]));
    expect(wallVerts(fragile)).toBe(wallVerts(safe));
  });

  it('terrain is shifted onto the micro grid (TERRAIN_OFFSET) relative to the macro zone slab', () => {
    // one grass+mountain cell: the zone slab is macro-aligned, the mountain block
    // is shifted by TERRAIN_OFFSET (mirrors 2D's −HALF_TILE), so it stays inset.
    const m = buildTerrainMeshes(gridFrom([[mtn(1)]]));
    expect(minX(m.solid.positions)).toBeCloseTo(minX(m.ground.positions) + TERRAIN_OFFSET);
  });

  it('a void cell produces a translucent sea surface + an opaque deep floor (water has thickness)', () => {
    const void_: MacroCell = { zone: CellZone.Void, terrain: null };
    const m = buildTerrainMeshes(gridFrom([[void_]]));
    expect(m.water.positions.length).toBeGreaterThan(0);  // surface + map-edge depth walls
    expect(m.ground.positions.length).toBeGreaterThan(0); // opaque deep-sea floor
  });
});

describe('waterSwellWeights', () => {
  const water = (e = 0): MacroCell => ({ zone: CellZone.Grass, terrain: { type: TerrainType.Water, elevation: e } });
  const void_ = (): MacroCell => ({ zone: CellZone.Void, terrain: null });
  const EPS = 1e-4;

  /** Cell-space (micro-grid) coords of water-mesh vertex i. */
  const microCoord = (positions: number[], i: number, width: number, height: number) => {
    const off = { x: width / 2, z: height / 2 };
    return {
      cx: positions[i * 3]! + off.x - TERRAIN_OFFSET,
      py: positions[i * 3 + 1]!,
      cz: positions[i * 3 + 2]! + off.z - TERRAIN_OFFSET,
    };
  };

  it('a lake surface sways only strictly inside its outline — the waterline stays pinned', () => {
    // 5×5 grass with a 3×3 ground-level lake at cells (1..3, 1..3). The lake's
    // surface spans [1,4]×[1,4] in cell space; the only interior grid corners
    // (shared by four water cells) are at 2 and 3 on each axis.
    const rows = Array.from({ length: 5 }, (_, y) =>
      Array.from({ length: 5 }, (_, x) => (x >= 1 && x <= 3 && y >= 1 && y <= 3 ? water() : grass())));
    const state = gridFrom(rows);
    const m = buildTerrainMeshes(state);
    const w = waterSwellWeights(state, m.water.positions);
    expect(w.length).toBe(m.water.positions.length / 3);

    const top = Math.max(layerToY(0) + 0.05, 0.08 + 0.02); // ground-level lake surface height
    let interior = 0;
    for (let i = 0; i < w.length; i++) {
      const { cx, py, cz } = microCoord(m.water.positions, i, 5, 5);
      const inside = Math.abs(py - top) < EPS
        && cx > 1 + EPS && cx < 4 - EPS && cz > 1 + EPS && cz < 4 - EPS;
      expect(w[i]).toBe(inside ? 1 : 0);
      if (inside) interior++;
    }
    expect(interior).toBeGreaterThan(0); // the interior corners exist and sway
  });

  it('pins every vertex that touches a trimmed water cell (its outline is the body boundary)', () => {
    const rows = Array.from({ length: 5 }, (_, y) =>
      Array.from({ length: 5 }, (_, x) => (x >= 1 && x <= 3 && y >= 1 && y <= 3 ? water() : grass())));
    const trims: [CornerTrim, CornerTrim, CornerTrim, CornerTrim] = ['fan', 'square', 'square', 'square'];
    rows[1]![1] = { zone: CellZone.Grass, terrain: { type: TerrainType.Water, elevation: 0, corners: trims } };
    const state = gridFrom(rows);
    const m = buildTerrainMeshes(state);
    const w = waterSwellWeights(state, m.water.positions);

    let stillSwaying = 0;
    for (let i = 0; i < w.length; i++) {
      const { cx, cz } = microCoord(m.water.positions, i, 5, 5);
      // corner (2,2) touches the trimmed cell (1,1) → pinned; (3,3)/(2,3)/(3,2) still sway
      if (Math.abs(cx - 2) < EPS && Math.abs(cz - 2) < EPS) expect(w[i]).toBe(0);
      if (w[i] === 1) stillSwaying++;
    }
    expect(stillSwaying).toBeGreaterThan(0);
  });

  it('the sea sways only where all four touching cells are sea — shorelines and map edges stay pinned', () => {
    // 4×4 all-Void except one grass cell at (0,0). Sea quads sit on the MACRO grid.
    const rows = Array.from({ length: 4 }, (_, y) =>
      Array.from({ length: 4 }, (_, x) => (x === 0 && y === 0 ? grass() : void_())));
    const state = gridFrom(rows);
    const m = buildTerrainMeshes(state);
    const w = waterSwellWeights(state, m.water.positions);

    const off = 2; // 4/2 — macro grid, no terrain offset
    const at = (i: number) => ({
      gx: m.water.positions[i * 3]! + off,
      py: m.water.positions[i * 3 + 1]!,
      gz: m.water.positions[i * 3 + 2]! + off,
    });
    let interior = 0;
    for (let i = 0; i < w.length; i++) {
      const { gx, py, gz } = at(i);
      // Interior corners: strictly inside the map AND not touching the grass cell.
      const insideMap = gx > EPS && gx < 4 - EPS && gz > EPS && gz < 4 - EPS;
      const touchesGrass = gx < 1 + EPS && gz < 1 + EPS;
      const inside = Math.abs(py - 0.05) < EPS && insideMap && !touchesGrass;
      expect(w[i]).toBe(inside ? 1 : 0);
      if (inside) interior++;
    }
    expect(interior).toBeGreaterThan(0);
  });
});
