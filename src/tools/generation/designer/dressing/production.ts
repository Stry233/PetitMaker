/**
 * Production and daily life: planting area, orchard, small-animal run.
 *
 * The most regular family, and the one a flat garden town is built almost entirely out of: tree
 * blocks as exact lattices and flower fields as step-1 solids. A crop area is striped, an orchard is a
 * lattice, and a run is the open ground a fence encloses.
 */
import type { ProductionTheme } from '../types';
import type { KitSpec } from './types';

export const PRODUCTION_KITS: Record<ProductionTheme, KitSpec> = {
  // Crop rows.
  'crop-field': {
    tile: { w: 7, h: 6 }, appetite: 1.3,
    mix: [['rows', 5], ['bed', 2], ['orchard', 1], ['open', 2]],
  },
  // The step-2 lattice, at an orchard's scale.
  orchard: {
    tile: { w: 7, h: 6 }, appetite: 1.2,
    mix: [['orchard', 6], ['grove', 3], ['open', 2]],
  },
  // Open ground with a planted rail round it.
  'animal-run': {
    tile: { w: 6, h: 6 }, appetite: 0.5,
    mix: (rng) => [['open', 5], ['border', 2], ['grove', 2 + rng.int(2)]],
  },
};
