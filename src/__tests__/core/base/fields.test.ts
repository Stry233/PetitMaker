import { describe, it, expect } from 'vitest';
import { blurField, distanceField, gaussianKernel, signedDistanceField } from '../../../core/base/fields';

describe('distance fields over a cell mask', () => {
  const box = (w: number, h: number, rect: { x0: number; y0: number; x1: number; y1: number }): Uint8Array => {
  const { x0, y0, x1, y1 } = rect;
    const m = new Uint8Array(w * h);
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) m[y * w + x] = 1;
    return m;
  };

  it('the distance field is exact, not an approximation', () => {
    const m = new Uint8Array(9 * 9);
    m[4 * 9 + 4] = 1;
    const d = distanceField(m, 9, 9);
    expect(d[4 * 9 + 4]).toBeCloseTo(0, 6);
    expect(d[4 * 9 + 7]).toBeCloseTo(3, 6);
    expect(d[1 * 9 + 1]).toBeCloseTo(Math.hypot(3, 3), 6);
  });

  it('the signed field is negative inside and positive outside', () => {
    const m = box(12, 12, { x0: 3, y0: 3, x1: 9, y1: 9 });
    const s = signedDistanceField(m, 12, 12);
    expect(s[6 * 12 + 6]!).toBeLessThan(0);
    expect(s[0]!).toBeGreaterThan(0);
    expect(s[3 * 12 + 3]!).toBeLessThanOrEqual(0);
  });
});

describe('blur kernels', () => {
  it('cuts a Gaussian kernel at the given number of sigmas and normalises it', () => {
    expect(gaussianKernel(2, 3)).toHaveLength(13);
    expect(gaussianKernel(2, 4)).toHaveLength(17);
    expect(gaussianKernel(0.1, 3)).toHaveLength(3);
    const k = gaussianKernel(1.5, 4);
    expect(k.reduce((t, v) => t + v, 0)).toBeCloseTo(1, 12);
    expect(k[0]).toBe(k[k.length - 1]);
  });

  it('box-blurs a field one window per pass, clamping at the edges', () => {
    const src = Float32Array.from([0, 0, 3, 0, 0]);
    expect(Array.from(blurField(src, 5, 1, 1, 1))).toEqual([0, 1, 1, 1, 0]);
    const twice = blurField(src, 5, 1, 1, 2);
    expect(Array.from(twice)).toEqual(Array.from(Float32Array.from([1 / 3, 2 / 3, 1, 2 / 3, 1 / 3])));
    expect(Array.from(blurField(src, 1, 5, 1, 1))).toEqual([0, 1, 1, 1, 0]);
    expect(Array.from(src)).toEqual([0, 0, 3, 0, 0]);
  });
});
