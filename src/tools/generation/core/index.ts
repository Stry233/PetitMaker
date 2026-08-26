/**
 * THE GENERATION FLOOR: what every generator here stands on, and its door.
 *
 * Behind it, three files and nothing else — a cell-set helper answers to no generator and belongs to
 * `core/model/geometry` rather than here:
 *
 *   types.ts     what a finished terrain plan IS — two Int8Arrays over the grid, tier and water
 *   commit.ts    a certified plan turned into the PaintTerrain commands the executor accepts,
 *                bottom-up so no layer is asked to float
 *   repair.ts    the decrease-only fixpoint that certifies one, plus the scratch state it validates
 *                against (one per template, reused: a run validates a plan hundreds of times)
 *   seam.ts      what a run confined to a REGION owes the map around it: the ground the outside
 *                leans on, handed back before the commit so the seam is legal by construction, plus
 *                the reading of whether the run got to build anything after paying that debt
 *
 * `terrain-generator.ts` above is the FACADE that dispatches a recipe; this is the floor under all
 * three generators. Nothing here knows about a store, a view or an editor session, which is what
 * lets `kit/operations/transfer.ts` build a map with it outside any generator at all.
 *
 * WHAT CROSSES IT. Two callers: a transfer plans terrain for a destination template and commits it
 * without running a generator, and a run (`kit/operations/generate.ts`) repairs the seam of a
 * region-confined generation, which is a property of the RUN rather than of any one generator. The
 * three generators beside this floor import its files directly, as peers of one implementation do
 * throughout `tools/` (see the paint door for why).
 */
export { planToCommands } from './commit';
export { makeScratchState, repairPlan } from './repair';
export { readRegionBase, regionUnbuilt, repairRegionSeam } from './seam';
export type { RegionBase, SeamRepair } from './seam';
export type { TerrainPlan } from './types';
