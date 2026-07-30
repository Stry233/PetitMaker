import { describe, it, expect } from 'vitest';
import { introStartOffset, reportedCameraAngle } from '../../canvas/map3d/capture';

// The ThreeScene constructor needs WebGL, so these cover the two facts the scene composes: how far
// out the intro fly-in starts, and which pose a camera read reports while it is in flight.
//
// The resting pose is frameBounds' hero framing: camera at (0.72d, 0.46d + centerY, 0.72d) looking
// at (0, centerY, 0), for a frame distance d.
const D = 163;              // ~a real map's frame distance
const CENTER_Y = 2;
const restTarget = { x: 0, y: CENTER_Y, z: 0 };
const restCam = { x: 0.72 * D, y: 0.46 * D + CENTER_Y, z: 0.72 * D };
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
