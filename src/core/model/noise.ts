// src/core/model/noise.ts

/** Seeded, smooth (smoothstep-interp) hash value noise in [0,1] — the one shared primitive.
 *  elevation.ts remaps to [-1,1] for fBm; nature.ts uses [0,1] directly for grove clustering. */
export function valueNoise01(seed: number): (x: number, y: number) => number {
  const hash = (x: number, y: number): number => {
    let h = (x * 374761393 + y * 668265263 + seed * 0x9e3779b9) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  const lerp = (a: number, b: number, t: number) => a + (b - a) * (t * t * (3 - 2 * t));
  return (x: number, y: number): number => {
    const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
    return lerp(lerp(hash(x0, y0), hash(x0 + 1, y0), fx), lerp(hash(x0, y0 + 1), hash(x0 + 1, y0 + 1), fx), fy);
  };
}
