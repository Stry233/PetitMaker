/**
 * The planet generator's door. A run is one call to `generateDesigned` (`pipeline.ts`); each stage
 * is a directory, in the order the pipeline calls them:
 *
 *   composition/  where the mass sits, and the walk a visitor takes through it
 *   streets/      the straight streets that partition the planet, their flights and gaps
 *   places/       which regions the map holds, where they sit, and how their buildings stand
 *   terrain/      the ground realized from the plan, and the set piece written into it
 *   water/        the courses, cascades, composed figures and fountain courts cut into that ground
 *   dressing/     the theme kits that fill each place, under the symmetry and unity operators
 *   build/        the commits to the map: region crop, terrain commit, paving and crossings
 *
 * `types.ts` is the plan model, `themes.ts` the theme library, `planet.ts` the template readings.
 * Only `pipeline.ts`, `build/` and `dressing/` touch a map. The app and the Help figures need
 * `generateDesigned` alone (through `../generate.ts`); `planDesign` is the pure stages' one order
 * for a caller that reads the plans themselves.
 */
export {
  generateDesigned, planDesign, type DesignBundle, type DesignedContext, type DesignedOutcome, type DesignInput,
} from './pipeline';
export type { CompositionPlan } from './composition/composition';
export type { MovementLine } from './composition/movement-line';
