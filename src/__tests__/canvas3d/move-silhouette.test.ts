import { describe, expect, it } from 'vitest';
import { dashedContourTriangles, silhouetteContours } from '../../canvas/map3d/build/move-silhouette';

const rect = (x: number, y: number, w: number, h: number) => [x,y, x+w,y, x+w,y+h, x,y, x+w,y+h, x,y+h];
const area = (loop: { x: number; y: number }[]) => loop.slice(1).reduce((sum, b, i) => sum + loop[i]!.x * b.y - b.x * loop[i]!.y, 0) / 2;

describe('model silhouette contours', () => {
  it('retains inward corners and removes shared triangle and overlapping-part edges', () => {
    const contours = silhouetteContours([...rect(1, 1, 4, 8), ...rect(3, 5, 7, 4)], 12, 12);
    expect(contours).toHaveLength(1);
    expect(area(contours[0]!)).toBe(52);
    expect(contours[0]).toContainEqual({ x: 5, y: 5 });
    expect(contours[0]).not.toContainEqual({ x: 3, y: 5 });
  });

  it('keeps disconnected silhouettes and omits enclosed interior holes', () => {
    const contours = silhouetteContours([
      ...rect(1,1,8,2), ...rect(1,7,8,2), ...rect(1,3,2,4), ...rect(7,3,2,4), ...rect(12,1,2,2),
    ], 16, 12);
    expect(contours.map(area).sort((a,b) => a-b)).toEqual([4,64]);
  });

  it('traces diagonal contacts as separate closed contours', () => {
    const contours = silhouetteContours([...rect(1,1,2,2), ...rect(3,3,2,2)], 8, 8);
    expect(contours).toHaveLength(2);
    for (const contour of contours) {
      expect(contour[0]).toEqual(contour[contour.length - 1]);
      expect(area(contour)).toBe(4);
    }
  });

  it('makes a three-pixel stroke with gaps along the contour', () => {
    const vertices = dashedContourTriangles([[{x:0,y:0},{x:60,y:0}]]);
    const ys = vertices.filter((_,i) => i % 2 === 1);
    expect(Math.max(...ys) - Math.min(...ys)).toBe(3);
    const xs = vertices.filter((_,i) => i % 2 === 0);
    expect(xs.some(x => x > 10.5 && x < 13.5)).toBe(false);
    expect(xs.some(x => x > 45 && x < 54)).toBe(true);
  });
});
