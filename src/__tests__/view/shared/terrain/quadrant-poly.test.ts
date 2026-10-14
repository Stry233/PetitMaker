import { describe, it, expect } from 'vitest';
import { cornerPolygon } from '../../../../view/shared/terrain/quadrant-poly';
import type { CornerPos } from '../../../../core/model/corners';

const POSITIONS: CornerPos[] = ['TL', 'TR', 'BL', 'BR'];

describe('shared trimmed-quadrant polygon', () => {
  it('draws a fan of the requested arc steps around its centre', () => {
    for (const pos of POSITIONS) {
      for (const inverted of [false, true]) {
        for (const steps of [3, 12]) {
          const pts = cornerPolygon('fan', { x: 10, z: 20, s: 8, pos }, inverted, steps)!;
          expect(pts).toHaveLength(steps + 2);
          const [cx, cy] = pts[0]!;
          for (const [px, py] of pts.slice(1)) expect(Math.hypot(px - cx, py - cy)).toBeCloseTo(8, 9);
          // Both straight edges end exactly on a quadrant corner.
          for (const [px, py] of [pts[1]!, pts[pts.length - 1]!]) {
            expect([10, 18]).toContain(px);
            expect([20, 28]).toContain(py);
          }
        }
      }
    }
  });

  it('keeps the same corners for both views at any step count', () => {
    for (const pos of POSITIONS) {
      const coarse = cornerPolygon('fan', { x: 0, z: 0, s: 1, pos }, false)!;
      const fine = cornerPolygon('fan', { x: 0, z: 0, s: 1, pos }, false, 12)!;
      expect(fine[0]).toEqual(coarse[0]);
      expect(fine[1]).toEqual(coarse[1]);
      expect(fine[fine.length - 1]).toEqual(coarse[coarse.length - 1]);
      expect(cornerPolygon('tri-NE', { x: 0, z: 0, s: 1, pos }, false, 12)).toEqual([[0, 0], [1, 0], [1, 1]]);
    }
  });
});
