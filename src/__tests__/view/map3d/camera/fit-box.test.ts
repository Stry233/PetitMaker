// @vitest-environment jsdom
/** The 3D camera's fit into a box on the screen (the save step's viewfinder): the map box stands
 *  centred in it, as large as fits, seen from the heading and tilt the camera held. */
import { afterEach, expect, it } from 'vitest';
import * as THREE from 'three';
import { SceneCamera } from '../../../../view/map3d/camera/scene-camera';
import { __resetMotionState, setReducedMotion } from '../../../../platform/channels/motion-state';
import type { MapTemplate } from '../../../../core/model/types';

const W = 800, H = 600;
afterEach(__resetMotionState);

it('brings a map box centred into a box on the screen, as large as fits, from the same heading and tilt', () => {
  setReducedMotion(true);
  const dom = document.createElement('div');
  dom.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: W, bottom: H, width: W, height: H, toJSON: () => ({}) });
  const scene = new SceneCamera(W / H, dom, {
    requestRender: () => {}, viewportChanged: () => {},
    template: () => ({ width: 100, height: 100 }) as unknown as MapTemplate, viewHeight: () => H,
  });
  const { camera, controls } = scene;
  controls.target.set(0, 0, 0);
  camera.position.set(20, 40, 50);
  camera.lookAt(controls.target);
  const toward = () => new THREE.Vector3().subVectors(camera.position, controls.target).normalize();
  const was = toward();

  const box = { x: 55, y: 40, w: 8, h: 6 }, into = { left: 230, top: 60, width: 341, height: 200 };
  scene.animateFitBox(box, into);

  camera.updateMatrixWorld(true);
  const shown = [[box.x, box.y], [box.x + box.w, box.y], [box.x, box.y + box.h], [box.x + box.w, box.y + box.h]].map(([x, z]) => {
    const n = new THREE.Vector3(x! - 50, 0, z! - 50).project(camera);
    return { x: ((n.x + 1) / 2) * W, y: ((1 - n.y) / 2) * H };
  });
  const xs = shown.map((p) => p.x), ys = shown.map((p) => p.y);
  const [left, right, top, bottom] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  expect(Math.abs((left + right) / 2 - (into.left + into.width / 2))).toBeLessThan(1);
  expect(Math.abs((top + bottom) / 2 - (into.top + into.height / 2))).toBeLessThan(1);
  expect(Math.max((right - left) / into.width, (bottom - top) / into.height)).toBeCloseTo(1, 1);
  expect(toward().angleTo(was)).toBeLessThan(1e-6);
});
