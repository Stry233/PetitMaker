import { describe, expect, it } from 'vitest';
import { BufferGeometry, DoubleSide, Float32BufferAttribute, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from 'three';
import { buildTerrainMeshes } from '../../canvas/map3d/build/terrain-geometry';
import type { MeshData } from '../../canvas/map3d/core/types';
import { GROUND_SLAB_Y, waterSurfaceY } from '../../canvas/map3d/core/coords';
import { pickSurface } from '../../canvas/map3d/interaction/pick';
import { TerrainType, type GridState } from '../../core/model/types';
import { makeState, setTerrain } from '../rules/_helpers';

function topAt(data: MeshData, x: number, z: number): number {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(data.positions, 3));
  geometry.setIndex(data.index);
  const material = new MeshBasicMaterial({ side: DoubleSide });
  const mesh = new Mesh(geometry, material);
  const hit = new Raycaster(new Vector3(x, 20, z), new Vector3(0, -1, 0)).intersectObject(mesh)[0];
  geometry.dispose();
  material.dispose();
  return hit?.point.y ?? -Infinity;
}

describe('recessed water banks', () => {
  it('opens the ground slab beneath a river across macro tile boundaries', () => {
    const state = makeState(8, 8) as GridState;
    setTerrain(state, 4, 4, TerrainType.Water, 0);
    setTerrain(state, 5, 4, TerrainType.Water, 0);
    const meshes = buildTerrainMeshes(state);
    for (const x of [-0.4, -0.1, 0.1, 0.4, 0.6, 1.1, 1.4]) {
      expect(topAt(meshes.ground, x, 0.1)).toBeLessThan(waterSurfaceY(0));
      expect(topAt(meshes.water, x, 0.1)).toBeCloseTo(waterSurfaceY(0));
      expect(topAt(meshes.ground, x, -0.6)).toBeCloseTo(GROUND_SLAB_Y);
    }
    const p = meshes.ground.positions;
    const bankHeights = p.filter((_, i) => i % 3 === 1 && Math.abs(p[i + 1]! + 0.5) < 1e-6);
    expect(Math.max(...bankHeights)).toBeCloseTo(GROUND_SLAB_Y);
    expect(Math.min(...bankHeights)).toBeLessThan(waterSurfaceY(0));
  });

  it.each(['pond', 'islet'])('keeps a rounded %s aligned with water and picking', kind => {
    const islet = kind === 'islet';
    const state = makeState(8, 8) as GridState;
    if (islet) {
      setTerrain(state, 3, 4, TerrainType.Water, 0);
      setTerrain(state, 4, 3, TerrainType.Water, 0);
    }
    state.cells[4]![4]!.terrain = {
      type: islet ? TerrainType.None : TerrainType.Water, elevation: 0,
      corners: ['fan', 'square', 'square', 'square'],
    };
    const meshes = buildTerrainMeshes(state);
    for (const [x, z, kept] of [[-0.47, -0.47, false], [-0.05, -0.05, true]] as const) {
      const wet = islet ? !kept : kept;
      const expected = wet ? waterSurfaceY(0) : GROUND_SLAB_Y;
      const visible = Math.max(topAt(meshes.ground, x, z), topAt(meshes.water, x, z));
      expect(visible).toBeCloseTo(expected);
      const hit = pickSurface(state, { x, y: 20, z }, { x: 0, y: -1, z: 0 })!;
      expect(hit.point.y).toBeCloseTo(expected);
      expect(hit.kind).toBe(wet ? 'water' : 'ground');
    }
  });

  it('extends a waterfall to the recessed receiving waterline', () => {
    const state = makeState(8, 8) as GridState;
    setTerrain(state, 4, 4, TerrainType.Water, 1);
    setTerrain(state, 4, 5, TerrainType.Water, 0);
    const mesh = buildTerrainMeshes(state).fall;
    const heights = mesh.positions.filter((_, i) => i % 3 === 1);
    expect(Math.min(...heights)).toBeCloseTo(waterSurfaceY(0));
    expect(Math.max(...heights)).toBeCloseTo(waterSurfaceY(1));
  });

  it('cuts only the water fillet out of a ground-level gamma patch', () => {
    const state = makeState(8, 8) as GridState;
    for (const [x, y] of [[5, 4], [4, 5], [5, 5]]) setTerrain(state, x!, y!, TerrainType.Water, 0);
    state.cells[4]![4]!.terrain = {
      type: TerrainType.Water, elevation: 0, patchOnly: true,
      corners: ['empty', 'empty', 'empty', 'fan'],
    };
    const meshes = buildTerrainMeshes(state);
    expect(topAt(meshes.ground, -0.3, -0.3)).toBeCloseTo(GROUND_SLAB_Y);
    expect(topAt(meshes.ground, 0.03, 0.03)).toBeCloseTo(GROUND_SLAB_Y);
    expect(topAt(meshes.ground, 0.45, 0.45)).toBeLessThan(waterSurfaceY(0));
    expect(topAt(meshes.water, 0.45, 0.45)).toBeCloseTo(waterSurfaceY(0));
  });
});
