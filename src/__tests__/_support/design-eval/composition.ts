/**
 * Where a map's mass sits, and whether a batch of them varies.
 *
 * The one reading in `eval/` that is not of a map: `compositionVariety` judges a batch, because a
 * generator that builds the same composition every time can only be caught by comparing its maps
 * with each other. `sampleComposition` is the per-map half it is fed with.
 */
import type { GridState } from '../../../core/model/types';
import { MASS_OFFSET_MIN } from '../../../tools/generation/designer/composition/composition';
import { directionOf, type Direction } from '../../../tools/generation/designer/types';
import { readMap } from '../../../tools/reading';

/**
 * Where one map's mass sits, as a batch reads it. `archetype` is filled where the batch knows what
 * each map was planned as; the direction is always read off the finished map, since a plan that
 * never reached the ground is not a composition.
 */
export interface CompositionSample {
  direction: Direction | 'flat';
  archetype?: string;
}

export interface MassReading extends CompositionSample {
  /** Elevation-weighted centroid minus the plaza hub, in macro cells. */
  offset: { dx: number; dy: number };
  magnitude: number;
}

export { MASS_OFFSET_MIN };

/**
 * A batch smaller than this is reported but not judged.
 *
 * Four sides drawn at random put all three of a 3-batch on one side 6.3% of the time and all four of
 * a 4-batch 1.6% of the time, and no threshold can separate that from a real favourite: at n=3 the
 * only reading a varied generator survives is "all three sides differ", which it fails 62.5% of the
 * time. Five is the first size where the verdict is worth having.
 */
export const VARIETY_MIN_SAMPLES = 5;

/** No single direction (or archetype) may hold more than this share of a batch, once the batch is
 *  big enough for the share to mean anything (`varietyModeLimit`). */
export const VARIETY_DOMINANT_MAX = 0.6;

/** The odds a genuinely varied generator may trip the gate. */
const VARIETY_FALSE_FAIL_MAX = 0.01;

/**
 * The mode count at which a batch of `n` fails: the larger of the share cap and the count unlikely
 * enough to come from a generator drawing sides at random. The share cap alone is noisy on small
 * batches; the second bar is the union bound over the four sides of Bin(n, 1/4), exact wherever
 * the limit is over half the batch, clamped to n so one direction every time always fails. A
 * uniform four-way generator trips it under 0.4% of the time above `VARIETY_MIN_SAMPLES`.
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
 * Where this map's mass sits: the elevation-weighted centroid of its land against the planet's own
 * centre of area.
 *
 * Not against the plaza, though every other reading here is plaza-relative. The plaza does not stand
 * at the middle of either template's land (hexia's sits six rows south of it), so a planet raised
 * evenly would read as leaning north from the plaza and every map in a batch would name the same
 * direction whatever its composition. The neutral origin is the one the planet itself defines.
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
 * Variety across a batch: the failure this catches is the same wall on the same side of every map.
 * One map cannot fail it and no map is scored by it — what is measured is whether a generator's
 * compositions differ from each other.
 *
 * A batch fails when one side holds `varietyModeLimit` of it or more, and, where the batch names the
 * archetypes it planned, the same of those. Maps with no mass at all are counted but do not vote: a
 * quiet richness draws flat maps on purpose, and a flat map has no side to be monotonous about.
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
