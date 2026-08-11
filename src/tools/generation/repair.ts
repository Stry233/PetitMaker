// src/tools/generation/repair.ts
import { TerrainType, type GridState, type MapTemplate } from '../../core/model/types';
import { getCell, createDefaultTerrainCell, isBuildableZone, bumpCellsVersion } from '../../core/model/grid-model';
import type { RuleRegistry } from '../../rules/registry';
import { makeScratchState } from './field';
import { TUNING } from './tuning';
import type { TerrainPlan } from './types';

// ONE cached scratch per template, rewritten fully on every call. Callers must consume the
// returned state synchronously and discard it — it is invalid after the next applyPlanToScratch.
// Generation validates plans hundreds of times (repair passes + per-waterfall candidates), so a
// fresh W×H MacroCell grid per call was the pipeline's dominant allocation.
const scratchCache = new WeakMap<MapTemplate, GridState>();

/** Build a GridState whose cells reflect the plan (terrain only on grass), reusing makeScratchState.
 *  Returns a SHARED per-template scratch — valid only until the next applyPlanToScratch call. */
export function applyPlanToScratch(plan: TerrainPlan, template: MapTemplate): GridState {
  let state = scratchCache.get(template);
  if (!state) {
    state = makeScratchState(template); // fresh grass + plaza, no terrain
    scratchCache.set(template, state);
  }
  for (let y = 0; y < plan.height; y++) {
    for (let x = 0; x < plan.width; x++) {
      const cell = getCell(state.cells, x, y);
      if (!cell || !isBuildableZone(cell.zone)) continue;
      const i = y * plan.width + x;
      const w = plan.water[i]!;
      const t = plan.tier[i]!;
      if (w >= 0) setPlainTerrain(cell, TerrainType.Water, w);
      else if (t > 0) setPlainTerrain(cell, TerrainType.Mountain, t);
      else cell.terrain = null;
    }
  }
  // The scratch is a live GridState like any other (state/map-stats.ts caches per cellsVersion);
  // this rewrites it in place on every call, so a future consumer that reads stats off it needs
  // the version bumped or it would read a cache keyed to the PREVIOUS plan's cells.
  bumpCellsVersion(state);
  return state;
}

/** Overwrite a scratch cell's terrain in place when possible (scratch terrain is always a plain
 *  {type, elevation} from createDefaultTerrainCell — never corners/patch fields — so mutation
 *  can't leak stale state). */
function setPlainTerrain(cell: { terrain: ReturnType<typeof createDefaultTerrainCell> | null }, type: TerrainType, elevation: number): void {
  if (cell.terrain) { cell.terrain.type = type; cell.terrain.elevation = elevation; }
  else cell.terrain = createDefaultTerrainCell(type, elevation);
}

/**
 * Make the plan rule-valid by repeatedly validating against the LIVE registry and
 * backing off the flagged cells, until validatePostStroke reports zero violations.
 * The back-off is rule-agnostic — it lowers a mountain a tier or drops a water cell on
 * whatever cells the registry flags — so it converges for any rule whose violations can be
 * resolved by REMOVING terrain (every rule the generator currently relies on), without
 * re-implementing rule logic.
 *
 * Caveat — repair is DECREASE-ONLY: it cannot satisfy a rule that needs terrain ADDED on a
 * flagged cell (e.g. building a waterfall's mountain caps / uniform downstream row when the
 * rule flags a ground cell). Such features must be produced legal-by-construction by the
 * generating stage, not left to repair. TUNING.repairMaxPasses bounds the rare case where a
 * flagged cell has no decreasing move (the loop returns the best-so-far plan).
 * (A future enhancement could add ruleId-specific "smart"/additive repairs.)
 */
export function repairPlan(plan: TerrainPlan, template: MapTemplate, reg: RuleRegistry): TerrainPlan {
  const out: TerrainPlan = { width: plan.width, height: plan.height, tier: plan.tier.slice(), water: plan.water.slice() };
  for (let pass = 0; pass < TUNING.repairMaxPasses; pass++) {
    const scratch = applyPlanToScratch(out, template);
    const violations = reg.validatePostStroke(scratch);
    if (violations.length === 0) return out;
    for (const v of violations) {
      for (const c of v.cells) {
        const i = c.y * out.width + c.x;
        if (i < 0 || i >= out.tier.length) continue; // rules only emit in-bounds cells today; this is a backstop, not load-bearing
        if (out.water[i]! >= 0) {
          out.water[i] = -1;              // water can't be made legal in place → drop it
        } else if (out.tier[i]! > 0) {
          out.tier[i] = out.tier[i]! - 1; // lower the mountain one tier
        }
      }
    }
  }
  return out; // converged or hit cap (cap is a safety backstop; matrix test keeps passes low)
}
