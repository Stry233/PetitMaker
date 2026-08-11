/**
 * The frame's viewport factor: fixed-size chrome above the design reference, proportionally
 * smaller below it, never under the tap floor.
 */
import { describe, it, expect } from 'vitest';
import { FIT_FLOOR, FIT_REF, frameFit } from '../../../ui/shell/units';

describe('frameFit', () => {
  it('is 1 at and above the reference window', () => {
    expect(frameFit(FIT_REF.w, FIT_REF.h)).toBe(1);
    expect(frameFit(3840, 2160)).toBe(1);
    expect(frameFit(1600, 900)).toBe(1);
  });

  it('follows the tighter axis below it', () => {
    expect(frameFit(1280, 720)).toBeCloseTo(720 / FIT_REF.h, 6);
    expect(frameFit(1024, 800)).toBeCloseTo(1024 / FIT_REF.w, 6);
  });

  it('never goes under the tap floor', () => {
    expect(frameFit(844, 390)).toBe(FIT_FLOOR);
    expect(frameFit(1, 1)).toBe(FIT_FLOOR);
  });
});
