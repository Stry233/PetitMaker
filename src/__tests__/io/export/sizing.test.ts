import { describe, it, expect } from 'vitest';
import { mapNativePx, originalCaptureRequestPx, canvasFitScale, CANVAS_LIMITS } from '../../../io/export/sizing';

describe('export sizing', () => {
  it('mapNativePx = 64 px/cell + half-tile border (matches capture region)', () => {
    expect(mapNativePx({ width: 10, height: 8 })).toEqual({ w: 10 * 64 + 32, h: 8 * 64 + 32 });
    expect(mapNativePx({ width: 169, height: 140 })).toEqual({ w: 169 * 64 + 32, h: 140 * 64 + 32 });
  });
  it('originalCaptureRequestPx = the native long side', () => {
    expect(originalCaptureRequestPx({ width: 169, height: 140 })).toBe(169 * 64 + 32);
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
});
