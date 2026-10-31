/**
 * Where a map's mass sits (`sampleComposition`), and whether a batch varies (`compositionVariety`): the
 * one reading in this folder that judges a batch, since a generator repeating one composition shows only
 * across maps.
 */
import type { GridState } from '../../../core/model/types';
import { MASS_OFFSET_MIN } from '../../../tools/generation/designer/composition/composition';
import { directionOf, type Direction } from '../../../tools/generation/designer/types';
import { readMap } from '../../../tools/reading';

/**
 * One map's entry in a batch. `archetype` is set where the batch knows the plan; the direction is always
 * read off the finished map.
 */
export interface CompositionSample {
  direction: Direction | 'flat';
  archetype?: string;
}

export interface MassReading extends CompositionSample {
  /** Elevation-weighted centroid minus the land's centre of area, in cells. */
  offset: { dx: number; dy: number };
  magnitude: number;
}

export { MASS_OFFSET_MIN };

/**
 * A batch smaller than this is reported but not judged: random sides put a whole 3-batch on one side
 * 6.3% of the time and a 4-batch 1.6%, too often to tell from a real favourite.
 */
export const VARIETY_MIN_SAMPLES = 5;

/** No single direction (or archetype) may hold more than this share of a batch, once the batch is
 *  big enough for the share to mean anything (`varietyModeLimit`). */
export const VARIETY_DOMINANT_MAX = 0.6;

/** The odds a genuinely varied generator may trip the gate. */
const VARIETY_FALSE_FAIL_MAX = 0.01;

/**
 * The mode count at which a batch of `n` fails: the larger of the share cap and the union bound over
 * the four sides of Bin(n, 1/4), clamped to n so one direction every time always fails. A uniform
 * four-way generator trips it under 0.4% of the time above `VARIETY_MIN_SAMPLES`.
 */
export function varietyModeLimit(n: number): number {
  const share = Math.floor(VARIETY_DOMINANT_MAX * n) + 1;
  let tail = Math.pow(0.75, n), bar = n;
  // P(Bin(n, 1/4) >= k), walked down from k = n so each step adds one term.
  for (let k = n; k >= 1; k--) {
    let term = Math.pow(0.25, k) * Math.pow(0.75, n - k);
    for (let j = 0; j < k; j++) term *= (n - j) / (j + 1);
    tail = k === n ? term : tail + term;
    if (4 * tail > VARIETY_FALSE_FAIL_MAX) break;
    bar = k;
  }
  return Math.min(n, Math.max(share, bar));
}

/**
 * The elevation-weighted centroid of the land against the planet's own centre of area. Unlike the other
 * readings it is not plaza-relative: the plaza sits off-centre on the templates, so an evenly raised
 * planet would lean the same way from it on every map.
 */
export function sampleComposition(state: GridState): MassReading {
  const g = readMap(state);
  let landCells = 0, lx = 0, ly = 0;
  let weight = 0, sx = 0, sy = 0;
  for (let i = 0; i < g.land.length; i++) {
    if (!g.land[i]) continue;
    landCells++; lx += i % g.W; ly += (i / g.W) | 0;
    const e = g.elev[i]!;
    if (e <= 0) continue;
    weight += e; sx += e * (i % g.W); sy += e * ((i / g.W) | 0);
  }
  if (weight <= 0 || landCells === 0) return { direction: 'flat', offset: { dx: 0, dy: 0 }, magnitude: 0 };
  const dx = sx / weight - lx / landCells, dy = sy / weight - ly / landCells;
  return {
    direction: directionOf(dx, dy, MASS_OFFSET_MIN) ?? 'flat',
    offset: { dx, dy }, magnitude: Math.hypot(dx, dy),
  };
}

export interface CompositionVariety {
  pass: boolean;
  /** False where too few maps carry any mass to read: a batch of flat maps is judged elsewhere. */
  applicable: boolean;
  samples: number;
  withMass: number;
  directions: number;
  dominantDirection: string;
  dominantDirectionShare: number;
  archetypes: number;
  dominantArchetype: string;
  dominantArchetypeShare: number;
}

/**
 * Catches the same wall on the same side of every map: a batch fails when one side, or one planned
 * archetype, holds `varietyModeLimit` of it or more. Flat maps are counted but do not vote, since a quiet
 * richness draws them on purpose.
 */
export function compositionVariety(batch: readonly CompositionSample[]): CompositionVariety {
  const withMass = batch.filter((s) => s.direction !== 'flat');
  const tally = (values: readonly string[]): { distinct: number; top: string; mode: number; share: number } => {
    const counts = new Map<string, number>();
    for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
    let top = '', best = 0;
    for (const [v, c] of [...counts.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
      if (c > best) { best = c; top = v; }
    }
    return { distinct: counts.size, top, mode: best, share: values.length ? best / values.length : 0 };
  };
  const dirs = tally(withMass.map((s) => s.direction));
  const named = batch.filter((s) => s.archetype !== undefined);
  const arch = tally(named.map((s) => s.archetype!));
  const applicable = withMass.length >= VARIETY_MIN_SAMPLES;
  const dirPass = dirs.mode < varietyModeLimit(withMass.length);
  const archPass = named.length < VARIETY_MIN_SAMPLES || arch.mode < varietyModeLimit(named.length);
  return {
    pass: !applicable || (dirPass && archPass),
    applicable,
    samples: batch.length, withMass: withMass.length,
    directions: dirs.distinct, dominantDirection: dirs.top, dominantDirectionShare: dirs.share,
    archetypes: arch.distinct, dominantArchetype: arch.top, dominantArchetypeShare: arch.share,
  };
}
