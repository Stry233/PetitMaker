/*
 * The only source of randomness a procedural pack may use.
 *
 * Every value here is a pure function of its seed, because a pack must draw the same picture on
 * every machine and on every re-open. `Math.random` and any clock reading are therefore absent by
 * construction, and the seed a pack uses is derived from the map's own content, never from an
 * object id (ids are re-minted by the share-code round trip, so an id-seeded mark would move).
 */
import { fnv1a32 } from '../../../core/base/hash';
import { makeRng } from '../../../core/base/rng';
import { clamp01 } from '../../../core/base/math';

/** Per-instance variation seeded from content: the same tree at the same cell always jitters the
 *  same way, and a share-code round trip (which re-mints object ids) cannot move it. */
export function contentRandom(catalogId: string, x: number, y: number, salt: string): () => number {
  return makeRng(fnv1a32(`${catalogId}|${x}|${y}|${salt}`)).float;
}


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
  const rnd = makeRng(seed).float;
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
