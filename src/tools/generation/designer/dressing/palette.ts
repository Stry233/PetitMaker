/**
 * The UNITY operator (主题统一: 同一个区域里的东西，风格要一致) and the colour vocabulary it works in.
 *
 * THE TABLE IS AUTHORED, not derived. The catalog carries no colour field for a plant, and the
 * derivation `color-family.ts` offers — the hue of an item's largest non-foliage, non-trunk part — is
 * right for a flower and wrong for a tree: with the greens excluded, the largest part left on an apple
 * tree is its apple and on a bamboo a stray culm highlight, which reads nine green trees as yellow,
 * pink and red. `PLANT_FAMILIES` is authored from each item's own icon under one rule:
 *
 *   a plant's family is the colour it READS as at map scale — its bloom where the plant is grown for
 *   the bloom (every flower, and a flowering shrub), its foliage where the foliage is the mass (every
 *   tree, whose canopy dwarfs its fruit).
 *
 * So the trees are three coloured ones (peach pink, ginkgo yellow, flame orange) against nine greens,
 * which is what the icons show. `familyOf` falls back to the derivation for an id the table does not
 * know, so a catalog addition joins a family rather than going missing.
 *
 * THE OPERATOR is `planPalettes`: each region draws ONE dominant family plus an accent, and a region
 * prefers a family none of its neighbours took. Dominant rather than equal, because the unity score
 * asks for one family over 60% of a region's decor — two families split evenly is a region with no
 * palette at all.
 *
 * Pure and deterministic per (seed, plan, catalog). No state, no commands, no browser API.
 */
import { ItemCategory } from '../../../../core/model/types';
import { makeRng } from '../../../../core/model/rng';
import { catalogEpoch, getPlaceableByCategory } from '../../../../state/catalog';
import { colorFamily } from './color-family';
import { BRANCH_W, TRUNK_W } from '../streets/streets';
import type { DesignPlan, RegionPlan } from '../types';

/** The families the authored table uses. `hueFamily`'s neutrals (grey, black, brown) name no plant and
 *  are absent. */
export type ColorFamily =
  | 'red' | 'orange' | 'yellow' | 'green' | 'cyan' | 'blue' | 'purple' | 'pink' | 'white';

/** One line per plant, the tree list first. The comment on a row is what the icon shows. */
export const PLANT_FAMILIES: Readonly<Record<string, ColorFamily>> = {
  // Trees: the canopy is the mass, so all but three read green.
  'tree-apple': 'green',        // green canopy, one red apple
  'tree-avocado': 'green',      // green canopy, one purple fruit
  'tree-bamboo': 'green',
  'tree-baobab': 'green',       // green crown over a pale trunk
  'tree-cactus': 'green',
  'tree-dragonblood': 'green',
  'tree-fir': 'green',
  'tree-flame': 'orange',
  'tree-ginkgo': 'yellow',      // gold fan leaves
  'tree-mango': 'green',        // green canopy, one yellow fruit
  'tree-peach': 'pink',
  'tree-plum': 'green',         // green canopy, one orange plum

  // Flora: the bloom, which every one of these items is named for.
  'flower-agapanthus': 'purple',
  'flower-agapanthus-blue': 'blue',
  'flower-agapanthus-white': 'white',
  'flower-amaryllis': 'red',
  'flower-amaryllis-orange': 'orange',
  'flower-amaryllis-white': 'white',
  'flower-bellflower': 'white',
  'flower-bellflower-cyan': 'cyan',
  'flower-bellflower-yellow': 'yellow',
  'flower-canna-gold': 'orange',
  'flower-canna-red': 'red',
  'flower-canna-yellow': 'yellow',
  'flower-dahlia': 'yellow',
  'flower-dahlia-cyan': 'cyan',
  'flower-dahlia-orange': 'orange',
  'flower-daisy': 'white',
  'flower-daisy-cyan': 'cyan',
  'flower-daisy-yellow': 'yellow',
  'flower-lily': 'white',
  'flower-lily-cyan': 'cyan',
  'flower-lily-yellow': 'yellow',
  'flower-portulaca-purple': 'purple',
  'flower-portulaca-white': 'white',
  'flower-portulaca-yellow': 'yellow',
  'flower-protea': 'white',
  'flower-protea-purple': 'purple',
  'flower-protea-red': 'pink',   // named red, drawn a dusty rose
  'flower-rose': 'pink',
  'flower-rose-blue': 'blue',
  'flower-rose-cyan': 'cyan',
  'flower-sunflower': 'yellow',
  'flower-sunflower-green': 'green',
  'flower-sunflower-red': 'red',
  'flower-violet': 'purple',
  'flower-violet-cyan': 'cyan',
  'flower-violet-pink': 'pink',
  'plant-agave': 'green',
  'plant-azalea': 'pink',        // a flowering shrub: the blooms are why it is planted
  'plant-gardenia': 'white',
  shrub: 'green',
};

/** The colour family of a plant: the authored table, or the model-derived reading for an id it does
 *  not carry. One answer, so the kits and the evaluation's unity score cannot disagree. */
export function familyOf(catalogId: string): string {
  return PLANT_FAMILIES[catalogId] ?? colorFamily(catalogId);
}

// --- the species a family offers ----------------------------------------------------------------

const speciesCache = new Map<string, string[]>();
/** The catalog the cache was built from. A test fixture registered at runtime adds species the cache
 *  would otherwise never see, and the catalog's own epoch is what says so without an upward import. */
let cacheEpoch = -1;

/** Every placeable item of `category` whose family is `family`, in catalog order. */
export function speciesOf(category: ItemCategory, family: string): string[] {
  if (cacheEpoch !== catalogEpoch()) { speciesCache.clear(); cacheEpoch = catalogEpoch(); }
  const key = `${category}:${family}`;
  const hit = speciesCache.get(key);
  if (hit) return hit;
  const out = getPlaceableByCategory(category)
    .map((i) => i.id)
    .filter((id) => familyOf(id) === family);
  speciesCache.set(key, out);
  return out;
}

/** The families that carry at least one flower. The unity operator draws from these, since a region
 *  whose dominant family has no flower in it cannot lay a bed. */
export function flowerFamilies(): ColorFamily[] {
  return FAMILIES.filter((f) => speciesOf(ItemCategory.Flora, f).length > 0);
}

const FAMILIES: readonly ColorFamily[] =
  ['red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'purple', 'pink', 'white'];

// --- a region's palette ---------------------------------------------------------------------------

/** What a plant is FOR in a composition. `mass` carries the region (the beds), `edge` runs the
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
 * A tree role falls back to GREEN where the region's own family carries no tree (nine of the twelve
 * trees are green foliage), and the flower roles never do: the family was drawn from the ones that
 * carry flowers in the first place, so the mass a region is read by is always in its own colour.
 */
function makePalette(
  regionId: string, primary: ColorFamily, accent: ColorFamily, salt: number,
): RegionPalette {
  const pick = (category: ItemCategory, family: ColorFamily, offset: number): string => {
    const list = speciesOf(category, family);
    if (list.length) return list[(salt + offset) % list.length]!;
    const green = speciesOf(category, 'green');
    if (green.length) return green[(salt + offset) % green.length]!;
    const any = getPlaceableByCategory(category);
    return any.length ? any[(salt + offset) % any.length]!.id : '';
  };
  const table: Record<PlantRole, string> = {
    mass: pick(ItemCategory.Flora, primary, 0),
    edge: pick(ItemCategory.Flora, primary, 1),
    accent: pick(ItemCategory.Flora, accent, 2),
    grove: pick(ItemCategory.Tree, primary, 0),
    'grove-accent': pick(ItemCategory.Tree, accent, 1),
  };
  return { regionId, primary, accent, species: (role) => table[role] };
}
