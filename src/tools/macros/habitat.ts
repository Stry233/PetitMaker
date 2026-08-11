/**
 * The habitat field: what the ground under a smart-planting press is LIKE, as three per-cell
 * gradients, plus the species preferences that read them and the one community a press plants.
 *
 * MOISTURE, EXPOSURE and EDGE are derived from the `PlacementAnalysis` the run already builds —
 * no new scan of the map, no new user knob, nothing that is not either the map or the press seed.
 * That is what keeps the ghost honest: the preview's cache key is (macro id, options, map
 * versions), and everything here is a function of those three.
 *
 * THE SEAM IS `placeNature`'s SPECIES PICKER, not a pre-filtered palette. `placeNature` decides
 * WHERE a plant goes with its own seeded stream (stand noise, canopy glades, ecotone and meadow
 * drifts) and only then decides WHAT it is, so handing it a picker replaces the species policy
 * while leaving the placement stream untouched — the same cells receive plants, they are simply
 * different plants. A pre-filtered per-cell palette would have to narrow the pool BEFORE the
 * density draw, which changes nothing about the draw but does have to be recomputed per cell for
 * every cell considered, most of which are never planted; and a picker can also see the cell it is
 * answering for, which a palette handed to the whole run cannot. The picker draws no randomness of
 * its own (every choice is a hash of the press seed and the cell) precisely so the placement stream
 * cannot shift under it.
 *
 * The preference table lives HERE rather than in the catalog JSONs: it is this planting's opinion
 * about a species, not a property of the item, and the same catalog is read by the generator, the
 * agent and the placement panel, none of which have a habitat to read.
 */
import { fnv1a } from '../../core/model/hash';
import { clamp01, smoothstep } from '../../core/model/math';
import { distanceField } from '../../core/model/grid-model';
import { ItemCategory } from '../../core/model/types';
import { makeRng } from '../../core/model/rng';
import type { PlacementAnalysis } from '../generation/placement/analysis';
import type { SpeciesPicker } from '../generation/placement/nature';

/** How far from water a cell is still damp ground, in cells. Past it the shoreline is not a
 *  habitat any more, it is the same dry meadow as anywhere else. */
const MOISTURE_REACH = 8;
/** How far the wind off a cliff carries, in cells. */
const CLIFF_REACH = 3;
/** The tier at which height alone counts as fully exposed — half of `ELEVATION_MAX`. Higher than
 *  that a plateau is a ridge whatever else is around it. */
const EXPOSURE_TIER_SPAN = 4;
/** How far in from the last plantable cell still reads as the margin of the ground. */
const EDGE_REACH = 4;

/** One cell's habitat, all three axes on 0..1. */
export interface Habitat {
  /** 1 at the waterline, 0 beyond `MOISTURE_REACH`. */
  moisture: number;
  /** 1 on a high, cliff-edged tier, 0 in a sheltered low. */
  exposure: number;
  /** 1 where the plantable ground runs out, 0 deep inside it. */
  edge: number;
}

/** The three gradients over the analysis grid, flat-indexed exactly as the analysis is. */
export interface HabitatField {
  moisture: Float32Array;
  exposure: Float32Array;
  edge: Float32Array;
}

/**
 * The gradients, from the analysis alone.
 *
 * `grass`, `elev` and `distToWater` are whole-map facts even when the analysis was restricted to a
 * region — only `open` carries the restriction — so a disc's field describes the ground the disc
 * sits on rather than the disc's own rim. That matters for EDGE: measured off the restricted mask
 * it would report a margin all the way around every press, wherever it landed.
 */
export function buildHabitatField(a: PlacementAnalysis): HabitatField {
  const { width: W, height: H, grass, elev, distToWater } = a;
  const n = W * H;
  const moisture = new Float32Array(n);
  const exposure = new Float32Array(n);
  const edge = new Float32Array(n);

  // Plantable ground: grass that is not water. Anything else is where the ground runs out.
  const ground = new Uint8Array(n);
  const offGround: number[] = [];
  for (let i = 0; i < n; i++) {
    const isGround = grass[i] === 1 && distToWater[i] !== 0;
    ground[i] = isGround ? 1 : 0;
    if (!isGround) offGround.push(i);
  }

  // A cliff is a STEP between two pieces of ground. A shoreline is not one: what a shore does to a
  // habitat is moisture, and counting it twice would make every pond edge read as a windy ridge.
  const cliffs: number[] = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (!ground[i]) continue;
      const e = elev[i]!;
      let stepped = false;
      for (let dy = -1; dy <= 1 && !stepped; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const j = ny * W + nx;
          if (ground[j] && elev[j] !== e) { stepped = true; break; }
        }
      }
      if (stepped) cliffs.push(i);
    }
  }

  const distToCliff = cliffs.length ? distanceField(cliffs, W, H) : null;
  const distToOff = offGround.length ? distanceField(offGround, W, H) : null;

  for (let i = 0; i < n; i++) {
    moisture[i] = smoothstep(MOISTURE_REACH, 0, distToWater[i]!);
    const height = clamp01(elev[i]! / EXPOSURE_TIER_SPAN);
    const wind = distToCliff ? smoothstep(CLIFF_REACH, 0, distToCliff[i]!) : 0;
    exposure[i] = clamp01(0.6 * height + 0.4 * wind);
    edge[i] = distToOff ? smoothstep(EDGE_REACH, 0, distToOff[i]!) : 0;
  }
  return { moisture, exposure, edge };
}

/** One cell's habitat, read out of the field. */
export function habitatAt(f: HabitatField, i: number): Habitat {
  return { moisture: f.moisture[i] ?? 0, exposure: f.exposure[i] ?? 0, edge: f.edge[i] ?? 0 };
}

/**
 * A species' response along one axis: happiest at `at`, indifferent to a spread of `tol` either
 * side, effectively absent past about two `tol`. A wide `tol` is a species that grows anywhere,
 * which is a real thing to say about a plant and not a missing entry.
 */
interface Response { at: number; tol: number }
interface HabitatPreference { moisture: Response; exposure: Response; edge: Response }

/** Whatever a species has no opinion about. */
const INDIFFERENT: Response = { at: 0.5, tol: 1.2 };
const pref = (p: Partial<HabitatPreference>): HabitatPreference => ({
  moisture: p.moisture ?? INDIFFERENT, exposure: p.exposure ?? INDIFFERENT, edge: p.edge ?? INDIFFERENT,
});

/**
 * What each species wants, keyed by SPECIES rather than by catalog id: the catalog carries a
 * species' colourways as separate items (`flower-lily`, `flower-lily-cyan`, `flower-lily-yellow`)
 * and they are one plant repainted, so they want one row. Lookup takes the LONGEST matching key,
 * which leaves room for a single colourway to disagree with its siblings later without the table
 * having to list the ones that do not.
 *
 * The values are a garden designer's opinion, not a botanist's: what reads right when the press
 * lands on a shore, a ridge or a sheltered middle.
 */
const SPECIES_HABITAT: Record<string, HabitatPreference> = {
  // Trees. The four bands `placeNature` picks between when nothing supplies a picker, restated as
  // continuous preferences so a species can sit between two of them.
  'tree-fir': pref({ moisture: { at: 0.35, tol: 0.45 }, exposure: { at: 0.95, tol: 0.5 } }),
  'tree-ginkgo': pref({ moisture: { at: 0.4, tol: 0.45 }, exposure: { at: 0.8, tol: 0.55 } }),
  'tree-cactus': pref({ moisture: { at: 0, tol: 0.25 }, exposure: { at: 0.8, tol: 0.6 } }),
  'tree-baobab': pref({ moisture: { at: 0.1, tol: 0.3 }, exposure: { at: 0.6, tol: 0.5 } }),
  'tree-dragonblood': pref({ moisture: { at: 0.15, tol: 0.3 }, exposure: { at: 0.8, tol: 0.45 } }),
  'tree-flame': pref({ moisture: { at: 0.3, tol: 0.35 }, exposure: { at: 0.5, tol: 0.5 }, edge: { at: 0.7, tol: 0.6 } }),
  'tree-mango': pref({ moisture: { at: 0.8, tol: 0.35 }, exposure: { at: 0.15, tol: 0.45 } }),
  'tree-avocado': pref({ moisture: { at: 0.75, tol: 0.35 }, exposure: { at: 0.2, tol: 0.45 } }),
  'tree-bamboo': pref({ moisture: { at: 0.95, tol: 0.3 }, exposure: { at: 0.1, tol: 0.4 }, edge: { at: 0.6, tol: 0.7 } }),
  'tree-apple': pref({ moisture: { at: 0.5, tol: 0.4 }, exposure: { at: 0.25, tol: 0.45 } }),
  'tree-peach': pref({ moisture: { at: 0.5, tol: 0.4 }, exposure: { at: 0.3, tol: 0.45 } }),
  'tree-plum': pref({ moisture: { at: 0.45, tol: 0.4 }, exposure: { at: 0.3, tol: 0.45 } }),

  // Flora. Two ends of the moisture axis are deliberately sharp — the waterside lily and the dry
  // agave — so a press that lands across a shoreline visibly sorts itself.
  'flower-lily': pref({ moisture: { at: 1, tol: 0.22 }, exposure: { at: 0.1, tol: 0.45 }, edge: { at: 0.7, tol: 0.7 } }),
  'flower-canna': pref({ moisture: { at: 0.85, tol: 0.3 }, exposure: { at: 0.2, tol: 0.5 } }),
  'flower-agapanthus': pref({ moisture: { at: 0.7, tol: 0.35 }, exposure: { at: 0.25, tol: 0.5 } }),
  'flower-amaryllis': pref({ moisture: { at: 0.6, tol: 0.4 }, exposure: { at: 0.25, tol: 0.5 } }),
  'flower-violet': pref({ moisture: { at: 0.6, tol: 0.35 }, exposure: { at: 0.15, tol: 0.4 }, edge: { at: 0.85, tol: 0.5 } }),
  'flower-bellflower': pref({ moisture: { at: 0.55, tol: 0.4 }, exposure: { at: 0.45, tol: 0.5 }, edge: { at: 0.7, tol: 0.6 } }),
  'flower-dahlia': pref({ moisture: { at: 0.5, tol: 0.4 }, exposure: { at: 0.3, tol: 0.5 } }),
  'flower-rose': pref({ moisture: { at: 0.5, tol: 0.4 }, exposure: { at: 0.35, tol: 0.5 }, edge: { at: 0.6, tol: 0.7 } }),
  'flower-daisy': pref({ moisture: { at: 0.45, tol: 0.5 }, exposure: { at: 0.4, tol: 0.6 } }),
  'flower-sunflower': pref({ moisture: { at: 0.35, tol: 0.4 }, exposure: { at: 0.55, tol: 0.5 }, edge: { at: 0.6, tol: 0.7 } }),
  'flower-protea': pref({ moisture: { at: 0.2, tol: 0.35 }, exposure: { at: 0.85, tol: 0.45 } }),
  // The dry end of the moisture axis is deliberately WIDE on exposure: these are the plants that
  // read as dry ground, and dry ground is not only ridges. A narrow exposure window here left an
  // ordinary flat meadow with nothing characteristic to plant on it at all.
  'flower-portulaca': pref({ moisture: { at: 0.05, tol: 0.3 }, exposure: { at: 0.7, tol: 0.7 } }),
  'plant-agave': pref({ moisture: { at: 0, tol: 0.25 }, exposure: { at: 0.7, tol: 0.7 } }),
  'plant-azalea': pref({ moisture: { at: 0.7, tol: 0.3 }, exposure: { at: 0.2, tol: 0.45 }, edge: { at: 0.8, tol: 0.6 } }),
  'plant-gardenia': pref({ moisture: { at: 0.65, tol: 0.35 }, exposure: { at: 0.2, tol: 0.45 } }),
  shrub: pref({ moisture: { at: 0.5, tol: 0.6 }, edge: { at: 0.6, tol: 0.8 } }),
};

/** Keys longest first, so a colourway's own row would win over its species' row. */
const HABITAT_KEYS = Object.keys(SPECIES_HABITAT).sort((a, b) => b.length - a.length);
/** The resolved row per catalog id: the prefix walk answers the same question for the same id
 *  every time, and it is asked once per candidate species per planted cell. */
const resolved = new Map<string, HabitatPreference>();

/** Nothing is impossible, only unlikely: a floor keeps a species that fits nowhere on the map from
 *  making the weighted draw undefined, without letting it compete with one that fits. */
const FITNESS_FLOOR = 1e-3;

const response = (r: Response, v: number): number => Math.exp(-(((v - r.at) / r.tol) ** 2));

/**
 * How well a species suits a cell, 0..1. The three axes MULTIPLY: a plant that wants shade and
 * water is not half-suited to a dry ridge, it is absent from one.
 *
 * The number is only ever meaningful AGAINST ANOTHER SPECIES AT THE SAME CELL. Three multiplied
 * gaussians land low almost everywhere — a flat, dry, interior cell scores the best-suited plant in
 * the catalog under 0.3 — so an absolute threshold anywhere in this module would read a perfectly
 * ordinary meadow as ground nothing wants to grow on. Everything downstream compares.
 */
export function speciesFitness(catalogId: string, h: Habitat): number {
  let p = resolved.get(catalogId);
  if (!p) {
    const key = HABITAT_KEYS.find((k) => catalogId.startsWith(k));
    p = key ? SPECIES_HABITAT[key]! : pref({});
    resolved.set(catalogId, p);
  }
  const f = response(p.moisture, h.moisture) * response(p.exposure, h.exposure) * response(p.edge, h.edge);
  return Math.max(f, FITNESS_FLOOR);
}

/** Deterministic uniform on [0,1) from a handful of integers — the per-cell draws, which must not
 *  come out of `placeNature`'s own stream (see the module header). */
function hash01(...vals: number[]): number {
  let h = 0x811c9dc5;
  for (const v of vals) {
    h = Math.imul(h ^ (v | 0), 0x01000193);
    h ^= h >>> 13;
    h = Math.imul(h, 0x5bd1e995);
  }
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/** A stable integer salt per category, so the tree community and the flora community under one
 *  press are two independent draws rather than the same one twice. */
const salt = (s: string): number => parseInt(fnv1a(s), 16);

/** Draws from `pool` in proportion to `weights`, given a uniform `u`. */
function weightedPick(pool: readonly string[], weights: readonly number[], u: number): string {
  let total = 0;
  for (const w of weights) total += w;
  let acc = u * total;
  for (let i = 0; i < pool.length; i++) {
    acc -= weights[i]!;
    if (acc <= 0) return pool[i]!;
  }
  return pool[pool.length - 1]!;
}

/** Each species' fitness at one cell, and the best of them — the yardstick every comparison in
 *  this module is made against (see `speciesFitness`). */
function fitnessRow(pool: readonly string[], h: Habitat): { fits: number[]; best: number } {
  const fits = pool.map((id) => speciesFitness(id, h));
  let best = 0;
  for (const f of fits) if (f > best) best = f;
  return { fits, best };
}

/** How much of a species' chance of being this press's dominant is the seed rather than the site.
 *  All site and one press in ten lands the only community its ground allows, which is a map that
 *  repeats itself; all seed and a lily stand grows on a dry ridge. */
const DOMINANT_SEED_FLOOR = 0.2;

/** Roughly what share of a stand is its dominant species; the rest are habitat-sorted accents. */
const DOMINANT_SHARE = 0.75;
/** How far below the best-suited species at a cell the dominant may fall and still be planted
 *  there. Under it the accent draw answers instead — which is what thins a stand out as it runs
 *  into ground it does not want, rather than marching it across a shoreline unchanged. */
const DOMINANT_MIN_SHARE = 0.25;

/**
 * The species this press is a stand OF, drawn from the seed against the habitat at the aim point.
 *
 * Exported because it is the whole claim of "one press, one community" and a test that recomputed
 * it would be testing its own copy.
 */
export function dominantSpecies(pool: readonly string[], field: HabitatField, centre: number, seed: number): string {
  if (pool.length <= 1) return pool[0] ?? '';
  const { fits, best } = fitnessRow(pool, habitatAt(field, centre));
  // A species the veto below would refuse at the aim point itself is not a candidate: naming one
  // would give the press a dominant it then plants nowhere, which is a stand with no species in it.
  const weights = fits.map((f) => (f >= DOMINANT_MIN_SHARE * best ? DOMINANT_SEED_FLOOR + f / best : 0));
  return weightedPick(pool, weights, makeRng(seed ^ 0x5f3a91c7).float());
}

/**
 * The species policy for ONE press: a seed-derived dominant over most of the stand, habitat-sorted
 * accents through the rest, per category.
 *
 * The dominant is resolved lazily against the pool `placeNature` hands over, so this never reads
 * the catalog itself and cannot disagree with what the run is actually allowed to plant. That is
 * also what lets `succession.ts` reuse this for an aged stand: one picker per maturity tier, handed
 * that tier's pool, gives the tier a dominant of its own by the same policy.
 */
export function buildCommunity(field: HabitatField, centre: number, seed: number): SpeciesPicker {
  const dominants = new Map<ItemCategory, string>();
  return (category, pool, x, y, i) => {
    if (pool.length <= 1) return pool[0] ?? '';
    let dominant = dominants.get(category);
    if (dominant === undefined) {
      dominant = dominantSpecies(pool, field, centre, (seed ^ salt(category)) >>> 0);
      dominants.set(category, dominant);
    }
    const { fits, best } = fitnessRow(pool, habitatAt(field, i));
    const di = pool.indexOf(dominant);
    const cs = salt(category);
    if (hash01(seed, cs, x, y, 1) < DOMINANT_SHARE && fits[di]! >= DOMINANT_MIN_SHARE * best) return dominant;
    // The accents are everything else, weighted by how well it suits this cell. Excluding the
    // dominant rather than letting it win again is what makes the share above a share.
    const weights = fits.map((f, k) => (k === di ? 0 : f));
    return weightedPick(pool, weights, hash01(seed, cs, x, y, 2));
  };
}
