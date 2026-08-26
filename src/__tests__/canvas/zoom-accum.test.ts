import { describe, it, expect } from 'vitest';
import { clampUiZoom, followStep } from '../../canvas/map2d/zoom-accum';

describe('clampUiZoom', () => {
  it('leaves an in-range, already-2dp value untouched', () => {
    expect(clampUiZoom(1.05)).toBe(1.05);
  });

  it('rounds to 2 decimals then clamps to the 1.8 ceiling', () => {
    // +(1.834).toFixed(2) === 1.83, which exceeds the 1.8 ceiling, so it clamps to 1.8.
    expect(clampUiZoom(1.834)).toBe(1.8);
  });

  it('clamps below the floor up to 0.6', () => {
    expect(clampUiZoom(0.4)).toBe(0.6);
  });

  it('clamps above the ceiling down to 1.8', () => {
    expect(clampUiZoom(2.5)).toBe(1.8);
  });

  it('accumulating +0.1 ten times stays <= 1.8 and rounds clean (no float drift)', () => {
    const result = Array.from({ length: 10 }).reduce<number>((t) => clampUiZoom(t + 0.1), 1.0);
    expect(result).toBeLessThanOrEqual(1.8);
    // Clean 2-decimal value, no 1.0000000002 style drift.
    expect(result).toBe(+result.toFixed(2));
  });
});

describe('followStep', () => {
  it('moves toward the target (strictly between cur and target)', () => {
    const next = followStep(1.0, 1.5);
    expect(next).toBeGreaterThan(1.0);
    expect(next).toBeLessThan(1.5);
  });

  it('is monotonic toward the target across repeated steps', () => {
    let cur = 1.0;
    const target = 1.5;
    for (let i = 0; i < 5; i++) {
      const next = followStep(cur, target);
      expect(next).toBeGreaterThan(cur);
      expect(next).toBeLessThanOrEqual(target);
      cur = next;
    }
  });

  it('converges within 0.005 of the target after 60 frames', () => {
    let cur = 1.0;
    const target = 1.5;
    for (let i = 0; i < 60; i++) cur = followStep(cur, target);
    expect(Math.abs(target - cur)).toBeLessThan(0.005);
  });
});

describe('accumulation invariant (the bug)', () => {
  it('accumulates against the target, not a drifting live value', () => {
    // Five +0.1 presses against the TARGET land exactly on 1.5.
    let t = 1.0;
    for (let i = 0; i < 5; i++) t = clampUiZoom(t + 0.1);
    expect(t).toBe(1.5);
  });
});

describe('follow-loop convergence invariants', () => {
  it('unrounded follow converges and snaps (no round-trip stall)', () => {
    // The loop owns an unrounded accumulator and never reads the store back.
    // From 1.0 toward 1.5, 120 frames is more than enough (60 already suffices).
    let live = 1.0; const target = 1.5;
    for (let i = 0; i < 120 && Math.abs(target - live) >= 0.005; i++) live = followStep(live, target);
    expect(Math.abs(target - live)).toBeLessThan(0.005);
  });

  it('round-tripping through clampUiZoom each frame STALLS (documents why the loop must stay unrounded)', () => {
    // Reading the rounded store value back as `cur` every frame: at cur=1.48, target=1.50 →
    // next=1.484 → clampUiZoom rounds to 1.48 → no progress.
    let cur = 1.0; const target = 1.5;
    for (let i = 0; i < 200; i++) cur = clampUiZoom(followStep(cur, target));
    // The rounded round-trip stalls short of the target, which is why the loop stays unrounded.
    expect(cur).toBeLessThan(target);
  });
});
