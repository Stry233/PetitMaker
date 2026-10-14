// Tiny shared numeric primitives (primitives-floor: pure, state-free). Every layer that needs a
// generic clamp/lerp imports these instead of re-rolling its own.

/** Clamp `v` into [lo, hi]. */
export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** Clamp `v` into [0, 1]. */
export const clamp01 = (v: number): number => clamp(v, 0, 1);

/** Linear interpolation from `a` to `b` by `t` (unclamped). */
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Linear interpolation from `a` to `b` by `t` clamped into [0, 1]. The clamp is a comparison, so
 *  `t = -0` stays `-0` and NaN passes through. */
export const lerpClamped = (a: number, b: number, t: number): number => a + (b - a) * (t < 0 ? 0 : t > 1 ? 1 : t);

/** Hermite ramp from 0 at `e0` to 1 at `e1`, flat outside them. `e0 > e1` ramps the other way,
 *  which is how a falloff over a distance is written (`smoothstep(reach, 0, d)`). */
export const smoothstep = (e0: number, e1: number, v: number): number => {
  const t = clamp01((v - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};

/** How a median of an even count is taken from the two middle values: their mean, the lower or the
 *  upper (the value at index `n >> 1` of the sorted values). */
export type EvenMedian = 'mean' | 'lower' | 'upper';

/** The median of `values[0 .. n)`, `n >= 1`, reordering them in place by quickselect; `even` says how
 *  an even count takes it. */
export function medianInPlace(values: Float32Array | Float64Array, n: number, even: EvenMedian): number {
  const select = (k: number): number => {
    let lo = 0;
    let hi = n - 1;
    while (lo < hi) {
      const pivot = values[(lo + hi) >> 1]!;
      let i = lo;
      let j = hi;
      while (i <= j) {
        while (values[i]! < pivot) i++;
        while (values[j]! > pivot) j--;
        if (i <= j) {
          const t = values[i]!;
          values[i] = values[j]!;
          values[j] = t;
          i++;
          j--;
        }
      }
      if (k <= j) hi = j;
      else if (k >= i) lo = i;
      else break;
    }
    return values[k]!;
  };
  const upper = select(n >> 1);
  if (n % 2 === 1 || even === 'upper') return upper;
  let lower = -Infinity;
  for (let i = 0; i < n >> 1; i++) lower = Math.max(lower, values[i]!);
  return even === 'lower' ? lower : (lower + upper) / 2;
}

/** The median of `values`, leaving them unchanged; 0 for none. See `medianInPlace` for `even`. */
export function median(values: ArrayLike<number>, even: EvenMedian): number {
  if (values.length === 0) return 0;
  const copy = Float64Array.from(values);
  return medianInPlace(copy, copy.length, even);
}
