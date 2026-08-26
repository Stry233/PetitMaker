import { TerrainType, type GridState, type MapTemplate, type PlacedObject, type ValidationError } from '../../../core/model/types';
import { getCell, createDefaultTerrainCell, createGrid, createPlazaObject, isBuildableZone, bumpCellsVersion, NEIGHBORS4 } from '../../../core/model/grid-model';
import type { RuleDispatcher } from '../../../core/model/rule-dispatcher';
import type { TerrainPlan } from './types';

// Safety cap on the decrease-only fixpoint below. Every pass takes mass off the plan, so the loop
// terminates on its own; this bounds how long a pathological plan may spend getting there.
const MAX_PASSES = 64;

/** A fresh editor-equivalent GridState (grass + plaza, no terrain) for scratch validation. */
export function makeScratchState(template: MapTemplate): GridState {
  const cells = createGrid(template);
  const objects = new Map<string, PlacedObject>();
  const plaza = createPlazaObject(template);
  if (plaza) objects.set(plaza.id, plaza);
  return { template, cells, objects, lockedLayers: new Set() };
}

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

/** The flagged cells, each named once. The escalations below reach past the cell they are given, so
 *  a cell two rules flag must not erode its surroundings twice in one pass. */
function flaggedIndices(plan: TerrainPlan, violations: ValidationError[]): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  for (const v of violations) {
    for (const c of v.cells) {
      if (c.x < 0 || c.y < 0 || c.x >= plan.width || c.y >= plan.height) continue; // rules only emit in-bounds cells today; this is a backstop, not load-bearing
      const i = c.y * plan.width + c.x;
      if (!seen.has(i)) { seen.add(i); out.push(i); }
    }
  }
  return out;
}

/** Take what the flagged cell itself can give: its water, or a tier off its mountain. Walks the
 *  violations as reported rather than the deduplicated set, so a cell two rules flag gives up both
 *  its water and a tier in the one pass, exactly as it always has. */
function lowerFlagged(plan: TerrainPlan, violations: ValidationError[]): boolean {
  let changed = false;
  for (const v of violations) {
    for (const c of v.cells) {
      const i = c.y * plan.width + c.x;
      if (i < 0 || i >= plan.tier.length) continue; // rules only emit in-bounds cells today; this is a backstop, not load-bearing
      if (plan.water[i]! >= 0) { plan.water[i] = -1; changed = true; }        // water can't be made legal in place → drop it
      else if (plan.tier[i]! > 0) { plan.tier[i] = plan.tier[i]! - 1; changed = true; }
    }
  }
  return changed;
}

/**
 * Nothing at the flagged cells could give way, so every one of them is bare ground — and what
 * makes bare ground illegal is standing AROUND it. Take a tier off the mountains beside it.
 *
 * This is what a waterfall's downstream row asks for (V-WTR-03): the row must read one elevation
 * across the fall's full width, and where a step of it did not survive, the rule flags the cells
 * that are OUT OF LINE with the first — usually the bare ones, never the block sticking up among
 * them. Lowering that block levels the row; lowering nothing spins the loop to its cap.
 */
function levelNeighbours(plan: TerrainPlan, flagged: number[]): boolean {
  let changed = false;
  for (const i of flagged) {
    const x = i % plan.width, y = (i / plan.width) | 0;
    for (const [dx, dy] of NEIGHBORS4) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= plan.width || ny >= plan.height) continue;
      const n = ny * plan.width + nx;
      if (plan.water[n]! < 0 && plan.tier[n]! > 0) { plan.tier[n] = plan.tier[n]! - 1; changed = true; }
    }
  }
  return changed;
}

/**
 * The last thing a plan can give up: a water body beside a flagged cell goes WHOLE.
 *
 * A body is taken all at once because half a pond is what makes a face illegal in the first place
 * — removing it a cell at a time only walks the same face backwards across the map, a column per
 * pass, until nothing is left of it anyway.
 */
function dropBodies(plan: TerrainPlan, flagged: number[]): boolean {
  let changed = false;
  for (const i of flagged) {
    const x = i % plan.width, y = (i / plan.width) | 0;
    for (const [dx, dy] of NEIGHBORS4) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= plan.width || ny >= plan.height) continue;
      const seed = ny * plan.width + nx;
      const elev = plan.water[seed]!;
      if (elev < 0) continue;
      const stack = [seed];
      plan.water[seed] = -1;
      changed = true;
      while (stack.length) {
        const j = stack.pop()!;
        const jx = j % plan.width, jy = (j / plan.width) | 0;
        for (const [ex, ey] of NEIGHBORS4) {
          const kx = jx + ex, ky = jy + ey;
          if (kx < 0 || ky < 0 || kx >= plan.width || ky >= plan.height) continue;
          const k = ky * plan.width + kx;
          if (plan.water[k] !== elev) continue;
          plan.water[k] = -1;
          stack.push(k);
        }
      }
    }
  }
  return changed;
}

/**
 * Make the plan rule-valid by repeatedly validating against the LIVE registry and
 * backing off the flagged cells, until validatePostStroke reports zero violations.
 * The back-off is rule-agnostic — it lowers a mountain a tier or drops a water cell on
 * whatever cells the registry flags — so it converges for any rule whose violations can be
 * resolved by REMOVING terrain (every rule the generator currently relies on), without
 * re-implementing rule logic.
 *
 * A pass that takes nothing ESCALATES rather than repeating itself: the flagged cells are bare, so
 * the repair widens to what stands beside them — a tier off the neighbouring mountains, and failing
 * that a whole neighbouring water body. Still decrease-only, so the loop still terminates: every
 * step takes mass off the plan and none puts any back. A plan that has nothing left to give is
 * returned as it stands, which is the caller's cue that it cannot be certified.
 *
 * Caveat — repair is DECREASE-ONLY: it cannot satisfy a rule that needs terrain ADDED on a
 * flagged cell (e.g. building a waterfall's mountain caps when the rule flags a ground cell).
 * Such features must be produced legal-by-construction by the generating stage, not left to
 * repair. `MAX_PASSES` bounds the loop.
 */
export function repairPlan(plan: TerrainPlan, template: MapTemplate, reg: RuleDispatcher): TerrainPlan {
  const out: TerrainPlan = { width: plan.width, height: plan.height, tier: plan.tier.slice(), water: plan.water.slice() };
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    const scratch = applyPlanToScratch(out, template);
    const violations = reg.validatePostStroke(scratch);
    if (violations.length === 0) return out;
    if (lowerFlagged(out, violations)) continue;
    const flagged = flaggedIndices(out, violations);
    if (levelNeighbours(out, flagged)) continue;
    if (dropBodies(out, flagged)) continue;
    return out;
  }
  return out; // converged or hit cap (cap is a safety backstop; matrix test keeps passes low)
}
