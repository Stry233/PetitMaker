/**
 * Food and leisure, the places people sit and eat: cafe, teahouse, picnic area, banquet ground, seaside
 * light dining.
 *
 * The game's own guidance illustrates these with furniture (loungers, tables and chairs), and the catalog
 * carries none: its non-anchor items are trees, flora and road coatings, and the two facilities are
 * anchors the hard rule places exactly once. So a leisure place is drawn the only way the vocabulary
 * allows — an open court with the planting held back to its edges, which is what a set of tables
 * reads as from above. The aisle is the walk between them.
 */
import type { FoodLeisureTheme } from '../types';
import type { KitSpec } from './types';

export const FOOD_LEISURE_KITS: Record<FoodLeisureTheme, KitSpec> = {
  // A cafe stands beside a park, so it keeps its own ground open and low:
  // beds against the edges, the middle left as the terrace people sit on.
  cafe: {
    tile: { w: 5, h: 5 }, appetite: 0.9, aisle: true,
    mix: [['border', 2], ['bed', 2], ['open', 3], ['grove', 2]],
  },
  // The quiet one: a still pool, a chequered garden floor, little else.
  teahouse: {
    tile: { w: 4, h: 4 }, appetite: 0.8, pools: 1,
    mix: [['border', 2], ['checker', 2], ['open', 3], ['grove', 2]],
  },
  // Lawn with shade over it.
  picnic: {
    tile: { w: 6, h: 5 }, appetite: 0.7,
    mix: [['open', 4], ['grove', 3], ['orchard', 2], ['bed', 2]],
  },
  // A long table: striped ground either side of a walk.
  banquet: {
    tile: { w: 5, h: 6 }, appetite: 0.9, aisle: true,
    mix: [['rows', 3], ['border', 2], ['orchard', 2], ['open', 2]],
  },
  // Water first (seaside dining stands at the shore), planting as a rim around it.
  'seaside-dining': {
    tile: { w: 5, h: 5 }, appetite: 0.8, pools: (rng) => rng.int(2) === 0 ? 1 : 2,
    mix: [['border', 3], ['bed', 2], ['open', 3], ['grove', 2]],
  },
};
