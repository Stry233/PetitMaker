import { describe, it, expect } from 'vitest';
import { reportedCameraAngle, type WorldPoint } from '../../../../view/map3d/capture/stills';
import type { CameraAngle } from '../../../../state/view-camera';

/** Replicates the scene camera's applyCameraAngle position math (camera offset from target). */
function forward(a: CameraAngle, baseDist: number): { dx: number; dy: number; dz: number } {
  const az = (a.az * Math.PI) / 180, el = (a.el * Math.PI) / 180, r = baseDist * a.dist, ce = Math.cos(el);
  return { dx: r * ce * Math.sin(az), dy: r * Math.sin(el), dz: r * ce * Math.cos(az) };
}
const norm = (d: number) => ((d % 360) + 360) % 360;

/** The angle a live camera at `offset` from a target `tx`/`tz` off the resting one reports, with
 *  the resting camera `baseDist` above the resting target. */
function reported(offset: WorldPoint, baseDist: number, tx = 0, tz = 0): CameraAngle {
  const restTarget = { x: 0, y: 0, z: 0 };
  const target = { x: tx, y: 0, z: tz };
  const cam = { x: tx + offset.x, y: offset.y, z: tz + offset.z };
  return reportedCameraAngle(cam, target, { x: 0, y: baseDist, z: 0 }, restTarget, false);
}

describe('the reported camera angle (inverse of applyCameraAngle)', () => {
  const cases: CameraAngle[] = [
    { az: 45, el: 52, dist: 1 },
    { az: -120, el: 24, dist: 0.6 },
    { az: 200, el: 61, dist: 0.9 },
    { az: 330, el: 6, dist: 0.46 },
  ];
  for (const a of cases) {
    it(`recovers az/el/dist for ${a.az}/${a.el}/${a.dist}`, () => {
      const base = 10;
      const { dx, dy, dz } = forward(a, base);
      const got = reported({ x: dx, y: dy, z: dz }, base);
      expect(norm(got.az)).toBeCloseTo(norm(a.az), 1);
      expect(got.el).toBeCloseTo(a.el, 1);
      expect(got.dist).toBeCloseTo(a.dist, 2);
    });
  }

  it('threads the target offset through as tx/tz', () => {
    const got = reported({ x: 0, y: 5, z: 0 }, 10, 3, -2);
    expect(got.tx).toBe(3);
    expect(got.tz).toBe(-2);
  });
});
