/**
 * The unity operator (one theme per region: everything in a region shares one style) and the colour vocabulary it works in.
 *
 * A plant's colour family is its catalog item's own `plant.colorFamily`: the colour it reads as at
 * map scale, its bloom where the plant is grown for the bloom and its foliage where the foliage is
 * the mass. Generation never reads model data.
 *
 * The operator is `planPalettes`: each region draws one dominant family plus an accent, and a region
 * prefers a family none of its neighbours took. Dominant rather than equal, because a region's unity
 * is one family over 60% of its decor — two families split evenly is a region with no
 * palette at all.
 *
 * Pure and deterministic per (seed, plan, catalog). No state, no commands, no browser API.
 */
import { COLOR_FAMILIES, type ColorFamily } from '../../../../core/model/types';
import type { CategoryRole } from '../../../../core/model/traits';
import { makeRng } from '../../../../core/base/rng';
import { getAllItems, getCatalogItem, getPlaceableByRole } from '../../../../state/catalog';
import { BRANCH_W, TRUNK_W } from '../types';
import type { DesignPlan, RegionPlan } from '../types';

/** The colour family of a plant from its catalog item, 'unknown' for an item that names none. One
 *  answer, so the kits and any reading of a region's colour unity cannot disagree. */
export function familyOf(catalogId: string): string {
  return getCatalogItem(catalogId)?.plant?.colorFamily ?? 'unknown';
}

// --- the species a family offers ----------------------------------------------------------------

/** Species by role and family, keyed by the offered catalog they were read from. */
const speciesCache = new WeakMap<ReturnType<typeof getAllItems>, Map<string, string[]>>();

/** Every placeable item of the category playing `role` whose family is `family`, in catalog order. */
export function speciesOf(role: CategoryRole, family: string): string[] {
  const offered = getAllItems();
  let cache = speciesCache.get(offered);
  if (!cache) { cache = new Map(); speciesCache.set(offered, cache); }
  const key = `${role}:${family}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const out = getPlaceableByRole(role)
    .map((i) => i.id)
    .filter((id) => familyOf(id) === family);
  cache.set(key, out);
  return out;
}

/** The families that carry at least one flower. The unity operator draws from these, since a region
 *  whose dominant family has no flower in it cannot lay a bed. */
function flowerFamilies(): ColorFamily[] {
  return COLOR_FAMILIES.filter((f) => speciesOf('groundcover', f).length > 0);
}

// --- a region's palette ---------------------------------------------------------------------------

/** What a plant is for in a composition. `mass` carries the region (the beds), `edge` runs the
 *  borders, `accent` is the second family's punctuation, `grove` and `grove-accent` are its trees. */
export type PlantRole = 'mass' | 'edge' | 'accent' | 'grove' | 'grove-accent';

export interface RegionPalette {
  regionId: string;
  /** The family that must dominate the region's decor. */
  primary: ColorFamily;
  /** The second family, used for punctuation only. */
  accent: ColorFamily;
  /** The species this region plants in a role. Stable per role, so a block is one species and two
   *  blocks of the same role across the region match — which is what a same-species run is. */
  species(role: PlantRole): string;
}

/** How far apart two places may stand and still count as neighbours for the palette: a branch
 *  street plus the clear margin either side of it, which is the closest two places can stand with a
 *  street between them, and so the distance at which two of them are seen together. */
const NEIGHBOUR_GAP = BRANCH_W + 2 * TRUNK_W;
/** What a family already taken by a neighbour costs against the sampler's own preference. */
const REPEAT_PENALTY = 1.5;

/**
 * One palette per region: a dominant family, an accent, and the species each role plants.
 *
 * Neighbours are asked first — a family standing next door costs `REPEAT_PENALTY`, so two lots seen
 * together read as two places rather than one. The pass is greedy in plan order rather than a
 * colouring: a region whose every neighbour is already spoken for takes the least-repeated family
 * instead of failing, since a palette is a preference and the map must still be planted.
 */
export function planPalettes(plan: DesignPlan, seed: number): Map<string, RegionPalette> {
  const rng = makeRng((seed ^ 0x9a1e77e) >>> 0);
  const pool = flowerFamilies();
  const chosen = new Map<string, ColorFamily>();
  const out = new Map<string, RegionPalette>();

  for (const region of plan.regions) {
    const neighbours = plan.regions.filter((r) => r.id !== region.id && chosen.has(r.id)
      && lotGap(region, r) <= NEIGHBOUR_GAP);
    const taken = new Set(neighbours.map((r) => chosen.get(r.id)!));
    let best = pool[0]!, bestScore = -Infinity;
    for (const family of pool) {
      const score = rng.float() - (taken.has(family) ? REPEAT_PENALTY : 0);
      if (score > bestScore) { bestScore = score; best = family; }
    }
    chosen.set(region.id, best);
    const others = pool.filter((f) => f !== best);
    const accent = others.length ? others[rng.int(others.length)]! : best;
    out.set(region.id, makePalette(region.id, best, accent, rng.int(0xffff)));
  }
  return out;
}

/** Chebyshev gap between two regions' lots: 0 where they touch. */
function lotGap(a: RegionPlan, b: RegionPlan): number {
  const ra = a.lot[0], rb = b.lot[0];
  if (!ra || !rb) return Infinity;
  const dx = Math.max(0, Math.max(ra.x - (rb.x + rb.w), rb.x - (ra.x + ra.w)));
  const dy = Math.max(0, Math.max(ra.y - (rb.y + rb.h), rb.y - (ra.y + ra.h)));
  return Math.max(dx, dy);
}

/**
 * The species table behind one palette.
 *
 * A tree role falls back to green where the region's own family carries no tree (nine of the twelve
 * trees are green foliage), and the flower roles never do: the family was drawn from the ones that
 * carry flowers in the first place, so the mass a region is read by is always in its own colour.
 */
function makePalette(
  regionId: string, primary: ColorFamily, accent: ColorFamily, salt: number,
): RegionPalette {
  const pick = (role: CategoryRole, family: ColorFamily, offset: number): string => {
    const list = speciesOf(role, family);
    if (list.length) return list[(salt + offset) % list.length]!;
    const green = speciesOf(role, 'green');
    if (green.length) return green[(salt + offset) % green.length]!;
    const any = getPlaceableByRole(role);
    return any.length ? any[(salt + offset) % any.length]!.id : '';
  };
  const table: Record<PlantRole, string> = {
    mass: pick('groundcover', primary, 0),
    edge: pick('groundcover', primary, 1),
    accent: pick('groundcover', accent, 2),
    grove: pick('canopy', primary, 0),
    'grove-accent': pick('canopy', accent, 1),
  };
  return { regionId, primary, accent, species: (role) => table[role] };
}
