/**
 * A waterfall's cascade is painted into its colour buffer as the mesh is built, so the falls keep
 * their sheets, streaks and splash band while the scene rests; `scene-frames.test.ts` pins that a
 * map with water stops drawing once its render window closes.
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { buildTerrainMeshes } from '../../../../view/map3d/geometry/terrain-geometry';
import { shadeFall } from '../../../../view/map3d/layers/terrain-layer';
import { TerrainType } from '../../../../core/model/types';
import type { GridState } from '../../../../core/model/types';
import { makeState, setTerrain } from '../../../_support/map-state';

/** A pool one layer up beside open ground: the drop off its rim is a waterfall face. */
function poolState(): GridState {
  const s = makeState(6, 6) as GridState;
  for (const [x, y] of [[2, 2], [3, 2], [2, 3], [3, 3]] as const) setTerrain(s, x, y, TerrainType.Mountain, 2);
  for (const [x, y] of [[2, 2], [3, 2]] as const) setTerrain(s, x, y, TerrainType.Water, 2);
  return s;
}

describe('a waterfall face carries its cascade in the geometry', () => {
  it('shades the drop from deep to foam, varying down the face', () => {
    const fall = buildTerrainMeshes(poolState()).fall;
    expect(fall.positions.length, 'the pool rim is tall enough to be a cascade').toBeGreaterThan(0);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(fall.positions, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(fall.positions.length), 3));
    const deep: [number, number, number] = [0.1, 0.3, 0.6];
    const foam: [number, number, number] = [0.6, 0.85, 1];
    shadeFall(geo, deep, foam);

    const col = geo.getAttribute('color').array as Float32Array;
    const shades = new Set<string>();
    for (let i = 0; i < col.length; i += 3) {
      const [r, g, b] = [col[i]!, col[i + 1]!, col[i + 2]!];
      expect(r).toBeGreaterThanOrEqual(deep[0] - 1e-6);
      expect(r).toBeLessThanOrEqual(foam[0] + 1e-6);
      expect(g).toBeGreaterThanOrEqual(deep[1] - 1e-6);
      expect(b).toBeLessThanOrEqual(foam[2] + 1e-6);
      shades.add(r.toFixed(4));
    }
    expect(shades.size, 'a cascade, not one flat blue face').toBeGreaterThan(3);
  });
});
