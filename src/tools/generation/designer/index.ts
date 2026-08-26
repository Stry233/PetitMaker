/**
 * THE ISLAND GENERATOR'S DOOR, and the map of what is behind it.
 *
 * A run is one call to `generateDesigned` (`pipeline.ts`, the conductor). Everything else here is a
 * STAGE, and each stage is a directory, in the order the pipeline calls them:
 *
 *   composition/  where the mass sits, and the walk a visitor takes through it
 *   streets/      the straight streets that partition the island, their flights and gaps
 *   places/       which regions the map holds, where they sit, and how their buildings stand
 *   terrain/      the ground realized from the plan, and the set piece written into it
 *   water/        the courses, cascades, composed figures and fountain courts cut into that ground
 *   dressing/     the theme kits that fill each place, under the symmetry and unity operators
 *   build/        the stage that touches the map: the region crop, the terrain commit, the paving
 *                 and the crossings
 *   eval/         readings of a FINISHED map — no stage reads them; the harness and the probes do
 *
 * `types.ts` beside them is the PLAN MODEL every stage speaks (region, orientation, theme), and
 * `pipeline.ts` is the only file that touches a map.
 *
 * WHAT CROSSES THIS DOOR. The app reaches the generator through `terrain-generator.ts`, which needs
 * `generateDesigned` alone; the evaluation harness re-derives the two plans it draws a map's story
 * with, which is why they are here as well. Everything else a caller might want is a stage's own
 * business, and a reach past this file into one is a sign the stage boundary is wrong rather than
 * the door. The evaluator has its own door, `eval/index.ts`.
 */
export { generateDesigned, type DesignedContext, type DesignedOutcome } from './pipeline';
export { planComposition, type CompositionPlan } from './composition/composition';
export { planMovementLine, type MovementLine } from './composition/movement-line';
