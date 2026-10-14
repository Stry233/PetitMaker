import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { modelGeometry } from '../../../../view/map3d/models/build-model';
import { objectInstance } from '../../../../view/map3d/geometry/object-meshes';
import { buildTerrainMeshes } from '../../../../view/map3d/geometry/terrain-geometry';
import { LAYER_HEIGHT, SPAN_DECK_CLEARANCE, surfaceY, waterSurfaceY, bridgeDeckY } from '../../../../view/map3d/geometry/coords';
import { getCatalogByCategory } from '../../../../state/catalog';
import { TerrainType, type PlacedObject } from '../../../../core/model/types';
import { makeState, setTerrain } from '../../../_support/map-state';
import { ItemCategory } from '../../../../config/catalog/categories';

function deckHeight(id: string, x: number, z: number): number {
  const mesh = new THREE.Mesh(modelGeometry(id)!, new THREE.MeshBasicMaterial());
  mesh.updateMatrixWorld();
  const ray = new THREE.Raycaster(new THREE.Vector3(x, 10, z), new THREE.Vector3(0, -1, 0));
  const hit = ray.intersectObject(mesh)[0];
  mesh.material.dispose();
  expect(hit, `${id} deck at ${x}, ${z}`).toBeDefined();
  return hit!.point.y;
}

describe('span contact surfaces', () => {
  it.each(['ramp-park-steps', 'ramp-retro-steps'])('%s has no exposed faces coplanar with its upper cliff', id => {
    for (const rotation of [0, 90, 180, 270] as const) for (const elevation of [1, 2, 7]) {
      const state = makeState(24, 24);
      const obj: PlacedObject = { id, catalogId: id, position: { x: 10, y: 10 }, rotation, elevation };
      const inst = objectInstance(state, obj)!.inst;
      const matrix = new THREE.Matrix4().compose(new THREE.Vector3(inst.x, inst.y, inst.z),
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), inst.rotationY),
        new THREE.Vector3(inst.scaleX, inst.scaleY, inst.scaleZ));
      const inverse = matrix.clone().invert();
      for (let y = 0; y < 24; y++) for (let x = 0; x < 24; x++) {
        const local = new THREE.Vector3(x - 12, 0, y - 12).applyMatrix4(inverse);
        const level = local.z > .25 ? elevation : elevation - 1;
        if (level > 0) setTerrain(state, x, y, TerrainType.Mountain, level);
      }
      const terrain = buildTerrainMeshes(state).solid;
      const axis = rotation === 0 || rotation === 180 ? 'z' : 'x';
      const across = axis === 'z' ? 'x' : 'z';
      const cliff = new THREE.Vector3(0, 0, .25).applyMatrix4(matrix)[axis];
      const walls: THREE.Box3[] = [];
      for (let i = 0; i < terrain.index.length; i += 3) {
        const vertices = terrain.index.slice(i, i + 3).map(index => new THREE.Vector3().fromArray(terrain.positions, index * 3));
        if (vertices.every(vertex => Math.abs(vertex[axis] - cliff) < 1e-5)) {
          walls.push(new THREE.Box3().setFromPoints(vertices));
        }
      }
      expect(walls.length).toBeGreaterThan(0);
      const positions = modelGeometry(id)!.getAttribute('position');
      let overlaps = 0;
      for (let i = 0; i < positions.count; i += 3) {
        const vertices = [0, 1, 2].map(j => new THREE.Vector3().fromBufferAttribute(positions, i + j).applyMatrix4(matrix));
        if (!vertices.every(vertex => Math.abs(vertex[axis] - cliff) < 1e-5)) continue;
        const bounds = new THREE.Box3().setFromPoints(vertices);
        for (const wall of walls) {
          const overlap = bounds.clone().intersect(wall);
          overlap.min.y = Math.max(overlap.min.y, surfaceY(elevation - 1));
          if (overlap.max.y - overlap.min.y > 1e-5 && overlap.max[across] - overlap.min[across] > 1e-5) overlaps++;
        }
      }
      expect(overlaps, `${id}, rotation ${rotation}, elevation ${elevation}`).toBe(0);
    }
  });

  it('keeps all upper ramp decks above elevated ground in every facing', () => {
    const state = makeState(30, 30);
    for (const item of getCatalogByCategory(ItemCategory.Ramp)) {
      const deck = deckHeight(item.id, .11, .37);
      for (const rotation of [0, 90, 180, 270] as const) for (const elevation of [1, 2, 7]) {
        const obj: PlacedObject = { id: item.id, catalogId: item.id, position: { x: 10, y: 10 }, rotation, elevation };
        const inst = objectInstance(state, obj)!.inst;
        expect(inst.y + inst.scaleY, item.id).toBeCloseTo(surfaceY(elevation) + SPAN_DECK_CLEARANCE);
        expect(inst.y + deck * inst.scaleY, item.id).toBeGreaterThan(surfaceY(elevation) + .005);
      }
    }
  });

  it('keeps bridge end decks above their bank plane across spans and elevations', () => {
    const state = makeState(30, 30);
    for (const item of getCatalogByCategory(ItemCategory.Bridge)) {
      for (const elevation of [0, 2, 7]) for (const spanLength of [3, 6]) for (const rotation of [0, 90] as const) {
        const obj: PlacedObject = { id: item.id, catalogId: item.id, position: { x: 10, y: 10 }, rotation, elevation, spanLength };
        const inst = objectInstance(state, obj)!.inst;
        expect(inst.y).toBeCloseTo(bridgeDeckY(elevation));
        for (const x of [-.46, .003, .46]) {
          expect(inst.y + deckHeight(item.id, x, .11), item.id).toBeGreaterThan(Math.max(surfaceY(elevation), waterSurfaceY(elevation)) + .01);
        }
      }
    }
  });

  it.each(['bridge-park-arch', 'bridge-retro-arch'])('%s preserves the calibrated crown rise and an open underside', id => {
    expect(deckHeight(id, .003, .11) / LAYER_HEIGHT).toBeCloseTo(.758, 2);
    const geometry = modelGeometry(id)!;
    expect(geometry.boundingBox!.min.y).toBeCloseTo(-.62 * LAYER_HEIGHT);
    expect(geometry.boundingBox!.max.y).toBeCloseTo(1.25 * LAYER_HEIGHT);
  });
});
