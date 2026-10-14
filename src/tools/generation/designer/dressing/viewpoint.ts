/**
 * Viewing and photo spots: lookout, panorama platform, waterside deck, text/pattern landmark.
 *
 * A viewing place is defined by what it does not hold: the game's viewing relation asks for an open
 * line in front of where a person stands, so every theme here keeps its middle bare and its planting
 * at the rim. The landmark region is the sparsest of all — the phrase or figure written across it is
 * the composition, and it is laid by its own stage rather than by this kit.
 */
import type { ViewpointTheme } from '../types';
import type { KitSpec } from './types';

export const VIEWPOINT_KITS: Record<ViewpointTheme, KitSpec> = {
  // A rim of trees around the standing ground.
  lookout: {
    tile: { w: 5, h: 5 }, appetite: 0.6, aisle: true,
    mix: [['border', 2], ['orchard', 3], ['open', 4]],
  },
  // The same, planted lower so nothing blocks the view.
  'panorama-deck': {
    tile: { w: 5, h: 5 }, appetite: 0.6, aisle: true,
    mix: [['border', 2], ['bed', 2], ['orchard', 1], ['open', 4]],
  },
  // The walk is the subject and the water beside it is what it is for.
  'waterside-deck': {
    tile: { w: 5, h: 5 }, appetite: 0.7, pools: (rng) => 1 + rng.int(2),
    mix: [['border', 3], ['bed', 2], ['orchard', 1], ['open', 3]],
  },
  // Left almost bare: the glyph is the region.
  'landmark-text': {
    tile: { w: 6, h: 6 }, appetite: 0.3,
    mix: [['open', 6], ['border', 2]],
  },
};
