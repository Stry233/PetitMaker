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

/** Avalanche of two integers into one 32-bit value: neighbouring inputs give unrelated outputs. */
export function mix(a: number, b: number): number {
  let h = (Math.imul(a ^ b, 0x27d4eb2d) + 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

/** A 0..1 hash of two integers, for a decision read positionally rather than off a stream, so it
 *  is the same whatever order its candidates are considered in. */
export function hash01(a: number, b: number): number {
  return mix(Math.imul(a, 0x2545f491), b) / 4294967296;
}

/** Fisher-Yates over a copy of `arr`, one `rng.int` per index from the top down. */
export function shuffled<T>(rng: Rng, arr: readonly T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    const t = a[i]!; a[i] = a[j]!; a[j] = t;
  }
  return a;
}

/** One roulette draw over `weights` (one `rng.float`): the first index whose running sum reaches
 *  the roll, or the last index when rounding leaves the roll above zero. */
export function weightedIndex(rng: Rng, weights: readonly number[]): number {
  let total = 0;
  for (const w of weights) total += w;
  let roll = rng.float() * total;
  for (let k = 0; k < weights.length; k++) {
    roll -= weights[k]!;
    if (roll <= 0) return k;
  }
  return weights.length - 1;
}
