import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { introStartOffset, reportedCameraAngle } from '../../canvas/map3d/capture';
import { frameBounds, makeCamera } from '../../canvas/map3d/scene/camera-controls';

// The ThreeScene constructor needs WebGL, so these cover the two facts the scene composes: how far
// out the intro fly-in starts, and which pose a camera read reports while it is in flight.
//
// The resting pose is frameBounds' hero framing: camera at (0, 0.46d + centerY, 0.72√2 d) looking
// at (0, centerY, 0), for a frame distance d. Square on, the way the 2D view opens: the horizontal
// reach is spent on one axis instead of split across two, which leaves the radius and the tilt these
// numbers exercise equal to a 45° corner pose at the same frame distance.
const D = 163;              // ~a real map's frame distance
const CENTER_Y = 2;
const restTarget = { x: 0, y: CENTER_Y, z: 0 };
const restCam = { x: 0, y: 0.46 * D + CENTER_Y, z: 0.72 * Math.SQRT2 * D };
const restRadius = Math.hypot(restCam.x - restTarget.x, restCam.y - restTarget.y, restCam.z - restTarget.z);

/** The camera pose the constructor parks at before the fly-in starts. */
function introPose(): { x: number; y: number; z: number } {
  const s = introStartOffset(restCam.x - restTarget.x, restCam.y - restTarget.y, restCam.z - restTarget.z);
  return { x: restTarget.x + s.x, y: restTarget.y + s.y, z: restTarget.z + s.z };
}

describe('introStartOffset', () => {
  it('starts the fly-in ~2.4x the resting radius from the target', () => {
    const s = introStartOffset(restCam.x - restTarget.x, restCam.y - restTarget.y, restCam.z - restTarget.z);
    expect(Math.hypot(s.x, s.y, s.z) / restRadius).toBeCloseTo(2.393, 3);
  });

  it('stays well outside the resting radius at every plausible tilt', () => {
    for (const el of [5, 20, 35, 50, 65, 85]) {
      const rad = (el * Math.PI) / 180;
      const dx = Math.cos(rad) * D, dy = Math.sin(rad) * D;
      const s = introStartOffset(dx, dy, 0);
      const ratio = Math.hypot(s.x, s.y, s.z) / D;
      expect(ratio).toBeGreaterThan(2.2);
      expect(ratio).toBeLessThan(2.65);
    }
  });

  it('rises above the target when the resting offset is degenerate', () => {
    expect(introStartOffset(0, 0, 0)).toEqual({ x: 0, y: 0.4, z: 0 });
  });
});

/**
 * THE TWO VIEWS OPEN ON THE SAME PICTURE.
 *
 * The 2D renderer letters the rows down the LEFT edge and numbers the columns along the BOTTOM
 * (`map2d/map-renderer.ts:drawLabels`), and the 3D scene draws the same legend in world space, a
 * cell's column being world X and its row world Z (`map3d/core/coords.ts`). So "the same picture"
 * is two facts about where those axes land on the screen, and they are asserted as such rather than
 * as a position, since a position says nothing about which way a person sees it.
 *
 * A 45° corner frame arrives at neither: it turns the island a quarter of the way round as the views
 * swap, and a person has to find their place again.
 *
 * The framing distance and the tilt are pinned here too, since the fly-in starts at a multiple of
 * the resting offset and every export shot's `dist` is a multiple of the resting radius: a yaw that
 * quietly moved the camera closer would move the shipped pictures.
 */
describe('the 3D view opens where the 2D view does', () => {
  /** `frameBounds` reads the orbit target and writes the two dolly clamps; nothing else here needs
   *  OrbitControls, and the real one wants a DOM element to bind. */
  function framed(b: { halfX: number; halfZ: number; maxY: number }) {
    const camera = makeCamera(16 / 9);
    const controls = {
      target: new THREE.Vector3(), minDistance: 0, maxDistance: 0, update: () => {},
    } as unknown as OrbitControls;
    frameBounds(camera, controls, b);
    camera.lookAt(controls.target);
    camera.updateMatrixWorld(true);
    return { camera, controls };
  }
  /** Where a world point lands on the screen, in NDC: x right, y UP. */
  const screen = (camera: THREE.PerspectiveCamera, x: number, y: number, z: number) =>
    new THREE.Vector3(x, y, z).project(camera);

  it('puts the columns left to right and the rows top to bottom, as the 2D legend does', () => {
    const { camera } = framed({ halfX: 84, halfZ: 70, maxY: 8 });
    // Column 1 is at low X and column 11 at high X: the numbers must read left to right.
    expect(screen(camera, -60, 0, 0).x).toBeLessThan(screen(camera, 60, 0, 0).x);
    // Row A is at low Z and row I at high Z: the letters must read top to bottom.
    expect(screen(camera, 0, 0, -60).y).toBeGreaterThan(screen(camera, 0, 0, 60).y);
    // And square on rather than merely on the correct side: the two axes are not skewed, so a
    // straight row of cells runs straight across the screen.
    expect(screen(camera, -60, 0, 0).y).toBeCloseTo(screen(camera, 60, 0, 0).y, 6);
  });

  it('is a yaw and nothing else: the framing distance and the tilt are the ones it always had', () => {
    const { camera, controls } = framed({ halfX: 84, halfZ: 70, maxY: 8 });
    const off = camera.position.clone().sub(controls.target);
    // The pose this replaced, for the same bounds: the whole horizontal reach split across X and Z.
    const reach = Math.hypot(off.x, off.z);
    expect(off.length()).toBeCloseTo(Math.hypot(reach / Math.SQRT2, off.y, reach / Math.SQRT2), 6);
    // Still the low hero angle rather than a top-down one.
    const el = (Math.atan2(off.y, reach) * 180) / Math.PI;
    expect(el).toBeGreaterThan(20);
    expect(el).toBeLessThan(30);
    // Square on, in the azimuth convention the scene and every stored shot are written in.
    expect((Math.atan2(off.x, off.z) * 180) / Math.PI).toBeCloseTo(0, 9);
  });
});

describe('reportedCameraAngle', () => {
  it('reports the resting frame while the intro is in flight', () => {
    // The fly-in moves only the camera (lookAt does not touch the orbit target).
    const got = reportedCameraAngle(introPose(), restTarget, restCam, restTarget, true);
    const resting = reportedCameraAngle(restCam, restTarget, restCam, restTarget, false);
    expect(got.dist).toBeCloseTo(1, 6);
    expect(got.az).toBeCloseTo(resting.az, 6);
    expect(got.el).toBeCloseTo(resting.el, 6);
    expect(got.tx).toBeCloseTo(0, 6);
    expect(got.tz).toBeCloseTo(0, 6);
  });

  it('would report the far fly-in start unguarded (the pose an unguarded read persisted)', () => {
    const unguarded = reportedCameraAngle(introPose(), restTarget, restCam, restTarget, false);
    expect(unguarded.dist).toBeCloseTo(2.393, 3);
  });

  it('reports a live orbited pose once the intro is done', () => {
    const target = { x: 12, y: CENTER_Y, z: -8 };
    const cam = { x: target.x, y: target.y + 0.6 * restRadius, z: target.z };
    const got = reportedCameraAngle(cam, target, restCam, restTarget, false);
    expect(got.dist).toBeCloseTo(0.6, 6);
    expect(got.el).toBeCloseTo(90, 6);
    expect(got.tx).toBeCloseTo(12, 6);
    expect(got.tz).toBeCloseTo(-8, 6);
  });
});
