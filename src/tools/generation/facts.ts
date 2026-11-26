/**
 * What a surface reads about generation without running it: the kinds with their engine traits and knobs, the
 * recipe ranges, the stencil floors and materials, which items a letter tiles with, how long its
 * text runs and the letters a batch deals, what a scope asks of the region brush, and the seed arithmetic a batch is dealt by.
 */
export {
  CANDIDATES, DRAWN_SEED_MAX, KIND_ENGINE, SEED_MAX, batchSeeds, fillTakesElevation, fillTakesItem, isStencilKind, kindNeeds, newSeed, parseSeed,
  type GenerateKind, type KindEngine,
} from './kinds';
export { MAZE_MAX_ELEVATION, RECIPE_RANGES } from './recipe';
export { STENCIL_MIN_SIDE, tilesAShape } from './stencil/stencil';
export { limitTextGraphemes } from './stencil/stencil-text-segments';
export { LETTER_SAMPLES } from './stencil/letter-samples';
export { SCOPE_TOOLS_FOR, scopeFallsShort, scopeRequestFor } from './scope';
export type { StencilFillKind } from './stencil/fill-recipes';
