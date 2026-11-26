/**
 * The generation floor every generator stands on, and its door:
 *
 *   types.ts     a terrain plan (tier and water Int8Arrays over the grid) and the run context
 *   commit.ts    bottom-up so no layer floats: a certified plan or any columns as PaintTerrain
 *                layers, the one refusal-splitting painter (`paintLayer`), and the executing climb
 *                (`raiseBottomUp`) for targets no repair certified
 *   carried.ts   the mass and edge cuts carried terrain lays on another map
 *   scope.ts     a painted region as the predicate a commit, a clear and a build ask
 *   repair.ts    the decrease-only fixpoint that certifies one, with per-template scratch state
 *   seam.ts      what a region-confined run owes the map around it, handed back before the commit
 *   clear.ts     the clearing a run and Clear share: unlocked objects, then terrain, in scope
 *
 * Nothing here knows a store, view or session. The generators, the carry beside them (`transfer/`,
 * which plans and commits terrain for a destination template without a generator) and Blueprint
 * placement use this door; from outside, a run (`tools/generation/run/generation-run.ts`) repairs a region-confined generation's
 * seam through it.
 */
export { buildColumns, paintLayer, planToCommands, raiseBottomUp, type RaiseTarget } from './commit';
export { carriedCut, carriedMass } from './carried';
export { repairPlan } from './repair';
export { readRegionBase, regionUnbuilt, repairRegionSeam } from './seam';
export type { MapWriter, TerrainPlan } from './types';
