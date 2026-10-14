/**
 * The generation floor every generator stands on, and its door:
 *
 *   types.ts     a terrain plan (tier and water Int8Arrays over the grid) and the run context
 *   commit.ts    bottom-up so no layer floats: a certified plan as PaintTerrain commands, and the
 *                executing climb (`raiseBottomUp`, `paintLayer`) for targets no repair certified
 *   repair.ts    the decrease-only fixpoint that certifies one, with per-template scratch state
 *   seam.ts      what a region-confined run owes the map around it, handed back before the commit
 *   clear.ts     the clearing a run and Clear share: unlocked objects, then terrain, in scope
 *
 * Nothing here knows a store, view or session. The generators and the carry beside them (`transfer/`,
 * which plans and commits terrain for a destination template without a generator) use this door;
 * from outside, a run (`tools/generation/run/generation-run.ts`) repairs a region-confined generation's
 * seam through it.
 */
export { paintLayer, planToCommands, raiseBottomUp, type RaiseTarget } from './commit';
export { repairPlan } from './repair';
export { readRegionBase, regionUnbuilt, repairRegionSeam } from './seam';
export type { MapWriter, TerrainPlan } from './types';
