/**
 * The generation module's door: a recipe in, a built map out, and the clearing a run stands on.
 *
 * Behind it, `generate.ts` dispatches a recipe to the three generators, each behind its own
 * door: `designer/` (the planet), `maze/` (a labyrinth carved into the buildable region) and
 * `stencil/` (a picture read as terrain). All three stand on `terrain-plan/`: the designer repairs
 * a terrain plan into a legal one and commits it bottom-up, the maze and stencil raise their columns
 * through the same bottom-up climb, and every run clears its scope and owes the ground around a
 * region the seam repair. `recipe.ts` is the recipe's vocabulary and a door of its own: the
 * shelf, saves and share codes read it without the generators. `transfer/` carries a build onto
 * another planet's template and is a door of its own.
 *
 * What crosses it. `tools/generation/run/generation-run.ts` runs a recipe and clears a run's scope through
 * here, and Help figures run the same call. A caller that needs a generator's own readings ahead of
 * a run (the shelf snapping maze marks, rasterizing a word) uses that generator's door.
 */
export { clearForRun, generateTerrain, type GenerateResult } from './generate';
export { clearAllObjects, clearAllTerrain } from './terrain-plan/clear';
export { isPrintGeneration } from './stencil/print-clear';
export type { GenerationContext, MapWriter } from './terrain-plan/types';
