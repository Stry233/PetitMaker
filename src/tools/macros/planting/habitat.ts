/**
 * The habitat field: what the ground under a smart-planting press is like, as three per-cell
 * gradients (moisture, exposure, edge), the species preferences that read them, and the community
 * a press plants. All are derived from the run's `PlacementAnalysis` and the press seed, so the
 * ghost's cache key (macro id, options, map versions) covers everything here.
 *
 * The seam is `placeNature`'s species picker: it decides where a plant goes from its own seeded
 * stream and only then asks what it is, so a picker changes which plants without moving the cells
 * that receive them, sees the cell it answers for, and costs nothing for cells never planted. The
 * picker draws no randomness (every choice hashes the press seed and the cell), so the placement
 * stream cannot shift.
 *
 * Each species' wants are its row in `config/catalog/plant-species.ts`, through the item's
 * `plant.species`.
 */
import { fnv1a32, hashInts01 } from '../../../core/base/hash';
import { clamp01, smoothstep } from '../../../core/base/math';
import { stepDistance } from '../../../core/grid/cell-sets';
import type { CategoryId } from '../../../core/model/types';
import { makeRng } from '../../../core/base/rng';
import type { Rect } from '../../../core/grid/rect';
import type { PlacementAnalysis } from '../../placement/analysis';
import type { SpeciesPicker } from './nature';
import { getCatalogItem } from '../../../state/catalog';
import { plantSpecies, type HabitatResponse, type HabitatWants } from '../../../config/catalog/plant-species';

/** How far from water a cell is still damp ground, in cells. Past it the shoreline is not a
 *  habitat any more, it is the same dry meadow as anywhere else. */
const MOISTURE_REACH = 8;
/** How far the wind off a cliff carries, in cells. */
const CLIFF_REACH = 3;
/** The tier at which height alone counts as fully exposed. Higher than
 *  that a plateau is a ridge whatever else is around it. */
const EXPOSURE_TIER_SPAN = 4;
/** How far in from the last plantable cell still reads as the margin of the ground. */
const EDGE_REACH = 4;

/** One cell's habitat, all three axes on 0..1. */
interface Habitat {
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
 * sits on rather than the disc's own rim. That matters for edge: measured off the restricted mask
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

  // A cliff is a step between two pieces of ground. A shoreline is not one: what a shore does to a
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

  const distToCliff = cliffs.length ? stepDistance(cliffs, W, H) : null;
  const distToOff = offGround.length ? stepDistance(offGround, W, H) : null;

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
function habitatAt(f: HabitatField, i: number): Habitat {
  return { moisture: f.moisture[i] ?? 0, exposure: f.exposure[i] ?? 0, edge: f.edge[i] ?? 0 };
}

/** A species' response along one axis (`HabitatResponse`): a wide `tol` is a species that grows
 *  anywhere, which is a real thing to say about a plant and not a missing entry. */
interface HabitatPreference { moisture: HabitatResponse; exposure: HabitatResponse; edge: HabitatResponse }

/** Whatever a species has no opinion about. */
const INDIFFERENT: HabitatResponse = { at: 0.5, tol: 1.2 };
const pref = (p: HabitatWants): HabitatPreference => ({
  moisture: p.moisture ?? INDIFFERENT, exposure: p.exposure ?? INDIFFERENT, edge: p.edge ?? INDIFFERENT,
});

/** The resolved row per catalog id, asked once per candidate species per planted cell. An id the
 *  catalog does not carry is read as a species id itself. Ids come from the placeable pools, so the
 *  map holds one row per plant; `RESOLVED_MAX` bounds it against a caller naming arbitrary ids. */
const resolved = new Map<string, HabitatPreference>();
const RESOLVED_MAX = 1024;

/** Nothing is impossible, only unlikely: a floor keeps a species that fits nowhere on the map from
 *  making the weighted draw undefined, without letting it compete with one that fits. */
const FITNESS_FLOOR = 1e-3;

const response = (r: HabitatResponse, v: number): number => Math.exp(-(((v - r.at) / r.tol) ** 2));

/**
 * How well a species suits a cell, 0..1. The three axes multiply: a plant that wants shade and
 * water is not half-suited to a dry ridge, it is absent from one.
 *
 * The number is only ever meaningful against another species at the same cell. Three multiplied
 * gaussians land low almost everywhere — a flat, dry, interior cell scores the best-suited plant in
 * the catalog under 0.3 — so an absolute threshold anywhere in this module would read a perfectly
 * ordinary meadow as ground nothing wants to grow on. Everything downstream compares.
 */
function speciesFitness(catalogId: string, h: Habitat): number {
  let p = resolved.get(catalogId);
  if (!p) {
    const species = plantSpecies(getCatalogItem(catalogId)?.plant?.species ?? catalogId);
    p = pref(species?.habitat ?? {});
    if (resolved.size >= RESOLVED_MAX) resolved.clear();
    resolved.set(catalogId, p);
  }
  const f = response(p.moisture, h.moisture) * response(p.exposure, h.exposure) * response(p.edge, h.edge);
  return Math.max(f, FITNESS_FLOOR);
}

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
 * The species this press is a stand of, drawn from the seed against the habitat at the aim point.
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
 * The species policy for one press: a seed-derived dominant over most of the stand, habitat-sorted
 * accents through the rest, per category.
 *
 * The dominant is resolved lazily against the pool `placeNature` hands over, so this never reads
 * the catalog itself and cannot disagree with what the run is actually allowed to plant. That is
 * also what lets `succession.ts` reuse this for an aged stand: one picker per maturity tier, handed
 * that tier's pool, gives the tier a dominant of its own by the same policy.
 */
export function buildCommunity(field: HabitatField, centre: number, seed: number): SpeciesPicker {
  const dominants = new Map<CategoryId, string>();
  return (category, pool, x, y, i) => {
    if (pool.length <= 1) return pool[0] ?? '';
    let dominant = dominants.get(category);
    if (dominant === undefined) {
      dominant = dominantSpecies(pool, field, centre, (seed ^ fnv1a32(category)) >>> 0);
      dominants.set(category, dominant);
    }
    const { fits, best } = fitnessRow(pool, habitatAt(field, i));
    const di = pool.indexOf(dominant);
    // A salt per category: the tree and flora communities under one press are independent draws.
    const cs = fnv1a32(category);
    if (hashInts01(seed, cs, x, y, 1) < DOMINANT_SHARE && fits[di]! >= DOMINANT_MIN_SHARE * best) return dominant;
    // The accents are everything else, weighted by how well it suits this cell. Excluding the
    // dominant rather than letting it win again is what makes the share above a share.
    const weights = fits.map((f, k) => (k === di ? 0 : f));
    return weightedPick(pool, weights, hashInts01(seed, cs, x, y, 2));
  };
}

/** The side, in cells, of one patch of a planting large enough to hold several: about the extent
 *  over which one species leads a stand before the ground or chance hands it to another. */
export const PATCH_SPAN = 24;
/** How far, in cells, two neighbouring patches interleave across their border. */
const PATCH_BLEND = 4;
const PATCH_SALT = 0x2c1b3c6d;

/**
 * The species policy for an area: one community (`buildCommunity`) for an area that fits a single
 * patch, and otherwise a community per patch, each with its own dominant chosen for the ground at
 * the patch's site. Sites stand on a jittered grid about `PATCH_SPAN` apart over `bounds`; a cell
 * belongs to the nearest site, and within `PATCH_BLEND` of a border it may take the neighbour's, so
 * stands meet in a mixed margin. `centre` is the single community's site.
 */
export function buildAreaCommunity(
  field: HabitatField, bounds: Rect, mapWidth: number, centre: number, seed: number,
): SpeciesPicker {
  const nx = Math.max(1, Math.round(bounds.w / PATCH_SPAN));
  const ny = Math.max(1, Math.round(bounds.h / PATCH_SPAN));
  if (nx * ny === 1) return buildCommunity(field, centre, seed);
  const sx = bounds.w / nx, sy = bounds.h / ny;
  const sites: { x: number; y: number; pick: SpeciesPicker }[] = [];
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const x = Math.floor(bounds.x + sx * (i + 0.15 + 0.7 * hashInts01(seed, PATCH_SALT, i, j, 1)));
      const y = Math.floor(bounds.y + sy * (j + 0.15 + 0.7 * hashInts01(seed, PATCH_SALT, i, j, 2)));
      const patchSeed = (seed ^ Math.imul(j * nx + i + 1, PATCH_SALT)) >>> 0;
      sites.push({ x, y, pick: buildCommunity(field, y * mapWidth + x, patchSeed) });
    }
  }
  return (category, pool, x, y, i) => {
    let first = 0, second = 0, d1 = Infinity, d2 = Infinity;
    sites.forEach((s, k) => {
      const d = Math.hypot(s.x - x, s.y - y);
      if (d < d1) { second = first; d2 = d1; first = k; d1 = d; } else if (d < d2) { second = k; d2 = d; }
    });
    const margin = d2 - d1;
    const blended = margin < PATCH_BLEND && hashInts01(seed, PATCH_SALT, x, y, 3) < 0.5 * (1 - margin / PATCH_BLEND);
    return sites[blended ? second : first]!.pick(category, pool, x, y, i);
  };
}
