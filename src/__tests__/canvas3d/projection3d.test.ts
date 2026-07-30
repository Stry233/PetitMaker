/**
 * The 3D ViewProjection contract: pointer→cell round-trips through a real
 * camera onto the picked surface, cellToScreen inverts it, sky rays park far
 * off-map, and micro coords keep the 2D half-cell semantics.
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { Projection3D, type CameraHost } from '../../canvas/map3d/interaction/projection';
import { TerrainType } from '../../core/model/types';
import type { GridState } from '../../core/model/types';
import { makeState, setTerrain } from '../rules/_helpers';

function makeHost(state: GridState): { host: CameraHost; pans: Array<[number, number]> } {
  const camera = new THREE.PerspectiveCamera(55, 800 / 600, 0.5, 1500);
  camera.position.set(0, 22, 20);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);
  const canvas = {
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600 }),
  } as unknown as HTMLCanvasElement;
  const pans: Array<[number, number]> = [];
  return {
    host: {
      camera, canvas, state: () => state,
      panCamera: (dx, dy) => pans.push([dx, dy]),
      pickObjectAt: () => null,
      objectBoundingBox: () => null,
    },
    pans,
  };
}

describe('Projection3D', () => {
  it('cellToScreen and screenToMacro invert each other on flat ground', () => {
    const state = makeState(20, 20) as GridState;
    const { host } = makeHost(state);
    const proj = new Projection3D(host);
    for (const cell of [{ x: 10, y: 10 }, { x: 4, y: 13 }, { x: 15, y: 6 }]) {
      const p = proj.cellToScreen(cell.x, cell.y);
      expect(p.scale).toBeGreaterThan(0);
      // Aim at the projected CENTER of the cell (corner + half a projected cell).
      const back = proj.screenToMacro(p.x + p.scale / 2, p.y + p.scale / 2);
      expect(Math.abs(back.x - cell.x) + Math.abs(back.y - cell.y), `round-trip ${cell.x},${cell.y}`).toBeLessThanOrEqual(1);
    }
  });

  it('micro coords are half-cells of the same surface point', () => {
    const state = makeState(20, 20) as GridState;
    const { host } = makeHost(state);
    const proj = new Projection3D(host);
    const p = proj.cellToScreen(10, 10);
    const macro = proj.screenToMacro(p.x + p.scale / 2, p.y + p.scale / 2);
    const micro = proj.screenToMicro(p.x + p.scale / 2, p.y + p.scale / 2);
    expect(Math.floor(micro.x / 2)).toBe(macro.x);
    expect(Math.floor(micro.y / 2)).toBe(macro.y);
  });

  it('a pointer over a mountain picks the mountain cell, not the ground behind it', () => {
    const state = makeState(20, 20) as GridState;
    setTerrain(state, 10, 8, TerrainType.Mountain, 6);
    const { host } = makeHost(state);
    const proj = new Projection3D(host);
    // A point on the column's camera-facing WALL, just under the top: the pick
    // ray pierces the column there (a tangent graze along the exact top plane
    // is float-fragile by nature).
    const top = new THREE.Vector3(10 - 10, 6 * 0.55 - 0.3, 8 - 10 + 0.49).project(host.camera);
    const sx = ((top.x + 1) / 2) * 800, sy = ((1 - top.y) / 2) * 600;
    expect(proj.screenToMacro(sx, sy)).toEqual({ x: 10, y: 8 });
  });

  it('a sky ray parks far off-map; pan delegates to the camera host', () => {
    const state = makeState(20, 20) as GridState;
    const { host, pans } = makeHost(state);
    const proj = new Projection3D(host);
    // The top screen edge ray descends past the map and lands far away on the
    // infinite ground plane — a coherent far-off-map cell, exactly like a 2D
    // pointer parked way outside the map.
    const sky = proj.screenToMacro(400, 5);
    const offMap = sky.x < 0 || sky.y < 0 || sky.x >= 20 || sky.y >= 20;
    expect(offMap).toBe(true);
    proj.pan(12, -3);
    expect(pans).toEqual([[12, -3]]);
  });
});
