// The contracts the generation layer shares.
export type { MacroCoord, MapTemplate } from '../../../core/model/types';

/** The scenery richness a recipe that names none generates at, and the generate shelf's starting value. */
export const DEFAULT_RICHNESS = 0.7;

/** The final, certified-valid terrain plan handed to commit. */
export interface TerrainPlan {
  width: number; height: number;
  tier: Int8Array;   // mountain elevation 1..maxTier, or 0 = ground (no terrain)
  water: Int8Array;  // water elevation, or -1 = none (mutually exclusive with tier>0)
}
