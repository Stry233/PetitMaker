/**
 * Natural scenery: park, garden, flower field, bamboo sunken courtyard, lake/fountain, tree avenue, pure
 * mountain-water scenery, canyon.
 *
 * The family that carries most of a map's planting, and the one the two grammars are measured on:
 * a flower field is a step-1 solid block, an avenue and a park are step-2 lattices. The bamboo court
 * (a Chinese-style sunken courtyard in a bamboo grove) is the only theme here that asks the ground to be cut down rather than up: its
 * style declares `sunken`, and the terrain sculpt drops the court a tier below the platform it sits in.
 */
import type { NatureTheme } from '../types';
import type { KitSpec } from './types';

export const NATURE_KITS: Record<NatureTheme, KitSpec> = {
  // Trees with glades between them, which reads as a stand rather than a field.
  park: {
    tile: { w: 7, h: 6 }, appetite: 1.0,
    mix: [['orchard', 4], ['grove', 3], ['bed', 2], ['open', 3]],
  },
  // Beds and the runs that edge them.
  garden: {
    tile: { w: 5, h: 6 }, appetite: 1.2,
    mix: [['bed', 4], ['border', 2], ['open', 2], ['orchard', 2]],
  },
  // The solid colour field, the densest thing a planet plants.
  'flower-field': {
    tile: { w: 7, h: 6 }, appetite: 1.4,
    mix: [['bed', 6], ['rows', 2], ['open', 1], ['orchard', 1]],
  },
  // The court is cut a tier down and the bamboo stands round its rim.
  'bamboo-court': {
    tile: { w: 5, h: 5 }, appetite: 0.9, sunken: true,
    mix: [['orchard', 5], ['grove', 2], ['open', 3], ['border', 1]],
  },
  // The water is the subject; the planting frames the terrace it is cut into.
  'lake-fountain': {
    tile: { w: 5, h: 5 }, appetite: 0.9, pools: 2,
    mix: [['bed', 3], ['border', 2], ['open', 3], ['orchard', 2]],
  },
  // Lattices either side of the walk they shade.
  'tree-avenue': {
    tile: { w: 5, h: 5 }, appetite: 0.9, aisle: true,
    mix: [['orchard', 6], ['grove', 2], ['open', 2]],
  },
  // Scenery, not a garden: kept sparse so the terrain reads.
  'mountain-water': {
    tile: { w: 6, h: 6 }, appetite: 0.6, pools: 1,
    mix: [['open', 4], ['grove', 3], ['orchard', 2], ['border', 1]],
  },
  // The emptiest theme in the library: the bare ground is the subject.
  canyon: {
    tile: { w: 6, h: 6 }, appetite: 0.5,
    mix: (rng) => [['open', 5], ['grove', 3], ['bed', rng.int(2) === 0 ? 1 : 2]],
  },
};
