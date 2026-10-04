import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { introStartOffset, reportedCameraAngle } from '../../canvas/map3d/capture';
import { frameBounds, islandBounds, makeCamera } from '../../canvas/map3d/scene/camera-controls';
import { getMapTemplate } from '../../config/maps';

// A resting pose at the default elevation, in world units.
const D = 163;
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

describe('the 3D view opens where the 2D view does', () => {
  /** `frameBounds` reads the orbit target and writes the two dolly clamps; nothing else here needs
   *  OrbitControls, and the real one wants a DOM element to bind. */
  function framed(b: { halfX: number; halfZ: number; maxY: number }, aspect = 16 / 9) {
    const camera = makeCamera(aspect);
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
    expect(screen(camera, -60, 0, 0).x).toBeLessThan(screen(camera, 60, 0, 0).x);
    expect(screen(camera, 0, 0, -60).y).toBeGreaterThan(screen(camera, 0, 0, 60).y);
    expect(screen(camera, -60, 0, 0).y).toBeCloseTo(screen(camera, 60, 0, 0).y, 6);
  });

  it('retains a low, square-on viewing angle', () => {
    const { camera, controls } = framed({ halfX: 84, halfZ: 70, maxY: 8 });
    const off = camera.position.clone().sub(controls.target);
    const reach = Math.hypot(off.x, off.z);
    const el = (Math.atan2(off.y, reach) * 180) / Math.PI;
    expect(el).toBeGreaterThan(20);
    expect(el).toBeLessThan(30);
    expect((Math.atan2(off.x, off.z) * 180) / Math.PI).toBeCloseTo(0, 9);
  });

  it.each([9 / 16, 1, 4 / 3, 16 / 9, 2.4])('fits the whole island tightly at viewport aspect %s', (aspect) => {
    const { camera } = framed({ halfX: 84.5, halfZ: 70, maxY: 8 }, aspect);
    const extents: number[] = [];
    for (const x of [-84.5, 84.5]) for (const y of [0, 8]) for (const z of [-70, 70]) {
      const point = screen(camera, x, y, z);
      expect(Math.abs(point.x)).toBeLessThanOrEqual(0.92001);
      expect(Math.abs(point.y)).toBeLessThanOrEqual(0.92001);
      extents.push(Math.abs(point.x), Math.abs(point.y));
    }
    expect(Math.max(...extents)).toBeCloseTo(0.92, 5);
  });

  it.each(['hexia', 'tafa'])('frames %s main land closer than the surrounding beach', (id) => {
    const template = getMapTemplate(id), b = islandBounds(template, 8);
    expect(b.halfX).toBeLessThan(template.width / 2);
    expect(b.halfZ).toBeLessThan(template.height / 2);
    for (const aspect of [9 / 16, 1, 16 / 9]) {
      const { camera, controls } = framed(b, aspect);
      const full = framed({ halfX: template.width / 2, halfZ: template.height / 2, maxY: 8 }, aspect);
      expect(camera.position.distanceTo(controls.target)).toBeLessThan(full.camera.position.distanceTo(full.controls.target));
      for (const x of [-b.halfX, b.halfX]) for (const y of [0, 8]) for (const z of [-b.halfZ, b.halfZ]) {
        const point = screen(camera, x + b.centerX!, y, z + b.centerZ!);
        expect(Math.abs(point.x)).toBeLessThanOrEqual(0.92001);
        expect(Math.abs(point.y)).toBeLessThanOrEqual(0.92001);
      }
    }
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

  it('reports the fly-in start when intro reporting is disabled', () => {
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
