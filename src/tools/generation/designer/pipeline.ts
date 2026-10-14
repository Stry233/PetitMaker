/**
 * Orders the pure design stages, commits terrain through the rule-aware command path, then places
 * crossings, pavement, objects, and dressing. The complete plan is created before terrain commits
 * so streets can cross terraces. Refusal counts remain visible to callers. Planning is deterministic
 * for `(seed, richness, template)` and does not use browser APIs.
 */
import { flatIndex } from '../../../core/grid/rect';
import type { RuleDispatcher } from '../../../core/model/rule-dispatcher';
import type { Command, GridState, MacroCoord, ValidationResult } from '../../../core/model/types';
import { makeCtx } from '../../placement/object';
import { makeScope } from './build/scope';
import { paveFloors, type FloorOutcome } from './build/floors';
import { keepClear } from './build/keep-clear';
import { buildNetwork } from './build/network';
import { commitTerrain } from './build/terrain-commit';
import { planAnchors, type AnchorPlan } from './places/anchors';
import { planComposition, type CompositionPlan } from './composition/composition';
import { planDistricts, type DistrictAssignment, type DistrictPlan } from './places/districts';
import { dressRegions, planKitGround, type DressOutcome, type KitGround } from './dressing';
import { planMovementLine, type MovementLine } from './composition/movement-line';
import { planStreets } from './streets/streets';
import type { StreetPlan } from './streets/model';
import { sculptTerrain, type TerrainSculpt } from './terrain/terrain-sculpt';
import type { DesignInput, DesignPlan } from './types';
export type { DesignInput } from './types';
import type { PlanetKind } from '../recipe';
import { pavableMask, plantableSurface } from '../../reading/surface';

/** What a designed run needs: the map, the executor's command door, and the rules that judge it.
 *  The same triple the placement populator threads, plus the numbers a plan is made from. */
export interface DesignedContext {
  state: GridState;
  execute: (c: Command) => ValidationResult;
  reg: RuleDispatcher;
  seed: number;
  /** 0..1 scenery richness: how many theme regions, how tall the wall, how much water, how many
   *  loops. */
  richness: number;
  /** The map's height ceiling; the wall's plateau never passes it. */
  maxElevation?: number;
  /** The planet kind, which is the shelf's own word for how much sea a map is: `earth` is dry land
   *  and takes no water at all, `water` spends more of the planet on it. */
  mode?: PlanetKind;
  /**
   * The painted region a run is confined to, or null for the whole planet. It restricts at commit
   * time only, the one scope Generate and Clear share: the planet is always designed whole and the
   * region crops what lands, so it may legitimately come back as only mountain, or empty. Designing
   * inside the region would be a different generator that disagrees about the map.
   */
  region?: MacroCoord[] | null;
}

export interface DesignedOutcome {
  /** Stage C's plan: the places, which is what every later stage reads. */
  plan: DesignPlan;
  /** Stage A: where the mass sits and the plates it stands on. */
  composition: CompositionPlan;
  /** The walk everything else was composed around. */
  line: MovementLine;
  /** Stage B: the streets, their flights and the districts they cut. */
  streets: StreetPlan;
  /** What each district was made into. */
  districts: DistrictAssignment[];
  sculpt: TerrainSculpt;
  anchors: AnchorPlan;
  /** Objects the map accepted: road tiles, buildings, court-lane tiles and crossings together. */
  placed: number;
  /** Terrain layers the plan asked for and how many the rules turned down. */
  terrain: { commands: number; refused: number };
  /** Placements the rules refused, by kind. Zero on a sculpt the router read; anything else is a
   *  defect. `crossings` counts the approach a landed deck asked for and did not get: the deck
   *  itself is placed by a generous scan whose refusals are the scan working, but a bridge whose
   *  approach was refused is a bridge the walk stops at. */
  refused: { roads: number; anchors: number; lanes: number; crossings: number };
  /** The ramps the streets' flights asked for, and the bridges laid where a channel runs. */
  crossings: { ramps: number; bridges: number };
  /** Ramps whose stored footprint is not the one the street plan drew. Zero on a plan the trait
   *  resolved as expected; anything else means a corridor was cleared in the wrong place. */
  rampsMisplaced: number;
  /** Court lanes whose mouth reached no pavement, so they were not laid: laying one would leave a
   *  paved pocket the plaza cannot reach, a broken network rather than a rough edge. */
  lanesSkipped: string[];
  /** Anchors whose door opens onto unpaved ground once everything is down. */
  unroadedGates: { regionId: string; catalogId: string }[];
  /** What the theme kits planted, and how many of the runs they composed were mirrored. */
  dressing: DressOutcome;
  /** The buildings standing on paved floors, and how many qualified. */
  floors: FloorOutcome;
}

/** Every pure plan a designed run builds from, in the order the stages produce them. */
export interface DesignBundle {
  composition: CompositionPlan;
  line: MovementLine;
  streets: StreetPlan;
  districts: DistrictPlan;
  /** Stage C's plan, `districts.design`. */
  plan: DesignPlan;
  anchors: AnchorPlan;
  ground: KitGround[];
}

/**
 * The pure design stages in their one order. A -> B -> C: where the mass sits, the streets that
 * partition it, the treatment every block takes. Each stage reads the one before it and nothing reads
 * the map, so the whole plan exists before a single command does.
 *
 * The walk is drawn between the composition and the streets, so direction and movement line exist
 * before anything is built: the streets lay it as their first and widest trunk, the sculptor puts the
 * water it asks for beside it, and stage C meets its stops in the order a visitor does.
 */
export function planDesign(input: DesignInput): DesignBundle {
  const composition = planComposition(input);
  const line = planMovementLine({ ...input, composition });
  const streets = planStreets({ ...input, composition, line });
  const districts = planDistricts({ ...input, composition, streets, line });
  const plan = districts.design;
  const anchors = planAnchors({ ...input, plan });
  const ground = planKitGround({ ...input, plan });
  return { composition, line, streets, districts, plan, anchors, ground };
}

export function generateDesigned(ctx: DesignedContext): DesignedOutcome {
  const { state, seed, richness } = ctx;
  const scope = makeScope(ctx.region, state.template.width, state.template.height);
  const { composition, line, streets, districts, plan, anchors, ground } = planDesign({
    seed, template: state.template, richness,
    ...(ctx.maxElevation !== undefined ? { maxElevation: ctx.maxElevation } : {}),
  });
  const sculpt = sculptTerrain({
    template: state.template, composition, streets, plan, anchors, seed, richness, ground, line,
    waterScale: WATER_SCALE[ctx.mode ?? 'mixed'],
    ...(ctx.maxElevation !== undefined ? { maxElevation: ctx.maxElevation } : {}),
  });
  const terrain = commitTerrain(ctx, sculpt, ctx.region ?? null);
  const pavable = pavableMask(state);
  const surface = plantableSurface(state);

  const place = makeCtx(state, ctx.execute, ctx.reg, seed);
  const network = buildNetwork(place, { streets, anchors, sculpt, seed, richness }, { pavable, surface }, scope);
  let placed = network.placed;

  // The kits go in last, on the map as it finally stands: a region is composed on the ground the
  // terrain, the streets and the buildings actually left it, never on the lot it was planned as.
  const dressing = dressRegions({
    place, plan, anchors, seed, richness, material: streets.materials.dominant,
    ...(scope.bounded ? { within: (x: number, y: number) => scope.cell(x, y) } : {}),
    // A large fountain keeps a whole court and a small one sits in a garden, and the kits read the
    // distinction here: only the large court's ground is kept clear, so a garden fountain is planted
    // around like anything else standing in a place. A small court kept clear would punch a hole
    // through the middle of its region, which is exactly where a composed place's mirror axis runs.
    avoid: keepClear(sculpt, state.template.width, state.template.height),
  });
  placed += dressing.planted + dressing.paved;

  // Floors last, on the finished map: they lay nothing outside a footprint, so the walkable network
  // every stage above built is the one the map keeps.
  const floors = paveFloors(place, network.buildings, pavable, scope);
  placed += floors.tiles;

  const W = state.template.width;
  const unroadedGates = anchors.placements
    .filter((p) => !place.roads.has(flatIndex(p.approach.x, p.approach.y, W)))
    .map((p) => ({ regionId: p.regionId, catalogId: p.catalogId }));

  return {
    plan, composition, line, streets, districts: districts.assignments, sculpt, anchors, placed, terrain,
    refused: network.refused, crossings: network.crossings, rampsMisplaced: network.rampsMisplaced,
    lanesSkipped: network.lanesSkipped, unroadedGates, dressing, floors,
  };
}

/** What each planet kind does to the water the richness knob asked for. The kinds are named after
 *  this difference, so it is the whole of what they mean to the designed pipeline. */
const WATER_SCALE: Readonly<Record<PlanetKind, number>> = {
  earth: 0, mixed: 1, water: 1.5,
};
