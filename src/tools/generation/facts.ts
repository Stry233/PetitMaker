/**
 * What a surface reads about generation without running it: the kinds and their engine traits, the
 * recipe ranges, the stencil floors and materials, and the seed arithmetic a batch is dealt by.
 */
export {
  CANDIDATES, DRAWN_SEED_MAX, KIND_ENGINE, RICHNESS_PERCENT_MAX, SEED_MAX, batchSeeds, fillLaysTerrain, isStencilKind, newSeed, parseSeed,
  regionFitsStencil, type GenerateKind, type KindEngine, type KindSettings, type StencilKind,
} from './kinds';
export { MAZE_MAX_ELEVATION, RECIPE_RANGES, type MazeGates } from './recipe';
export { STENCIL_MIN_SIDE } from './stencil/stencil';
export type { StencilFillKind } from './stencil/fill-recipes';
