// src/core/model/math.ts
// Tiny shared numeric primitives (primitives-floor: pure, state-free). Every layer that needs a
// generic clamp/lerp imports these instead of re-rolling its own.

/** Clamp `v` into [lo, hi]. */
export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** Clamp `v` into [0, 1]. */
export const clamp01 = (v: number): number => clamp(v, 0, 1);

/** Linear interpolation from `a` to `b` by `t` (unclamped). */
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Hermite ramp from 0 at `e0` to 1 at `e1`, flat outside them. `e0 > e1` ramps the other way,
 *  which is how a falloff over a distance is written (`smoothstep(reach, 0, d)`). */
export const smoothstep = (e0: number, e1: number, v: number): number => {
  const t = clamp01((v - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};
