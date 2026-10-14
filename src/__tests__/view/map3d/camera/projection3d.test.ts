/**
 * The 3D ViewProjection contract: pointer→cell round-trips through a real
 * camera onto the picked surface, cellToScreen inverts it, sky rays park far
 * off-map, and the object and terrain cells keep the 2D half-cell semantics.
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { Projection3D, type CameraHost } from '../../../../view/map3d/camera/projection';
import { TerrainType } from '../../../../core/model/types';
import type { GridState } from '../../../../core/model/types';
import { makeState, setTerrain } from '../../../_support/map-state';
import { layerToY } from '../../../../view/map3d/geometry/coords';
import { cellUnder, halfPoint } from '../../../../core/grid/pointer';

function makeHost(state: GridState): { host: CameraHost } {
  const camera = new THREE.PerspectiveCamera(55, 800 / 600, 0.5, 1500);
  camera.position.set(0, 22, 20);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);
  const canvas = {
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600 }),
  } as unknown as HTMLCanvasElement;
  return {
    host: {
      camera, canvas, state: () => state,
      pickObjectAt: () => null,
      objectBoundingBox: () => null,
    },
  };
}

describe('Projection3D', () => {
  it('projects a road footprint when it has no instanced body', () => {
    const state = makeState(20, 20);
    state.objects.set('road', { id: 'road', catalogId: 'path-overgrown-dirt', position: { x: 10, y: 10 }, rotation: 0, elevation: 0 });
    const { host } = makeHost(state);
    const projection = new Projection3D(host);
    const box = projection.objectScreenBox('road')!;
    expect(box.w).toBeGreaterThan(0);
    expect(box.h).toBeGreaterThan(0);
    expect(projection.objectScreenBox('missing')).toBeNull();
  });

  it.each([[1, 1], [-1, 1], [-1, -1], [1, -1]])('includes the visible base corner from quadrant %s, %s', (sx, sz) => {
    const { host } = makeHost(makeState(20, 20));
    host.camera.position.set(sx * 20, 22, sz * 20);
    host.camera.lookAt(0, 0, 0);
    host.camera.updateMatrixWorld(true);
    host.objectBoundingBox = () => new THREE.Box3(new THREE.Vector3(-2, 0, -1), new THREE.Vector3(2, 4, 1));
    const box = new Projection3D(host).objectScreenBox('sample')!;
    const corner = new THREE.Vector3(sx * 2, 0, sz).project(host.camera);
    expect(box.y + box.h).toBeCloseTo((1 - corner.y) * 300);
    expect((corner.x + 1) * 400).toBeGreaterThan(box.x);
    expect((corner.x + 1) * 400).toBeLessThan(box.x + box.w);
  });

  it('cellToScreen and screenToPoint invert each other on flat ground', () => {
    const state = makeState(20, 20) as GridState;
    const { host } = makeHost(state);
    const proj = new Projection3D(host);
    for (const cell of [{ x: 10, y: 10 }, { x: 4, y: 13 }, { x: 15, y: 6 }]) {
      const p = proj.cellToScreen(cell.x, cell.y);
      expect(p.scale).toBeGreaterThan(0);
      // Aim at the projected center of the cell (corner + half a projected cell).
      const back = cellUnder(proj, p.x + p.scale / 2, p.y + p.scale / 2, 'object');
      expect(Math.abs(back.x - cell.x) + Math.abs(back.y - cell.y), `round-trip ${cell.x},${cell.y}`).toBeLessThanOrEqual(1);
    }
  });

  it('the object and terrain cells under a point are read from the same surface point', () => {
    const state = makeState(20, 20) as GridState;
    const { host } = makeHost(state);
    const proj = new Projection3D(host);
    const p = proj.cellToScreen(10, 10);
    const point = proj.screenToPoint(p.x + p.scale / 2, p.y + p.scale / 2);
    expect(cellUnder(proj, p.x + p.scale / 2, p.y + p.scale / 2, 'object')).toEqual({ x: Math.floor(point.x), y: Math.floor(point.y) });
    expect(cellUnder(proj, p.x + p.scale / 2, p.y + p.scale / 2, 'terrain')).toEqual({ x: Math.floor(point.x + 0.5), y: Math.floor(point.y + 0.5) });
  });

  it('a pointer over a mountain picks the mountain cell, not the ground behind it', () => {
    const state = makeState(20, 20) as GridState;
    setTerrain(state, 10, 8, TerrainType.Mountain, 6);
    const { host } = makeHost(state);
    const proj = new Projection3D(host);
    // A point on the column's camera-facing wall, just under the top: the pick
    // ray pierces the column there (a tangent graze along the exact top plane
    // is float-fragile by nature).
    const top = new THREE.Vector3(10 - 10, layerToY(6) - 0.3, 8 - 10 + 0.49).project(host.camera);
    const sx = ((top.x + 1) / 2) * 800, sy = ((1 - top.y) / 2) * 600;
    expect(cellUnder(proj, sx, sy, 'object')).toEqual({ x: 10, y: 8 });
  });

  it('the half-cell point lands on the half grid, within the same round-trip tolerance as the object cell', () => {
    const state = makeState(20, 20) as GridState;
    const { host } = makeHost(state);
    const proj = new Projection3D(host);
    for (const cell of [{ x: 10, y: 10 }, { x: 4, y: 13 }, { x: 15, y: 6 }]) {
      const p = proj.cellToScreen(cell.x, cell.y);
      const half = halfPoint(proj.screenToPoint(p.x + p.scale / 2, p.y + p.scale / 2));
      expect(Number.isInteger(half.x * 2), `x on the half grid at ${cell.x},${cell.y}`).toBe(true);
      expect(Number.isInteger(half.y * 2), `y on the half grid at ${cell.x},${cell.y}`).toBe(true);
      expect(Math.abs(half.x - cell.x) + Math.abs(half.y - cell.y), `round-trip ${cell.x},${cell.y}`).toBeLessThanOrEqual(1);
    }
  });

  it('a level ray (never meets the ground) leaves the half-cell point at the same off-map sentinel as the object cell', () => {
    const state = makeState(20, 20) as GridState;
    const camera = new THREE.PerspectiveCamera(55, 800 / 600, 0.5, 1500);
    camera.position.set(0, 5, 20);
    camera.lookAt(0, 5, 0); // dead level: the centre ray's dir.y is ~0, so it never meets the ground plane
    camera.updateMatrixWorld(true);
    const canvas = {
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600 }),
    } as unknown as HTMLCanvasElement;
    const host: CameraHost = {
      camera, canvas, state: () => state,
      pickObjectAt: () => null, objectBoundingBox: () => null,
    };
    const proj = new Projection3D(host);
    const macro = cellUnder(proj, 400, 300, 'object');
    expect(halfPoint(proj.screenToPoint(400, 300))).toEqual(macro);
    expect(macro.x).toBeLessThan(-100); // the shared OFF_MAP sentinel, not a normal cell
  });

  it('a sky ray parks far off-map', () => {
    const state = makeState(20, 20) as GridState;
    const { host } = makeHost(state);
    const proj = new Projection3D(host);
    // The top screen edge ray descends past the map and lands far away on the
    // infinite ground plane — a coherent far-off-map cell, exactly like a 2D
    // pointer parked way outside the map.
    const sky = cellUnder(proj, 400, 5, 'object');
    const offMap = sky.x < 0 || sky.y < 0 || sky.x >= 20 || sky.y >= 20;
    expect(offMap).toBe(true);
  });
});
