/**
 * The plant species the catalog's trees and flora belong to, and the facts planting reads per
 * species rather than per item. A catalog item names its species in `plant.species`; colourways of
 * one plant (`flower-lily`, `flower-lily-cyan`, `flower-lily-yellow`) are one species, so they share
 * one row here. Two species (`flower-canna`, `flower-portulaca`) have no item of their own name.
 *
 * The values are a garden designer's opinion, not a botanist's: what reads right when a planting
 * lands on a shore, a ridge or a sheltered middle, what reads as young ground cover or as old growth.
 */
import { ItemCategory } from './categories';

/** A species' response along one habitat axis: happiest at `at`, indifferent to a spread of `tol`
 *  either side, effectively absent past about two `tol`. */
export interface HabitatResponse { at: number; tol: number }

/** What a species wants of its ground along each habitat axis, all on 0..1. An axis left out is one
 *  the species has no opinion about. */
export interface HabitatWants {
  moisture?: HabitatResponse;
  exposure?: HabitatResponse;
  edge?: HabitatResponse;
}

export interface PlantSpecies {
  id: string;
  category: ItemCategory.Tree | ItemCategory.Flora;
  /** Its maturity in a held planting's succession: 1 pioneer, 2 establishing, 3 climax. */
  tier: 1 | 2 | 3;
  /** The one grand specimen its category's oldest stand centres on. */
  climax?: true;
  habitat: HabitatWants;
}

export const PLANT_SPECIES: readonly PlantSpecies[] = [
  // Trees.
  { id: 'tree-fir', category: ItemCategory.Tree, tier: 3, habitat: { moisture: { at: 0.35, tol: 0.45 }, exposure: { at: 0.95, tol: 0.5 } } },
  { id: 'tree-ginkgo', category: ItemCategory.Tree, tier: 3, habitat: { moisture: { at: 0.4, tol: 0.45 }, exposure: { at: 0.8, tol: 0.55 } } },
  { id: 'tree-cactus', category: ItemCategory.Tree, tier: 2, habitat: { moisture: { at: 0, tol: 0.25 }, exposure: { at: 0.8, tol: 0.6 } } },
  { id: 'tree-baobab', category: ItemCategory.Tree, tier: 3, climax: true, habitat: { moisture: { at: 0.1, tol: 0.3 }, exposure: { at: 0.6, tol: 0.5 } } },
  { id: 'tree-dragonblood', category: ItemCategory.Tree, tier: 3, habitat: { moisture: { at: 0.15, tol: 0.3 }, exposure: { at: 0.8, tol: 0.45 } } },
  { id: 'tree-flame', category: ItemCategory.Tree, tier: 1, habitat: { moisture: { at: 0.3, tol: 0.35 }, exposure: { at: 0.5, tol: 0.5 }, edge: { at: 0.7, tol: 0.6 } } },
  { id: 'tree-mango', category: ItemCategory.Tree, tier: 2, habitat: { moisture: { at: 0.8, tol: 0.35 }, exposure: { at: 0.15, tol: 0.45 } } },
  { id: 'tree-avocado', category: ItemCategory.Tree, tier: 2, habitat: { moisture: { at: 0.75, tol: 0.35 }, exposure: { at: 0.2, tol: 0.45 } } },
  { id: 'tree-bamboo', category: ItemCategory.Tree, tier: 1, habitat: { moisture: { at: 0.95, tol: 0.3 }, exposure: { at: 0.1, tol: 0.4 }, edge: { at: 0.6, tol: 0.7 } } },
  { id: 'tree-apple', category: ItemCategory.Tree, tier: 2, habitat: { moisture: { at: 0.5, tol: 0.4 }, exposure: { at: 0.25, tol: 0.45 } } },
  { id: 'tree-peach', category: ItemCategory.Tree, tier: 1, habitat: { moisture: { at: 0.5, tol: 0.4 }, exposure: { at: 0.3, tol: 0.45 } } },
  { id: 'tree-plum', category: ItemCategory.Tree, tier: 1, habitat: { moisture: { at: 0.45, tol: 0.4 }, exposure: { at: 0.3, tol: 0.45 } } },

  // Flora. The two ends of the moisture axis are sharp (the waterside lily, the dry agave), so a
  // planting that lands across a shoreline visibly sorts itself. The dry end is wide on exposure:
  // dry ground is not only ridges, and a flat dry meadow needs something characteristic to plant.
  { id: 'flower-lily', category: ItemCategory.Flora, tier: 1, habitat: { moisture: { at: 1, tol: 0.22 }, exposure: { at: 0.1, tol: 0.45 }, edge: { at: 0.7, tol: 0.7 } } },
  { id: 'flower-canna', category: ItemCategory.Flora, tier: 3, habitat: { moisture: { at: 0.85, tol: 0.3 }, exposure: { at: 0.2, tol: 0.5 } } },
  { id: 'flower-agapanthus', category: ItemCategory.Flora, tier: 2, habitat: { moisture: { at: 0.7, tol: 0.35 }, exposure: { at: 0.25, tol: 0.5 } } },
  { id: 'flower-amaryllis', category: ItemCategory.Flora, tier: 3, habitat: { moisture: { at: 0.6, tol: 0.4 }, exposure: { at: 0.25, tol: 0.5 } } },
  { id: 'flower-violet', category: ItemCategory.Flora, tier: 1, habitat: { moisture: { at: 0.6, tol: 0.35 }, exposure: { at: 0.15, tol: 0.4 }, edge: { at: 0.85, tol: 0.5 } } },
  { id: 'flower-bellflower', category: ItemCategory.Flora, tier: 1, habitat: { moisture: { at: 0.55, tol: 0.4 }, exposure: { at: 0.45, tol: 0.5 }, edge: { at: 0.7, tol: 0.6 } } },
  { id: 'flower-dahlia', category: ItemCategory.Flora, tier: 3, habitat: { moisture: { at: 0.5, tol: 0.4 }, exposure: { at: 0.3, tol: 0.5 } } },
  { id: 'flower-rose', category: ItemCategory.Flora, tier: 2, habitat: { moisture: { at: 0.5, tol: 0.4 }, exposure: { at: 0.35, tol: 0.5 }, edge: { at: 0.6, tol: 0.7 } } },
  { id: 'flower-daisy', category: ItemCategory.Flora, tier: 1, habitat: { moisture: { at: 0.45, tol: 0.5 }, exposure: { at: 0.4, tol: 0.6 } } },
  { id: 'flower-sunflower', category: ItemCategory.Flora, tier: 3, habitat: { moisture: { at: 0.35, tol: 0.4 }, exposure: { at: 0.55, tol: 0.5 }, edge: { at: 0.6, tol: 0.7 } } },
  { id: 'flower-protea', category: ItemCategory.Flora, tier: 3, climax: true, habitat: { moisture: { at: 0.2, tol: 0.35 }, exposure: { at: 0.85, tol: 0.45 } } },
  { id: 'flower-portulaca', category: ItemCategory.Flora, tier: 1, habitat: { moisture: { at: 0.05, tol: 0.3 }, exposure: { at: 0.7, tol: 0.7 } } },
  { id: 'plant-agave', category: ItemCategory.Flora, tier: 2, habitat: { moisture: { at: 0, tol: 0.25 }, exposure: { at: 0.7, tol: 0.7 } } },
  { id: 'plant-azalea', category: ItemCategory.Flora, tier: 2, habitat: { moisture: { at: 0.7, tol: 0.3 }, exposure: { at: 0.2, tol: 0.45 }, edge: { at: 0.8, tol: 0.6 } } },
  { id: 'plant-gardenia', category: ItemCategory.Flora, tier: 2, habitat: { moisture: { at: 0.65, tol: 0.35 }, exposure: { at: 0.2, tol: 0.45 } } },
  { id: 'shrub', category: ItemCategory.Flora, tier: 2, habitat: { moisture: { at: 0.5, tol: 0.6 }, edge: { at: 0.6, tol: 0.8 } } },
];

const BY_ID = new Map(PLANT_SPECIES.map((s) => [s.id, s]));

/** The species row for a species id. */
export function plantSpecies(id: string): PlantSpecies | undefined {
  return BY_ID.get(id);
}

/** The hand-drawn set pieces a planting press now and then lays, by the catalog items they name. */
export const PLANT_SET_PIECES = {
  /** The white blooms a fairy ring is made of, in order of preference: the ring is the one piece
   *  whose colour is the whole idea, so the species cannot be drawn from the site. */
  fairyRing: ['flower-agapanthus-white', 'flower-portulaca-white', 'flower-amaryllis-white'],
  /** Two colourways of one species, fill then outline: the same drawing repainted, so a two-colour
   *  heart reads as one shape in two colours rather than as two plants sharing a bed. */
  heartPairs: [
    ['flower-rose', 'flower-rose-blue'],
    ['flower-lily', 'flower-lily-cyan'],
    ['flower-dahlia', 'flower-dahlia-orange'],
    ['flower-violet', 'flower-violet-pink'],
    ['flower-daisy', 'flower-daisy-yellow'],
  ],
} as const satisfies { fairyRing: readonly string[]; heartPairs: readonly (readonly [string, string])[] };
