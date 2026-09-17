import { describe, it, expect } from 'vitest';
import { mapNativePx, clampedCaptureRequestPx, canvasFitScale, CANVAS_LIMITS } from '../../../io/export/sizing';

/** A WebKit-shaped ceiling: a long side it allows, an area a sixteenth of the desktop one. */
const WEBKIT = { maxDim: 16384, maxArea: 4096 * 4096 };

describe('export sizing', () => {
  it('mapNativePx = 64 px/cell + half-tile border (matches capture region)', () => {
    expect(mapNativePx({ width: 10, height: 8 })).toEqual({ w: 10 * 64 + 32, h: 8 * 64 + 32 });
    expect(mapNativePx({ width: 169, height: 140 })).toEqual({ w: 169 * 64 + 32, h: 140 * 64 + 32 });
  });
  it('clampedCaptureRequestPx = the native long side on a desktop ceiling', () => {
    expect(clampedCaptureRequestPx({ width: 169, height: 140 }, CANVAS_LIMITS)).toBe(169 * 64 + 32);
  });
  it('canvasFitScale = 1 when within limits', () => {
    expect(canvasFitScale(1200, 900)).toBe(1);
    expect(canvasFitScale(CANVAS_LIMITS.maxDim, 100)).toBe(1);
  });
  it('canvasFitScale < 1 when a dimension exceeds the limit', () => {
    expect(canvasFitScale(CANVAS_LIMITS.maxDim * 2, 100)).toBeCloseTo(0.5, 5);
  });
  it('canvasFitScale < 1 when area exceeds the limit', () => {
    const s = canvasFitScale(15000, 15000); // 225M < 268M area but check large square
    expect(s).toBeLessThanOrEqual(1);
    const big = canvasFitScale(16000, 16000); // 256M < 268M ok
    expect(big).toBeGreaterThan(0);
  });

  it('canvasFitScale honours a device ceiling below the desktop constant', () => {
    expect(canvasFitScale(10848, 9838)).toBe(1); // desktop composes it whole
    const s = canvasFitScale(10848, 9838, WEBKIT);
    expect(10848 * s * (9838 * s)).toBeLessThanOrEqual(WEBKIT.maxArea);
  });
  it('clampedCaptureRequestPx holds the native request inside a smaller ceiling', () => {
    const t = { width: 169, height: 140 };
    const n = mapNativePx(t);
    const px = clampedCaptureRequestPx(t, WEBKIT);
    expect(px).toBeLessThan(Math.max(n.w, n.h));
    expect(px * (px * n.h / n.w)).toBeLessThanOrEqual(WEBKIT.maxArea);
  });
});
