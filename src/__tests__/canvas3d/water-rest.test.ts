/**
 * The 3D view rests when nothing is happening.
 *
 * The loop renders on demand: a frame is drawn only while the render window is open, and the
 * window is re-opened by whatever moved the scene. Ambient water motion re-opened it on every
 * frame, so a map that was merely OPEN kept re-rendering itself forever — the whole scene, through
 * a 4x multisampled target, plus a walk of every waterfall vertex and a re-upload of its colour
 * buffer. On the reference expert island (14k terrain cells, 780 waterfall faces) that walk alone
 * measured ~8.8 ms and 1.8 MB of upload per call, and the scene never once stopped drawing.
 *
 * The waterfall's cascade is painted into the colour buffer as the mesh is built, so the falls keep
 * their sheets, streaks and splash band; the water surface keeps the resting waterline its geometry
 * is built at.
 */
import { describe, it, expect } from 'vitest';
// @ts-ignore - node:fs is untyped here (no @types/node)
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { buildTerrainMeshes } from '../../canvas/map3d/build/terrain-geometry';
import { ThreeScene } from '../../canvas/map3d/scene/scene';
import { TerrainType } from '../../core/model/types';
import type { GridState } from '../../core/model/types';
import { makeState, setTerrain } from '../rules/_helpers';

const SOURCE: string = readFileSync('src/canvas/map3d/scene/scene.ts', 'utf8');
const LOOP = SOURCE.slice(SOURCE.indexOf('private loop = ()'), SOURCE.indexOf('private addLights'));

describe('the render loop asks for frames only when something moved', () => {
  it('opens the render window for the camera, the intro, the overlay and object tweens, nothing else', () => {
    const asks = LOOP.split('\n').map((l: string) => l.trim()).filter((l: string) => l.includes('move'));
    expect(asks).toEqual([
      'let move = this.tickInertia();',
      'if (this.introActive) { this.animateIntro(); move = true; }',
      'if (this.camTween) { this.animateCamTween(); move = true; }',
      'if (this.overlay3d?.tick()) move = true;',
      'if (this.tickPlops()) move = true;',
      'if (this.tickSpins()) move = true;',
      'if (this.tickGroupArc()) move = true;',
      'if (move) this.renderWindow = Math.max(this.renderWindow, 2);',
    ]);
  });

  it('runs no per-frame water or waterfall work', () => {
    expect(LOOP).not.toMatch(/frame % /);
    expect(LOOP).not.toMatch(/Swell|Fall/);
  });
});

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
    // The method reads only the two fall colours off the scene, so it runs on a stand-in — the real
    // constructor needs a WebGL context, which no test environment here has.
    type Shader = (this: { fallDeep: number[]; fallFoam: number[] }, g: THREE.BufferGeometry) => void;
    const shade = (ThreeScene.prototype as unknown as { shadeFall: Shader }).shadeFall;
    shade.call({ fallDeep: deep, fallFoam: foam }, geo);

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
