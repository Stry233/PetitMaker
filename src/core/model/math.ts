// src/core/model/math.ts
// Tiny shared numeric primitives (primitives-floor: pure, state-free). Every layer that needs a
// generic clamp/lerp imports these instead of re-rolling its own.

/** Clamp `v` into [lo, hi]. */
export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** Clamp `v` into [0, 1]. */
export const clamp01 = (v: number): number => clamp(v, 0, 1);

/** Linear interpolation from `a` to `b` by `t` (unclamped). */
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
