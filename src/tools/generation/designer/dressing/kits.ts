/**
 * The kit dispatcher: the style one region is built in. Anchors read their kind's kit, themes their
 * theme's, and the two treatments stage C can put on a place answer before either.
 */
import type { Rng } from '../../../../core/base/rng';
import type { RegionPlan, ThemeId } from '../types';
import { ANCHOR_KITS } from './anchor';
import { FOOD_LEISURE_KITS } from './food-leisure';
import { NATURE_KITS } from './nature';
import { PRODUCTION_KITS } from './production';
import { VIEWPOINT_KITS } from './viewpoint';
import { CULTURE_KITS } from './culture';
import { drawStyle, type KitSpec, type KitStyle } from './types';

/** The quiet treatment: an edge run and open ground. Its appetite is a fraction of a themed place's,
 *  so a map whose blocks are mostly quiet reads as ground with edges rather than as a carpet. */
const QUIET_STYLE: KitStyle = {
  tile: { w: 6, h: 5 },
  mix: [['border', 3], ['open', 5], ['bed', 1]],
  appetite: 0.35,
};

/** The planting a water place's dry strips take: 5-wide solid blocks and period-2 two-species rows,
 *  which is what water gardens are planted with. */
function waterStyle(rng: Rng): KitStyle {
  return {
    tile: { w: 5, h: rng.int(2) === 0 ? 6 : 3 },
    mix: rng.int(2) === 0
      ? [['bed', 4], ['rows', 2], ['open', 1]]
      : [['checker', 3], ['bed', 3], ['open', 1]],
    appetite: 1.1,
  };
}

/**
 * The style one region is built in.
 *
 * Quiet is the treatment a block gets where nothing claimed it: a border run along its edge and open
 * ground inside, which is the garden town's own way of saying where a plot ends. It is a treatment
 * rather than an absence — every block on a finished map was decided about.
 *
 * Water is the treatment of a block the sculptor floored with a comb, a ring or a trough. The ground
 * it leaves is narrow dry strips, so the kit plants them the way a water garden does: solid
 * single-species blocks and two-species alternating rows, kept inside one colour family.
 */
export function styleOf(region: RegionPlan, rng: Rng): KitStyle {
  if (region.quiet) return QUIET_STYLE;
  if (region.water) return waterStyle(rng);
  return drawStyle(region.kind === 'theme' ? THEME_KITS[region.themeId] : ANCHOR_KITS[region.kind], rng);
}

/** Every theme's kit, read off its family's table. */
const THEME_KITS = {
  ...FOOD_LEISURE_KITS, ...NATURE_KITS, ...VIEWPOINT_KITS, ...CULTURE_KITS, ...PRODUCTION_KITS,
} satisfies Record<ThemeId, KitSpec>;
