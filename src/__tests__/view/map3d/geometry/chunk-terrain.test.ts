/**
 * The per-chunk terrain mesher: the 3D editor rebuilds only edited chunks, so after an edit the
 * chunks it dirtied, rebuilt, must give the geometry (as a set) a fresh build of the edited map
 * gives. Cells only read their neighbors through GridState, never sibling meshes, so partitioning
 * cannot change what a cell emits.
 */
import { describe, it, expect } from 'vitest';
import { buildChunkTerrain } from '../../../../view/map3d/geometry/terrain-geometry';
import { dirtyChunksFor } from '../../../../view/map3d/geometry/chunk-dirty';
import { chunkKey } from '../../../../core/grid/rect';
import type { TerrainMeshes } from '../../../../view/map3d/geometry/types';
import { TerrainType } from '../../../../core/model/types';
import { CellZone } from '../../../../core/game/zones';
import type { GridState, MacroCell, MapTemplate, CornerTrim } from '../../../../core/model/types';
import { BUCKET_SIZE } from '../../../../core/grid/buckets';

function gridFrom(rows: MacroCell[][]): GridState {
  const template: MapTemplate = {
    id: 't', name: { en: 't' }, width: rows[0]!.length, height: rows.length,
    zones: rows.map((r) => r.map((c) => c.zone)),
    landmarks: [],
  };
  return { template, cells: rows, objects: new Map(), objectsVersion: 0, cellsVersion: 0, lockedLayers: new Set() };
}

/** A 40×24 state exercising every mesher branch across chunk borders: sea,
 *  shoreline skirts, mountains (stacked + trimmed), water tiers, a waterfall
 *  face, a ground islet cut, a Γ patch. */
function mixedState(): GridState {
  const W = 40, H = 24;
  const rows: MacroCell[][] = Array.from({ length: H }, (_, y) =>
    Array.from({ length: W }, (_, x) => ({
      zone: (x < 3 || y < 2) ? CellZone.Void : CellZone.Grass,
      terrain: null,
    })));
  const trims = (a: CornerTrim, b: CornerTrim, c: CornerTrim, d: CornerTrim): [CornerTrim, CornerTrim, CornerTrim, CornerTrim] => [a, b, c, d];
  // mountain massif straddling the chunk border at x=16
  for (let y = 6; y <= 10; y++) for (let x = 14; x <= 19; x++) {
    rows[y]![x]!.terrain = { type: TerrainType.Mountain, elevation: x < 17 ? 2 : 3 };
  }
  rows[7]![14]!.terrain = { type: TerrainType.Mountain, elevation: 2, corners: trims('fan', 'square', 'square', 'square') };
  // elevated water pond + a fall face at its rim
  for (let x = 15; x <= 17; x++) rows[8]![x]!.terrain = { type: TerrainType.Water, elevation: 2 };
  // ground-level river crossing chunk rows
  for (let y = 14; y <= 15; y++) for (let x = 5; x <= 30; x++) {
    rows[y]![x]!.terrain = { type: TerrainType.Water, elevation: 0 };
  }
  // ground islet cut in the river
  rows[14]![12]!.terrain = { type: TerrainType.None, elevation: 0, corners: trims('fan', 'square', 'square', 'fan') };
  // Γ patch (fillet over a lower base)
  rows[6]![15]!.terrain = { type: TerrainType.Mountain, elevation: 3, corners: trims('square', 'fan', 'square', 'square'), patchOnly: true };
  return rows && gridFrom(rows);
}

/** Sort a positions array as vertex triples for order-independent comparison. */
function sortedTriples(positions: number[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < positions.length; i += 3) {
    out.push(`${positions[i]!.toFixed(5)},${positions[i + 1]!.toFixed(5)},${positions[i + 2]!.toFixed(5)}`);
  }
  return out.sort();
}

describe('buildChunkTerrain', () => {
  it('an edit across chunk borders, its dirty chunks rebuilt, meshes as the edited map built fresh', () => {
    const state = mixedState();
    const { width, height } = state.template;
    const chunksX = Math.ceil(width / BUCKET_SIZE), chunksY = Math.ceil(height / BUCKET_SIZE);
    const buildAll = (): Map<string, TerrainMeshes> => {
      const out = new Map<string, TerrainMeshes>();
      for (let cy = 0; cy < chunksY; cy++) for (let cx = 0; cx < chunksX; cx++) out.set(chunkKey(cx, cy), buildChunkTerrain(state, cx, cy));
      return out;
    };
    const kept = buildAll();
    // Raise the pond's rim and drain the river where both cross the border between chunk columns.
    const edited = [{ x: 15, y: 8 }, { x: 16, y: 8 }, { x: 15, y: 14 }, { x: 16, y: 14 }, { x: 16, y: 15 }];
    state.cells[8]![15]!.terrain = { type: TerrainType.Mountain, elevation: 3 };
    state.cells[8]![16]!.terrain = { type: TerrainType.Mountain, elevation: 3 };
    for (const { x, y } of edited.slice(2)) state.cells[y]![x]!.terrain = null;
    for (const key of dirtyChunksFor(edited, width, height)) {
      const [cx, cy] = key.split(',').map(Number) as [number, number];
      kept.set(key, buildChunkTerrain(state, cx, cy));
    }
    const fresh = buildAll();
    for (const kind of ['solid', 'ground', 'water', 'fall'] as const) {
      const of = (chunks: Map<string, TerrainMeshes>) => sortedTriples([...chunks.values()].flatMap((m) => m[kind].positions));
      expect(of(kept), `${kind} geometry set`).toEqual(of(fresh));
    }
  });

  it('an out-of-map chunk is empty; a partial edge chunk clips to the map', () => {
    const state = mixedState();
    const far = buildChunkTerrain(state, 99, 99);
    expect(far.solid.positions.length + far.ground.positions.length + far.water.positions.length).toBe(0);
    const edge = buildChunkTerrain(state, 2, 1); // covers x 32..39, y 16..23 (clipped at 40×24)
    expect(edge.ground.positions.length).toBeGreaterThan(0);
  });
});
