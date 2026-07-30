// src/core/model/rng.ts
export interface Rng {
  float(): number;            // [0,1)
  int(maxExcl: number): number;
  range(min: number, max: number): number; // float in [min,max)
  pick<T>(arr: readonly T[]): T;
  gaussian(): number;         // mean 0, sd 1 (Box-Muller)
}

/** Deterministic mulberry32 PRNG - no Math.random/Date.now anywhere. */
export function makeRng(seed: number): Rng {
  let s = seed >>> 0;
  const float = (): number => {
    s |= 0; s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    float,
    int: (maxExcl) => Math.floor(float() * maxExcl),
    range: (min, max) => min + float() * (max - min),
    pick: (arr) => arr[Math.floor(float() * arr.length)]!,
    gaussian: () => Math.sqrt(-2 * Math.log(1 - float())) * Math.cos(2 * Math.PI * float()),
  };
}
