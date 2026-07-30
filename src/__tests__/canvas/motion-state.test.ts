/**
 * The module-level reduced-motion gate the renderer rAF loops read directly.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { setReducedMotion, isMotionReduced, __resetMotionState } from '../../canvas/map2d/motion-state';

beforeEach(() => __resetMotionState());

describe('motion-state', () => {
  it('defaults to full motion', () => {
    expect(isMotionReduced()).toBe(false);
  });

  it('mirrors the reduced-motion preference', () => {
    setReducedMotion(true);
    expect(isMotionReduced()).toBe(true);
    setReducedMotion(false);
    expect(isMotionReduced()).toBe(false);
  });
});
