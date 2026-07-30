import { describe, it, expect } from 'vitest';
import { angleFromOffset, type CameraAngle } from '../../canvas/map3d/capture';

/** Replicates the scene's captureFromAngle position math (camera offset from target). */
function forward(a: CameraAngle, baseDist: number): { dx: number; dy: number; dz: number } {
  const az = (a.az * Math.PI) / 180, el = (a.el * Math.PI) / 180, r = baseDist * a.dist, ce = Math.cos(el);
  return { dx: r * ce * Math.sin(az), dy: r * Math.sin(el), dz: r * ce * Math.cos(az) };
}
const norm = (d: number) => ((d % 360) + 360) % 360;

describe('angleFromOffset (inverse of captureFromAngle)', () => {
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
      const got = angleFromOffset(dx, dy, dz, base, 0, 0);
      expect(norm(got.az)).toBeCloseTo(norm(a.az), 1);
      expect(got.el).toBeCloseTo(a.el, 1);
      expect(got.dist).toBeCloseTo(a.dist, 2);
    });
  }

  it('threads the target offset through as tx/tz', () => {
    const got = angleFromOffset(0, 5, 0, 10, 3, -2);
    expect(got.tx).toBe(3);
    expect(got.tz).toBe(-2);
  });
});
