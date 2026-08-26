/**
 * A surface drape follows the surface the terrain mesher actually built — trims included.
 *
 * The invariant every case here checks is the same one: take each decal triangle's centroid, ask the
 * TERRAIN MESH what its topmost horizontal face at that point is, and require the decal to sit
 * exactly DECAL_LIFT above it. A cut corner is rounded away and the surface there is whatever the
 * cut opened onto, so a decal that reads the cell's top and covers the whole square hangs in the air
 * over every trim — which is what the region highlight did.
 */
import { describe, it, expect } from 'vitest';
import { cellDecals, rectDecals, DECAL_LIFT } from '../../canvas/map3d/build/overlay-decals';
import { cellSurfacePieces, spanCellCentres } from '../../canvas/map3d/build/surface-pieces';
import { buildTerrainMeshes } from '../../canvas/map3d/build/terrain-geometry';
import { GROUND_SLAB_Y, layerToY, mapCenterOffset, waterSurfaceY } from '../../canvas/map3d/core/coords';
import { TerrainType, type Corners, type GridState } from '../../core/model/types';
import { makeState, setTerrain } from '../rules/_helpers';

/** The mesher's own output shape, as this file reads it. */
interface Mesh { positions: number[]; index: number[] }

/** The topmost HORIZONTAL mesh face over (px, pz) — what a viewer looking down sees there. Walls
 *  have two heights per triangle and are skipped; ground/water/solid tops are all flat. */
function meshSurfaceAt(meshes: readonly Mesh[], px: number, pz: number): number | null {
  let best: number | null = null;
  for (const m of meshes) {
    for (let t = 0; t < m.index.length; t += 3) {
      const v = [m.index[t]!, m.index[t + 1]!, m.index[t + 2]!].map((i) => [m.positions[i * 3]!, m.positions[i * 3 + 1]!, m.positions[i * 3 + 2]!] as const);
      const y = v[0]![1];
      if (Math.abs(v[1]![1] - y) > 1e-9 || Math.abs(v[2]![1] - y) > 1e-9) continue;
      if (!inTriangle(px, pz, v[0]!, v[1]!, v[2]!)) continue;
      if (best === null || y > best) best = y;
    }
  }
  return best;
}

function inTriangle(px: number, pz: number, a: readonly number[], b: readonly number[], c: readonly number[]): boolean {
  const side = (p: readonly number[], q: readonly number[]) => (q[0]! - p[0]!) * (pz - p[2]!) - (q[2]! - p[2]!) * (px - p[0]!);
  const s1 = side(a, b), s2 = side(b, c), s3 = side(c, a);
  const neg = s1 < -1e-12 || s2 < -1e-12 || s3 < -1e-12;
  const pos = s1 > 1e-12 || s2 > 1e-12 || s3 > 1e-12;
  return !(neg && pos);
}

/** Every decal triangle's centroid + the height it was drawn at. */
function centroids(m: Mesh): Array<{ x: number; z: number; y: number }> {
  const out: Array<{ x: number; z: number; y: number }> = [];
  for (let t = 0; t < m.index.length; t += 3) {
    const v = [m.index[t]!, m.index[t + 1]!, m.index[t + 2]!].map((i) => [m.positions[i * 3]!, m.positions[i * 3 + 1]!, m.positions[i * 3 + 2]!] as const);
    out.push({
      x: (v[0]![0] + v[1]![0] + v[2]![0]) / 3,
      z: (v[0]![2] + v[1]![2] + v[2]![2]) / 3,
      y: (v[0]![1] + v[1]![1] + v[2]![1]) / 3,
    });
  }
  return out;
}

/** Assert every triangle of `decal` lies exactly one DECAL_LIFT over the mesh under it. */
function expectDraped(state: GridState, decal: Mesh): void {
  const t = buildTerrainMeshes(state);
  const meshes = [t.solid, t.ground, t.water, t.fall];
  const floating: string[] = [];
  for (const c of centroids(decal)) {
    const surface = meshSurfaceAt(meshes, c.x, c.z);
    if (surface === null) { floating.push(`(${c.x.toFixed(2)},${c.z.toFixed(2)}) over nothing`); continue; }
    if (Math.abs(c.y - (surface + DECAL_LIFT)) > 1e-6) {
      floating.push(`(${c.x.toFixed(2)},${c.z.toFixed(2)}) decal ${c.y.toFixed(3)} vs surface ${surface.toFixed(3)}`);
    }
  }
  expect(floating).toEqual([]);
}

function cut(state: GridState, x: number, y: number, corners: Corners, extra: Record<string, unknown> = {}): void {
  const cell = state.cells[y]![x]!;
  cell.terrain = { ...cell.terrain!, corners, ...extra } as typeof cell.terrain;
}

/** The world origin of terrain cell (x, y) — the same one `cellDecals(…, true)` places it at. */
function origin(state: GridState, x: number, y: number): [number, number] {
  const off = mapCenterOffset(state.template.width, state.template.height);
  return [x - off.x - 0.5, y - off.z - 0.5];
}

/** The distinct heights a decal was drawn at, rounded to the millimetre. */
function heights(m: Mesh): number[] {
  const s = new Set<number>();
  for (let i = 1; i < m.positions.length; i += 3) s.add(Math.round(m.positions[i]! * 1000) / 1000);
  return [...s].sort((a, b) => a - b);
}

describe('a drape over trimmed terrain', () => {
  it('drops into a cut corner instead of hanging over it (a rounded pillar)', () => {
    const s = makeState(20, 20) as GridState;
    setTerrain(s, 5, 5, TerrainType.Mountain, 2);
    cut(s, 5, 5, ['fan', 'fan', 'fan', 'fan']);
    const decal = cellDecals(s, [{ x: 5, y: 5 }], true);
    // The four rounded-away corners show the grass the pillar stands on; the kept fans its own top.
    expect(heights(decal)).toEqual([
      Math.round((GROUND_SLAB_Y + DECAL_LIFT) * 1000) / 1000,
      Math.round((layerToY(2) + DECAL_LIFT) * 1000) / 1000,
    ]);
    expectDraped(s, decal);
  });

  it('lands on the step a terrace cut reveals, not on the tier above it', () => {
    const s = makeState(20, 20) as GridState;
    for (let y = 4; y <= 8; y++) for (let x = 4; x <= 8; x++) setTerrain(s, x, y, TerrainType.Mountain, 1);
    for (let y = 5; y <= 7; y++) for (let x = 5; x <= 7; x++) setTerrain(s, x, y, TerrainType.Mountain, 2);
    cut(s, 5, 5, ['fan', 'square', 'square', 'square']);
    const decal = cellDecals(s, [{ x: 5, y: 5 }], true);
    expect(heights(decal)).toContain(Math.round((layerToY(1) + DECAL_LIFT) * 1000) / 1000);
    expectDraped(s, decal);
  });

  it('splits a Γ patch between its fillet tier and the ground under the rest', () => {
    const s = makeState(20, 20) as GridState;
    // An L of tier-2 mass wrapping the TL corner of (5,5): the two edges plus the diagonal.
    setTerrain(s, 4, 5, TerrainType.Mountain, 2);
    setTerrain(s, 5, 4, TerrainType.Mountain, 2);
    setTerrain(s, 4, 4, TerrainType.Mountain, 2);
    setTerrain(s, 5, 5, TerrainType.Mountain, 2);
    cut(s, 5, 5, ['fan', 'empty', 'empty', 'empty'], { patchOnly: true, patchBase: 0 });
    const decal = cellDecals(s, [{ x: 5, y: 5 }], true);
    expect(heights(decal)).toEqual([
      Math.round((GROUND_SLAB_Y + DECAL_LIFT) * 1000) / 1000,
      Math.round((layerToY(2) + DECAL_LIFT) * 1000) / 1000,
    ]);
    expectDraped(s, decal);
  });

  it('lies ON a ground-level pool, not inside it', () => {
    const s = makeState(20, 20) as GridState;
    for (let y = 4; y <= 6; y++) for (let x = 4; x <= 6; x++) setTerrain(s, x, y, TerrainType.Water, 0);
    const decal = cellDecals(s, [{ x: 5, y: 5 }], true);
    expect(heights(decal)).toEqual([Math.round((waterSurfaceY(0) + DECAL_LIFT) * 1000) / 1000]);
    expectDraped(s, decal);
  });

  it('opens a cut water corner onto the mountain bank behind it', () => {
    const s = makeState(20, 20) as GridState;
    for (let y = 4; y <= 6; y++) for (let x = 4; x <= 6; x++) setTerrain(s, x, y, TerrainType.Water, 1);
    setTerrain(s, 4, 5, TerrainType.Mountain, 1);
    setTerrain(s, 5, 4, TerrainType.Mountain, 1);
    cut(s, 5, 5, ['fan', 'square', 'square', 'square']);
    const decal = cellDecals(s, [{ x: 5, y: 5 }], true);
    expect(heights(decal)).toContain(Math.round((layerToY(1) + DECAL_LIFT) * 1000) / 1000);
    expectDraped(s, decal);
  });

  it('keeps an untrimmed cell one quad, and never covers more than the cell', () => {
    const s = makeState(20, 20) as GridState;
    setTerrain(s, 5, 5, TerrainType.Mountain, 3);
    cut(s, 5, 5, ['fan', 'square', 'square', 'square']);
    const trimmed = cellDecals(s, [{ x: 5, y: 5 }], true);
    const [x0, z0] = origin(s, 5, 5);
    for (let i = 0; i < trimmed.positions.length; i += 3) {
      expect(trimmed.positions[i]!).toBeGreaterThanOrEqual(x0 - 1e-9);
      expect(trimmed.positions[i]!).toBeLessThanOrEqual(x0 + 1 + 1e-9);
      expect(trimmed.positions[i + 2]!).toBeGreaterThanOrEqual(z0 - 1e-9);
      expect(trimmed.positions[i + 2]!).toBeLessThanOrEqual(z0 + 1 + 1e-9);
    }
    setTerrain(s, 6, 5, TerrainType.Mountain, 3);
    expect(cellDecals(s, [{ x: 6, y: 5 }], true).positions.length).toBe(4 * 3);
  });

  it('a BODY takes the height of the piece its own centre stands on', () => {
    const s = makeState(20, 20) as GridState;
    setTerrain(s, 5, 5, TerrainType.Mountain, 2);
    cut(s, 5, 5, ['empty', 'empty', 'empty', 'empty']); // wholly rounded away: the cell shows grass
    const body = rectDecals(s, [{ x: 5, y: 5, w: 1, h: 1 }], true);
    expect(body.positions[1]!).toBeCloseTo(GROUND_SLAB_Y + DECAL_LIFT, 6);
  });

  it('samples every cell a footprint covers, fractional origin included', () => {
    // A half-grid anchor (the plaza, a ramp, a bridge): [3.5, 5.5) covers cells 3, 4 and 5, and the
    // partly-covered ends are sampled inside the part that is covered.
    expect(spanCellCentres(3.5, 2)).toEqual([3.75, 4.5, 5.25]);
    expect(spanCellCentres(3.5, 2).map(Math.floor)).toEqual([3, 4, 5]);
    expect(spanCellCentres(5, 3)).toEqual([5.5, 6.5, 7.5]);
    expect(spanCellCentres(5, 1)).toEqual([5.5]);
  });

  it('reports no pieces off the map, where there is no cell to read', () => {
    const s = makeState(20, 20) as GridState;
    expect(cellSurfacePieces(s, -1, -1, 0, 0)).toBeNull();
    // …and the decal still draws the border ring a brush may hang over.
    expect(cellDecals(s, [{ x: -1, y: -1 }], true).positions.length).toBe(4 * 3);
  });
});
