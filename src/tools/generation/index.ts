// src/tools/generation/index.ts
import type { GridState, MapTemplate, Command, ValidationResult, GenerateConfig } from '../../core/model/types';
import type { RuleRegistry } from '../../rules/registry';
import { createDefaultRegistry } from '../../rules/index';
import { makeField, makeScratchState } from './field';
import { NEIGHBORS4, NEIGHBORS8 } from '../../core/model/grid-model';
import { makeRng } from '../../core/model/rng';
import { resolveShaping } from './shaping';
import { buildZones } from './zones';
import { buildZoneWater } from './zone-water';
import { carveRiverCourse } from './zone-water-course';
import { planCrossings } from './crossings';
import { geoStyle } from './style';
import { TUNING } from './tuning';
import { repairPlan } from './repair';
import { enforceUsability } from './usability';
import { planToCommands } from './commit';
import { objectRect } from '../../state/object-geometry';
import type { GenConfig, TerrainPlan, ZonePlan } from './types';

/**
 * Enforce max-slope-`step` staircases on land tiers: a tier-N mountain keeps every neighbour
 * >= N-step, so each peak has a supporting base. This makes V-MTN-03 (3×3 base support) AND
 * no-floating hold BY CONSTRUCTION, so the decrease-only repair has nothing to gut — tall peaks
 * keep their terraced relief. Off-map / water / non-grass neighbours count as 0, so mountains
 * step down cleanly to edges, water, and flats.
 *
 * step 1 (naturalness 1) is the classic wedding cake over the 4-neighbourhood (diagonals drift by
 * <= 2, still inside V-MTN-03's window). step 2..3 allows STACKED slabs — vertical cliffs with a
 * 1-cell inset every `step` layers — which V-MTN-03 permits (a cell at N >= 4 needs its full 3×3
 * at >= N-3), but the clamp must then run on the 8-neighbourhood: with 4-neighbours only, a
 * diagonal could drift by 2×step and break the rule's window.
 */
function terrace(plan: TerrainPlan, grass: Uint8Array, step: number): void {
  const { width, height } = plan;
  const neighbors = step > 1 ? NEIGHBORS8 : NEIGHBORS4;
  const landTier = (x: number, y: number): number => {
    if (x < 0 || y < 0 || x >= width || y >= height) return 0;
    const j = y * width + x;
    return (grass[j] === 1 && plan.water[j]! < 0) ? plan.tier[j]! : 0;
  };
  for (let pass = 0; pass < TUNING.terraceMaxPasses; pass++) {
    let changed = false;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        if (grass[i] !== 1 || plan.water[i]! >= 0 || plan.tier[i]! <= 0) continue;
        let minN = Infinity;
        for (const [dx, dy] of neighbors) minN = Math.min(minN, landTier(x + dx, y + dy));
        if (plan.tier[i]! > minN + step) { plan.tier[i] = (minN + step) as number; changed = true; }
      }
    }
    if (!changed) break;
  }
}

/** Orchestrator: zones (partition/levels/themes) → water (lakes/channels/river) → rasterize →
 *  terrace → repair → usability → re-certify. Returns the certified plan + the zone plan the
 *  populator decorates. */
export interface LandformResult { plan: TerrainPlan; zonePlan: ZonePlan }

export function generateLandform(config: GenConfig, template: MapTemplate, reg: RuleRegistry): LandformResult {
  const scratch = makeScratchState(template);
  const field = makeField(scratch);
  const shaping = resolveShaping(config);
  // The composition anchors BESIDE the plaza: the plaza owns the map centre (game rule), so the
  // town zone sits a comfortable offset from it — never under it, never at the island edge.
  const plaza = plazaCenter(scratch) ?? { x: Math.round(template.width / 2), y: Math.round(template.height / 2) };
  const town = townAnchor(field, plaza, config.seed);
  const zonePlan = buildZones(field, shaping, config.seed, town);
  const water = buildZoneWater(zonePlan, shaping, config.seed);
  const plan: TerrainPlan = { width: field.width, height: field.height, tier: new Int8Array(field.width * field.height), water };
  for (let i = 0; i < zonePlan.zoneOf.length; i++) {
    const z = zonePlan.zoneOf[i]!;
    plan.tier[i] = z >= 0 && water[i]! < 0 ? (zonePlan.zones[z]!.level as number) : 0;
  }
  terrace(plan, field.grass, geoStyle(shaping.naturalness).step); // staircase the seams (V-MTN-03/floating by construction)
  const repaired = repairPlan(plan, template, reg);
  enforceUsability(repaired, field.grass, shaping.targetFlat); // guarantee connected buildable flat
  const certified = repairPlan(repaired, template, reg);       // re-certify (clearing only relaxes constraints)
  // The terrain-following river (pools → terrace channels → waterfalls → the ground water) —
  // additive + self-validating, after certification (so the terrace/repair passes can never
  // shave the caps off a validated unit).
  if (shaping.mtnCapTier > 0 && (shaping.waterCoverage > 0 || shaping.riverDensity > 0)) {
    carveRiverCourse(zonePlan, certified, field.grass, template, reg, config.seed);
  }
  planCrossings(zonePlan, certified, config.settlement); // scarce, strategic — realized by the populator
  return { plan: certified, zonePlan };
}

/** The town zone's anchor: offset from the plaza by townAnchorOffset toward the most INLAND
 *  grass direction (seeded among the good candidates), so the town neighbours the plaza without
 *  sitting under it or hugging the border. */
function townAnchor(field: { width: number; height: number; grass: Uint8Array }, plaza: { x: number; y: number }, seed: number): { x: number; y: number } {
  const W = field.width, H = field.height;
  const margin = Math.min(W, H) * TUNING.townEdgeMarginFrac;
  const cands: { x: number; y: number; score: number }[] = [];
  for (let k = 0; k < 12; k++) {
    const ang = (k / 12) * Math.PI * 2;
    const x = Math.round(plaza.x + Math.cos(ang) * TUNING.townAnchorOffset);
    const y = Math.round(plaza.y + Math.sin(ang) * TUNING.townAnchorOffset);
    if (x < 0 || y < 0 || x >= W || y >= H || field.grass[y * W + x] !== 1) continue;
    const edge = Math.min(x, W - 1 - x, y, H - 1 - y);
    if (edge < margin) continue;
    cands.push({ x, y, score: edge });
  }
  if (!cands.length) return plaza;
  cands.sort((a, b) => b.score - a.score || a.x - b.x);
  const top = cands.slice(0, Math.min(4, cands.length));
  return top[makeRng(seed ^ 0x70b1).int(top.length)]!;
}

/** Centre of the locked plaza object, or null when the template has none. */
function plazaCenter(state: GridState): { x: number; y: number } | null {
  for (const o of state.objects.values()) {
    if (!o.locked) continue;
    const r = objectRect(o);
    return { x: Math.round(r.x + r.w / 2), y: Math.round(r.y + r.h / 2) };
  }
  return null;
}

/** Bridge for the executor path (App passes execute + commits the group itself). */
export function runLandform(config: GenConfig, state: GridState, execute: (c: Command) => ValidationResult): { placed: number; zonePlan: ZonePlan } {
  const { plan, zonePlan } = generateLandform(config, state.template, createDefaultRegistry());
  for (const cmd of planToCommands(plan, config.region)) execute(cmd);
  // Count DISTINCT terrain cells (the cumulative bottom-up layers paint a tall cell once
  // per layer, so summing command cells would over-count).
  const inRegion = config.region ? new Set(config.region.map((c) => `${c.x},${c.y}`)) : null;
  let placed = 0;
  for (let y = 0; y < plan.height; y++) {
    for (let x = 0; x < plan.width; x++) {
      if (inRegion && !inRegion.has(`${x},${y}`)) continue;
      const i = y * plan.width + x;
      if (plan.tier[i]! > 0 || plan.water[i]! >= 0) placed++;
    }
  }
  return { placed, zonePlan };
}

/** Adapt the editor-facing GenerateConfig into the pipeline's GenConfig.
 *  Seed-first: advanced sliders default to 0.5 / 'random' when omitted; earth mode has no water. */
export function toGenConfig(c: GenerateConfig): GenConfig {
  const earth = c.mode === 'earth';
  return {
    mode: c.mode,
    relief: c.relief ?? 0.8,   // relief is internal-only (the agent's run_generator still exposes it); 0.8 keeps out-of-box terrain dynamic and terraced
    naturalness: c.naturalness ?? 1,      // Naturalness slider: 1 organic (classic look) … 0 rectilinear lego
    waterAmount: earth ? 0 : (c.waterAmount ?? 0.4),
    // No Rivers slider — river density tracks the single Water slider (more water → more rivers).
    rivers: earth ? 0 : (c.rivers ?? c.waterAmount ?? 0.4),
    flatness: c.flatness ?? 0.5,           // No Flatness slider — fixed internal default
    settlement: c.settlement ?? 0.5,
    nature: c.nature ?? 0.5,
    seed: c.seed,
    maxElevation: c.maxElevation,
    region: c.region,
  };
}
