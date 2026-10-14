/**
 * Culture and activity: library, stage/small theatre, chess garden, music corner.
 *
 * The formal family: these are the places a plan is read in, so their compositions are the most
 * strictly mirrored of the five. The chess garden is the one theme in the whole library that is
 * drawn as a period-2 alternation of two species rather than as a block, the planet's most repeated
 * formal mark.
 */
import type { CultureTheme } from '../types';
import type { KitSpec } from './types';

export const CULTURE_KITS: Record<CultureTheme, KitSpec> = {
  // Beds edged with runs, a quiet floor.
  library: {
    tile: { w: 5, h: 5 }, appetite: 0.9,
    mix: [['bed', 3], ['border', 2], ['open', 3], ['orchard', 2]],
  },
  // Open in front (a stage stands high, facing the sky), trees behind.
  stage: {
    tile: { w: 5, h: 6 }, appetite: 0.7, aisle: true,
    mix: [['open', 4], ['grove', 3], ['orchard', 2], ['border', 1]],
  },
  // The board itself.
  'chess-garden': {
    tile: { w: 4, h: 4 }, appetite: 1.0,
    mix: [['checker', 5], ['border', 1], ['orchard', 1], ['open', 2]],
  },
  // Small beds, a corner rather than a ground.
  'music-corner': {
    tile: { w: 4, h: 4 }, appetite: 0.8,
    mix: (rng) => [['bed', 3], ['border', 1], ['open', 3], ['grove', rng.int(2) + 2]],
  },
};
