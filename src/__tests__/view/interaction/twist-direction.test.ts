// @vitest-environment jsdom
/**
 * A two-finger twist turns the 3D map with the fingers: fingers turning clockwise on screen turn the
 * ground clockwise on screen about the orbit centre, as a map app does. Driven through the touch
 * gesture path (TouchPinch, the camera gestures, SceneCamera's verbs) with real three.js projection.
 */
import { describe, expect } from 'vitest';
import * as THREE from 'three';
import { spec } from '../../_support/spec';
import { TouchPinch } from '../../../view/interaction/gestures';
import { createCameraGestures } from '../../../view/interaction/camera-gestures';
import { SceneCamera } from '../../../view/map3d/camera/scene-camera';
import type { MapTemplate } from '../../../core/model/types';

const W = 800, H = 600;

function screenOf(camera: THREE.PerspectiveCamera, p: THREE.Vector3): { x: number; y: number } {
  camera.updateMatrixWorld(true);
  const n = p.clone().project(camera);
  return { x: ((n.x + 1) / 2) * W, y: ((1 - n.y) / 2) * H };
}

/** The screen angle of `p` about `c`, y down, so clockwise on screen grows it. */
const angle = (p: { x: number; y: number }, c: { x: number; y: number }) => Math.atan2(p.y - c.y, p.x - c.x);

function wrap(a: number): number {
  if (a > Math.PI) return a - 2 * Math.PI;
  if (a < -Math.PI) return a + 2 * Math.PI;
  return a;
}

describe('the two-finger twist in 3D', () => {
  spec('UI-35', 'turns the ground clockwise on screen when the fingers turn clockwise', () => {
    const scene = new SceneCamera(W / H, document.createElement('div'), {
      requestRender: () => {}, viewportChanged: () => {},
      template: () => ({ width: 100, height: 100 }) as unknown as MapTemplate, viewHeight: () => H,
    });
    const { camera, controls } = scene;
    controls.target.set(0, 0, 0);
    camera.position.set(0, 30, 30);
    camera.lookAt(controls.target);
    const verbs = scene.cameraVerbs();
    const gestures = createCameraGestures({ camera: () => verbs });

    const centre = screenOf(camera, controls.target);
    const ground = [new THREE.Vector3(10, 0, 0), new THREE.Vector3(0, 0, -10), new THREE.Vector3(-7, 0, 6)];
    const before = ground.map((g) => angle(screenOf(camera, g), centre));

    // Two fingers about the screen centre, turned 10 degrees clockwise on screen.
    const pinch = new TouchPinch();
    const r = 100, turn = (10 * Math.PI) / 180;
    pinch.down(1, centre.x + r, centre.y);
    pinch.down(2, centre.x - r, centre.y);
    pinch.move(1, centre.x + r * Math.cos(turn), centre.y + r * Math.sin(turn));
    const delta = pinch.move(2, centre.x - r * Math.cos(turn), centre.y - r * Math.sin(turn))!;
    gestures.touch(delta);

    const after = ground.map((g) => angle(screenOf(camera, g), centre));
    for (let i = 0; i < ground.length; i++) expect(wrap(after[i]! - before[i]!), `ground point ${i}`).toBeGreaterThan(0);
  });
});
