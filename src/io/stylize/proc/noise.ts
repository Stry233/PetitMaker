/*
 * noise.ts — the only source of randomness a procedural pack may use.
 *
 * Every value here is a pure function of its seed, because a pack must draw the same picture on
 * every machine and on every re-open. `Math.random` and any clock reading are therefore absent by
 * construction, and the seed a pack uses is derived from the map's own content, never from an
 * object id (ids are re-minted by the share-code round trip, so an id-seeded mark would move).
 */

/** FNV-1a over a string. Stable across engines: integer ops only, no float, no locale. */
export function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32: 32-bit state, uniform in [0,1). Integer arithmetic only. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Per-instance variation seeded from CONTENT: the same tree at the same cell always jitters the
 *  same way, and a share-code round trip (which re-mints object ids) cannot move it. */
export function contentRandom(catalogId: string, x: number, y: number, salt: string): () => number {
  return mulberry32(fnv1a(`${catalogId}|${x}|${y}|${salt}`));
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

export interface NoiseField {
  /** Value noise in [0,1] at a point. */
  at(x: number, y: number): number;
  /** Fractal sum. Each octave rotates the domain, which is what stops the sum showing the
   *  axis-aligned lattice its own grid is built on. Normalised by the root of the summed squares,
   *  so amplitude does not creep as octaves are added. */
  fbm(x: number, y: number, octaves?: number, gain?: number, lacunarity?: number): number;
}

/** A seeded 2-D value-noise field. The table is 256x256, so a pattern repeats only past that. */
export function makeNoise(seed: number): NoiseField {
  const N = 256;
  const rnd = mulberry32(seed);
  const table = new Float32Array(N * N);
  for (let i = 0; i < table.length; i++) table[i] = rnd();
  const smooth = (t: number): number => t * t * (3 - 2 * t);
  const at = (xi: number, yi: number): number => table[((yi & (N - 1)) * N) + (xi & (N - 1))]!;

  function noise2(x: number, y: number): number {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const u = smooth(x - xi);
    const v = smooth(y - yi);
    const a = at(xi, yi) * (1 - u) + at(xi + 1, yi) * u;
    const b = at(xi, yi + 1) * (1 - u) + at(xi + 1, yi + 1) * u;
    return a * (1 - v) + b * v;
  }

  const COS = Math.cos(0.7);
  const SIN = Math.sin(0.7);
  function fbm(x: number, y: number, octaves = 4, gain = 0.5, lacunarity = 2): number {
    let amp = 1;
    let freq = 1;
    let sum = 0;
    let norm = 0;
    let px = x;
    let py = y;
    for (let i = 0; i < octaves; i++) {
      sum += amp * noise2(px * freq, py * freq);
      norm += amp * amp;
      const nx = px * COS - py * SIN;
      py = px * SIN + py * COS;
      px = nx;
      amp *= gain;
      freq *= lacunarity;
    }
    return clamp01((sum / Math.sqrt(norm)) * 0.5 + 0.25);
  }

  return { at: noise2, fbm };
}

/** A 1-D fractal noise, for wobbling a boundary along its own arc length. Correlated by
 *  construction: neighbouring samples share octaves, so an outline waves instead of buzzing. */
export function makeNoise1(seed: number): (t: number) => number {
  const N = 1024;
  const rnd = mulberry32(seed);
  const table = new Float32Array(N);
  for (let i = 0; i < N; i++) table[i] = rnd() * 2 - 1;
  const smooth = (t: number): number => t * t * (3 - 2 * t);
  return (x: number): number => {
    let amp = 1;
    let freq = 1;
    let sum = 0;
    let norm = 0;
    for (let o = 0; o < 3; o++) {
      const xx = x * freq;
      const i = Math.floor(xx);
      const t = smooth(xx - i);
      sum += amp * (table[i & (N - 1)]! * (1 - t) + table[(i + 1) & (N - 1)]! * t);
      norm += amp * amp;
      amp *= 0.5;
      freq *= 2.1;
    }
    return sum / Math.sqrt(norm);
  };
}
