/**
 * The per-chunk terrain mesher: the 3D editor rebuilds only edited chunks, so
 * chunked output must be geometry-identical (as a set) to the whole-map mesher
 * on any state. Cells only read their neighbors through GridState, never
 * sibling meshes, so partitioning cannot change what a cell emits.
 */
import { describe, it, expect } from 'vitest';
import { buildTerrainMeshes, buildChunkTerrain } from '../../canvas/map3d/build/terrain-geometry';
import { CHUNK_SIZE } from '../../core/model/constants';
import { CellZone, TerrainType } from '../../core/model/types';
import type { GridState, MacroCell, MapTemplate, CornerTrim } from '../../core/model/types';

function gridFrom(rows: MacroCell[][]): GridState {
  const template: MapTemplate = {
    id: 't', name: { en: 't' }, width: rows[0]!.length, height: rows.length,
    zones: rows.map((r) => r.map((c) => c.zone)),
    plaza: { x: 0, y: 0, width: 0, height: 0, elevation: 0 },
  };
  return { template, cells: rows, objects: new Map(), lockedLayers: new Set() };
}

/** A 40×24 state exercising every mesher branch across chunk borders: sea,
 *  shoreline skirts, mountains (stacked + trimmed), water tiers, a waterfall
 *  face, a ground island cut, a Γ patch. */
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
  // ground island cut in the river
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
  it('the union of all chunks equals the whole-map mesher, mesh by mesh', () => {
    const state = mixedState();
    const whole = buildTerrainMeshes(state);
    const chunksX = Math.ceil(state.template.width / CHUNK_SIZE);
    const chunksY = Math.ceil(state.template.height / CHUNK_SIZE);
    const union = { solid: [] as number[], ground: [] as number[], water: [] as number[], fall: [] as number[] };
    for (let cy = 0; cy < chunksY; cy++) {
      for (let cx = 0; cx < chunksX; cx++) {
        const m = buildChunkTerrain(state, cx, cy);
        union.solid.push(...m.solid.positions);
        union.ground.push(...m.ground.positions);
        union.water.push(...m.water.positions);
        union.fall.push(...m.fall.positions);
      }
    }
    for (const key of ['solid', 'ground', 'water', 'fall'] as const) {
      expect(union[key].length, `${key} vertex count`).toBe(whole[key].positions.length);
      expect(sortedTriples(union[key]), `${key} geometry set`).toEqual(sortedTriples(whole[key].positions));
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
