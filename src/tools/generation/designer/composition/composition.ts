/**
 * Plans the planet's coarse terrace mass before streets and places are assigned. Every buildable
 * cell belongs to one 4-connected, single-tier plate. The seeded archetype chooses an axis relative
 * to the plaza plate, which stands at the anchor's own ground; adjacent tiers and coast-facing
 * heights are capped to satisfy the terrain support rules. Pure and deterministic for
 * `(seed, template, richness)` so it can run in a worker.
 */
import { components, stepDistance } from '../../../../core/grid/cell-sets';
import { flatIndex, indexBounds, type Rect } from '../../../../core/grid/rect';
import { DIR_OFFSETS, NEIGHBORS4, NEIGHBORS8 } from '../../../../core/grid/directions';
import { makeRng, type Rng, mix, hash01, weightedIndex } from '../../../../core/base/rng';
import { clamp01, lerpClamped } from '../../../../core/base/math';
import type { DesignInput } from '../types';
import { maxRampRun } from '../ramps';
import { anchorTier, coastDistance, landBox, landCentroid, landMask, hubCentre, hubRect, TIER_PER_CELL } from '../planet';
import { directionOf, TRUNK_W, type Direction, type SeedInfo } from '../types';
import { BASE_SUPPORT, ELEVATION_MAX } from '../../../../core/game/profile';
import { PLATE_COUNT_BAND, type Plate, clampInt, cutPlates, nearestPlateTo, plateAdjacency, plateTarget } from './plates';

// --- what a composition is -----------------------------------------------------------------------

/** Where a map's mass sits. The four wall sides and the four corners are one archetype each in the
 *  plan's vocabulary; `axis` (and `crossAxis` for a corner) says which side or corner it is. */
type CompositionArchetype =
  | 'north-wall' | 'east-wall' | 'south-wall' | 'west-wall'
  | 'corner-highland' | 'rim' | 'distributed-massifs' | 'low-relief';

/** The plates and the cell-to-plate index they are read through, on a `W` x `H` planet. */
interface PlateGraph { plates: Plate[]; plateOf: Int16Array; W: number; H: number }

/** The plaza's plate, the tier it stands at, and how many tiers a plate beside it may differ by. */
interface HubPlate { id: number; tier: number; step: number }

/** How tall the composition was asked to stand, and whether it builds a massif. */
interface TierAsk { peakTier: number; richness: number; massif: boolean }

/** The coarse structure of one map: the archetype, its axis, and the plates that tile the planet. */
export interface CompositionPlan {
  seedInfo: SeedInfo;
  archetype: CompositionArchetype;
  /** The direction the ground rises toward, measured from the plaza. */
  axis: Direction;
  /** The corner archetype's second side; absent otherwise. */
  crossAxis?: Direction;
  /** The tallest tier this composition asks for. */
  peakTier: number;
  plates: Plate[];
  /** The plate the plaza stands on, at the anchor's own tier (`anchorTier`): the one every other
   *  tier is measured against. */
  hubPlateId: number;
  /** Tier-weighted centroid of the plan's mass, in macro cells. The plaza hub where nothing rises. */
  massCentroid: { x: number; y: number };
  /** Plate id per cell, -1 off the buildable planet. */
  plateOf: Int16Array;
}

// --- tunables ------------------------------------------------------------------------------------

/**
 * How much weight each archetype carries at richness 0 and at richness 1.
 *
 * The two ends of this table are a flat garden town with almost no mountain and a terraced planet
 * whose mass piles against one side. So a quiet map is mostly low-relief and a rich one is mostly
 * dramatic, and every archetype keeps a nonzero weight at both ends — a weight of
 * zero is a composition no seed can ever draw.
 */
const ARCHETYPE_WEIGHTS: ReadonlyArray<{ archetype: CompositionArchetype; low: number; high: number }> = [
  { archetype: 'north-wall', low: 0.5, high: 1.0 },
  { archetype: 'east-wall', low: 0.5, high: 1.0 },
  { archetype: 'south-wall', low: 0.5, high: 1.0 },
  { archetype: 'west-wall', low: 0.5, high: 1.0 },
  { archetype: 'corner-highland', low: 0.6, high: 1.4 },
  { archetype: 'rim', low: 0.4, high: 0.9 },
  { archetype: 'distributed-massifs', low: 0.3, high: 1.2 },
  { archetype: 'low-relief', low: 3.2, high: 0.2 },
];

/** The wall archetype for each side, so a side and an id are one fact. */
const WALL_ARCHETYPE: Readonly<Record<Direction, CompositionArchetype>> = {
  north: 'north-wall', east: 'east-wall', south: 'south-wall', west: 'west-wall',
};

/** V-MTN-03's window: a mountain needs a full window of support at most `reach` tiers below it, so
 *  `reach` tiers is the most one surface may stand above the surface beside it, and `reach` tiers
 *  per cell of distance from unbuildable ground is the most a plate may claim at all. */
export const PLATE_STEP_MAX = BASE_SUPPORT.reach;
/** Extra plates the mass may be cut into beyond the map's own target, at full richness: the rungs of
 *  the staircase. A quiet map has no mass to terrace and spends none of them. */
const MASSIF_PLATES = 8;
/**
 * The asked peak from which a composition builds a terraced massif — a skirt climbing to the summit
 * and the summit's own crowns — rather than letting the plates carry whatever height they read.
 *
 * Under four tiers there is nothing to build one out of: V-MTN-03 has no support to ask for below 4,
 * a plate can stand three tiers above its neighbour unaided, and the quiet end of the richness axis
 * is a flat garden town whose raised corner is scenery. A skirt and crowns on a map asked for two or
 * three tiers leave terraces the streets cannot reach, blocks with no frontage and street ends
 * stopping at a step with nothing beyond it.
 */
export const MASSIF_PEAK_FROM = BASE_SUPPORT.fromLayer;

/** The tallest tier a composition reaches, at richness 0 and 1. */
const PEAK_TIER = { low: 2, high: ELEVATION_MAX } as const;
/** How the height is spread down the composition's own slope, at richness 0 and 1: an exponent on
 *  each plate's share of the top reading. Above 1 the rise is kept to the very top of the mass (the
 *  garden town is 99% ground level); at 1 the whole slope terraces, which is the terraced planet. */
const RELIEF_GAMMA = { low: 3, high: 1 } as const;
/** Low-relief remains a broad rise: one tier at minimum richness and four at maximum richness. */
const LOW_RELIEF_PEAK = { low: 1, high: 4 } as const;

/**
 * Summit terraces nest inside the top plate. The plaza-facing side reserves enough run for its
 * ramp flight; the other sides keep the one-cell support ring required by the terrain rule.
 */
const CROWN_INSET_MARGIN = 1;
const CROWN_MIN_CELLS = 60;
const CROWN_STEPS_MAX = 4;
/** How thick the ring stands on the sides the flight does not climb: V-MTN-03's window's half-width. */
const CROWN_RING_MIN = (BASE_SUPPORT.window - 1) / 2;
/** How far in a crown climbing `tiers` tiers stands from the ground it rises out of, on the side the
 *  flight climbs. */
const crownInset = (tiers: number): number => maxRampRun() * tiers + CROWN_INSET_MARGIN;

/** Maximum base plates plus the additional nested summit terraces. */
export const PLATE_TOTAL_MAX = PLATE_COUNT_BAND.max + CROWN_STEPS_MAX;
/**
 * The potential every buildable cell carries whatever the archetype says, at richness 0 and 1: on
 * a terraced planet the side away from the mass is the bottom terrace, not sea level, which
 * puts the walk above the ground floor. Below richness 1 it rounds away (the flat garden-town
 * reading). Each tier it adds is a step, and a coating needs its 2x2 window at one tier, so this is
 * the highest value at which every seed of both templates still lays a street grid.
 */
const RELIEF_FLOOR = { low: 0, high: 0.22 } as const;
/**
 * How far inland the floor takes to reach its full value, in cells.
 *
 * The shore keeps the ground it starts at, so a planet is not a plateau with a cliff all the way
 * round its coast — and the ramp is what spreads the pavement over several levels rather than
 * standing all of it on one bottom terrace: at eight cells the walk climbed to one high floor and
 * read 1.18 bits of elevation entropy, at twenty-four it grades over three or four levels and reads
 * 1.58. The longer foot is also what keeps each band wide enough to be paved.
 */
const FLOOR_FOOT = 24;
/** How far inland the raised rim starts to climb, in cells: the shore itself has no room under it to
 *  support height. */
const RIM_FOOT = 5;
/** Massifs one `distributed-massifs` map carries, and each massif's radius as a share of the
 *  planet's own radius. */
const MASSIF_COUNT = { min: 2, max: 4 } as const;
const MASSIF_RADIUS = { min: 0.22, max: 0.42 } as const;
/** How far the mass centroid must stand from the plaza before it names a direction, in cells. Under
 *  it the composition is radial or flat and the archetype's own axis stands. */
export const MASS_OFFSET_MIN = 4;

// --- entry point ---------------------------------------------------------------------------------

/** The coarse structure of one map: which archetype, which axis, and the plates that tile it. */
export function planComposition(
  { seed, template, richness, maxElevation: maxTier = ELEVATION_MAX }: DesignInput,
): CompositionPlan {
  const r = clamp01(richness);
  // The archetype is the first draw off the stream, and mulberry32 answers neighbouring seeds with
  // neighbouring first floats — a batch of seeds counting up would take the same archetype most of
  // the time. Avalanching the seed first is what makes the choice vary across a batch.
  const rng = makeRng(mix(seed, 0x51a7c0de));
  const W = template.width, H = template.height;
  const land = landMask(template);
  const box = landBox(land, W, H);
  const hub = hubCentre(template);

  const choice = chooseArchetype(rng, r);
  const coast = coastDistance(land, W, H);
  // The map's own ceiling is applied here and nowhere later: clamping the tiers after the streets
  // were planned on them would leave a flight with no step to climb.
  const ceiling = clampInt(maxTier, 1, ELEVATION_MAX);
  const peakTier = choice.archetype === 'low-relief'
    ? clampInt(Math.round(lerpClamped(LOW_RELIEF_PEAK.low, LOW_RELIEF_PEAK.high, r)), 1, ceiling)
    : clampInt(Math.round(lerpClamped(PEAK_TIER.low, PEAK_TIER.high, r)), 1, ceiling);
  const field = potentialField({ archetype: choice.archetype, axis: choice.axis, crossAxis: choice.crossAxis, land, W, H, hub, coast, rng });
  // The side away from the mass is the bottom terrace, not sea level: a terraced planet's far quarters
  // read mean elevation 1.5 and only a sixth of it stands at ground level.
  // Per cell and off the coast distance, so the shore keeps the ground it starts at and
  // a planet is not a plateau with a cliff all the way round it.
  const floor = lerpClamped(RELIEF_FLOOR.low, RELIEF_FLOOR.high, r);
  for (let i = 0; i < field.length; i++) {
    if (!land[i]) continue;
    const here = floor * clamp01(coast[i]! / FLOOR_FOOT);
    if (field[i]! < here) field[i] = here;
  }

  // The cut reads the potential, which is why the field is drawn first: the town is cut into blocks
  // and the mass into terraces, and the two want different sizes.
  // The massif is built only where one was asked for: the finer cut on the mass, the skirt that
  // climbs to the summit and the summit's own crowns are all one decision, and below `MASSIF_PEAK_FROM`
  // the answer is no. What is left is the plates' own reading of the archetype, which is the flat
  // garden town this axis starts from.
  const massif = peakTier >= MASSIF_PEAK_FROM;
  const plates = cutPlates(land, W, H, {
    box, target: plateTarget(rng, r), salt: mix(seed, 0x7f4a7c15), field,
    massifPlates: massif ? Math.round(lerpClamped(0, MASSIF_PLATES, r)) : 0,
  });
  const plateOf = new Int16Array(W * H).fill(-1);
  for (const p of plates) for (const i of p.cells) plateOf[i] = p.id;

  const hubArea = hubRect(template);
  let hubPlateId = claimApron(plates, plateOf, { W, H }, hubArea, nearestPlateTo(plates, plateOf, W, H, hub));
  const graph: PlateGraph = { plates, plateOf, W, H };
  assignTiers(graph, field, coast, { peakTier, richness: r, massif }, {
    id: hubPlateId,
    tier: Math.min(anchorTier(template), ceiling),
    step: hubArea.w > 0 && hubArea.h > 0 ? HUB_STEP_MAX : PLATE_STEP_MAX,
  });
  // The cut can only climb three tiers per plate it is deep, so the summit's own terraces are what
  // carries the last of the asked height. They are plates like any other, so every later stage — the
  // streets and their flights, the districts, the walk's own destination — reads them for free.
  if (massif) hubPlateId = raiseCrown(graph, coast, peakTier, hubPlateId, hub);

  const massCentroid = massCentroidOf(plates, W, hub, hubPlateId);
  const axis = resolveAxis(choice, massCentroid, landCentroid(land, W));

  return {
    seedInfo: { seed, richness: r, templateId: template.id },
    archetype: choice.archetype, axis, crossAxis: choice.crossAxis,
    peakTier, plates, hubPlateId, massCentroid, plateOf,
  };
}

// --- the archetype -------------------------------------------------------------------------------

interface ArchetypeChoice { archetype: CompositionArchetype; axis: Direction; crossAxis?: Direction }

const CARDINALS: readonly Direction[] = ['north', 'east', 'south', 'west'];

/** Draws the archetype against the richness-scaled weights, then the side or corner it faces. A
 *  wall's side is its id; every other archetype takes a seeded axis, which `resolveAxis` may replace
 *  with the direction its own mass ended up in. */
function chooseArchetype(rng: Rng, richness: number): ArchetypeChoice {
  const r = clamp01(richness);
  const index = weightedIndex(rng, ARCHETYPE_WEIGHTS.map((w) => Math.max(0, lerpClamped(w.low, w.high, r))));
  const archetype = ARCHETYPE_WEIGHTS[index]!.archetype;
  const side = CARDINALS[rng.int(CARDINALS.length)]!;
  if (archetype === 'corner-highland') {
    const cross = side === 'north' || side === 'south'
      ? (rng.float() < 0.5 ? 'east' : 'west')
      : (rng.float() < 0.5 ? 'north' : 'south');
    return { archetype, axis: side, crossAxis: cross };
  }
  for (const dir of CARDINALS) if (WALL_ARCHETYPE[dir] === archetype) return { archetype, axis: dir };
  return { archetype, axis: side };
}

/** The direction the finished mass actually sits in, which is what a later stage measures against.
 *  A wall or a corner keeps the side it was drawn with; a radial or flat composition takes the
 *  direction of its own mass centroid, and its seeded side only where that centroid says nothing.
 *  Measured against the planet's centre of area, not the plaza: neither template's plaza stands at
 *  the middle of its land, so a plaza-relative reading would lean every map the same way. */
function resolveAxis(choice: ArchetypeChoice, mass: { x: number; y: number }, centre: { x: number; y: number }): Direction {
  if (choice.archetype !== 'rim' && choice.archetype !== 'distributed-massifs' && choice.archetype !== 'low-relief') {
    return choice.axis;
  }
  return directionOf(mass.x - centre.x, mass.y - centre.y, MASS_OFFSET_MIN) ?? choice.axis;
}

// --- the potential field -------------------------------------------------------------------------

interface FieldInput {
  archetype: CompositionArchetype;
  axis: Direction;
  crossAxis?: Direction;
  land: Uint8Array;
  W: number; H: number;
  hub: { x: number; y: number };
  coast: Int16Array;
  rng: Rng;
}

/**
 * How high the archetype wants each cell, 0..1, measured from the plaza outward (centre to rim). Zero is
 * the plaza's own ground and 1 is the composition's peak.
 */
function potentialField(input: FieldInput): Float32Array {
  const { archetype, axis, crossAxis, land, W, H, hub, coast, rng } = input;
  const field = new Float32Array(W * H);
  switch (archetype) {
    case 'rim': {
      let maxRad = 1;
      for (let i = 0; i < land.length; i++) {
        if (!land[i]) continue;
        maxRad = Math.max(maxRad, Math.hypot((i % W) - hub.x, ((i / W) | 0) - hub.y));
      }
      for (let i = 0; i < land.length; i++) {
        if (!land[i]) continue;
        const rad = Math.hypot((i % W) - hub.x, ((i / W) | 0) - hub.y) / maxRad;
        field[i] = clamp01(rad) * clamp01(coast[i]! / RIM_FOOT);
      }
      return field;
    }
    case 'distributed-massifs': {
      const centres = massifCentres(land, W, hub, rng);
      for (let i = 0; i < land.length; i++) {
        if (!land[i]) continue;
        const x = i % W, y = (i / W) | 0;
        let best = 0;
        for (const c of centres) best = Math.max(best, clamp01(1 - Math.hypot(x - c.x, y - c.y) / c.radius));
        field[i] = best;
      }
      return field;
    }
    default: {
      // A wall, a corner or a low-relief planet: one axis, or two multiplied into a quadrant.
      const along = axisPotential(land, W, H, hub, axis);
      if (!crossAxis) return along;
      const across = axisPotential(land, W, H, hub, crossAxis);
      for (let i = 0; i < field.length; i++) field[i] = Math.sqrt(along[i]! * across[i]!);
      return field;
    }
  }
}

/** How far along `dir` a cell stands from the plaza, as a share of the farthest land cell in that
 *  direction. Zero on the plaza's other side: a wall rises on one side and the rest stays low. */
function axisPotential(land: Uint8Array, W: number, H: number, hub: { x: number; y: number }, dir: Direction): Float32Array {
  const step = DIR_OFFSETS[dir];
  const proj = (x: number, y: number): number => (x - hub.x) * step.dx + (y - hub.y) * step.dy;
  let reach = 1;
  for (let i = 0; i < land.length; i++) {
    if (!land[i]) continue;
    reach = Math.max(reach, proj(i % W, (i / W) | 0));
  }
  const field = new Float32Array(W * H);
  for (let i = 0; i < land.length; i++) {
    if (!land[i]) continue;
    field[i] = clamp01(proj(i % W, (i / W) | 0) / reach);
  }
  return field;
}

/** Massif centres, spread by farthest-point sampling over the land the plaza does not sit on. */
function massifCentres(
  land: Uint8Array, W: number, hub: { x: number; y: number }, rng: Rng,
): { x: number; y: number; radius: number }[] {
  let maxRad = 1;
  const candidates: number[] = [];
  for (let i = 0; i < land.length; i++) {
    if (!land[i]) continue;
    const d = Math.hypot((i % W) - hub.x, ((i / W) | 0) - hub.y);
    maxRad = Math.max(maxRad, d);
    candidates.push(i);
  }
  const count = MASSIF_COUNT.min + rng.int(MASSIF_COUNT.max - MASSIF_COUNT.min + 1);
  const chosen: { x: number; y: number; radius: number }[] = [];
  const taken: { x: number; y: number }[] = [{ x: hub.x, y: hub.y }];
  for (let k = 0; k < count; k++) {
    let best = -1, bestScore = -1;
    for (const i of candidates) {
      const x = i % W, y = (i / W) | 0;
      let near = Infinity;
      for (const t of taken) near = Math.min(near, Math.hypot(x - t.x, y - t.y));
      // A seeded tilt on the farthest-point pick, so two maps with the same planet do not put their
      // massifs in the same places.
      const score = near * (0.75 + 0.5 * hash01(k, i));
      if (score > bestScore) { bestScore = score; best = i; }
    }
    if (best < 0) break;
    const x = best % W, y = (best / W) | 0;
    taken.push({ x, y });
    chosen.push({ x, y, radius: maxRad * lerpClamped(MASSIF_RADIUS.min, MASSIF_RADIUS.max, rng.float()) });
  }
  return chosen;
}

// --- the tiers -----------------------------------------------------------------------------------

/**
 * Gives every plate its tier: the archetype's reading, capped by its ground's support, then relaxed
 * until no neighbours stand more than `PLATE_STEP_MAX` apart (`hub.step` beside the plaza's plate).
 * The plaza's plate stands at `hub.tier`, and the relaxation never goes below the descent from it
 * (`hubFloors`). The relaxation is a shortest path with `PLATE_STEP_MAX` per edge, the only way the
 * cap holds everywhere at once. A plate reads the mean potential over its cells, normalized by the
 * highest plate mean so the asked peak is reachable.
 */
function assignTiers(
  graph: PlateGraph, field: Float32Array, coast: Int16Array, ask: TierAsk, hub: HubPlate,
): void {
  const { plates, plateOf, W, H } = graph;
  const headrooms = readTiers(plates, field, coast, ask, hub);
  const edges = plateAdjacency(plates, plateOf, W, H);
  const floors = hubFloors(plates.length, edges, hub.id, hub.tier, hub.step);
  for (const plate of plates) plate.tier = Math.max(plate.tier, floors[plate.id]!);
  if (ask.massif) raiseSkirt(plates, edges, headrooms, hub.id);
  for (let pass = 0; pass < plates.length; pass++) {
    let changed = false;
    for (const [a, b] of edges) {
      const ta = plates[a]!.tier, tb = plates[b]!.tier;
      const step = a === hub.id || b === hub.id ? hub.step : PLATE_STEP_MAX;
      if (ta > tb + step) { plates[a]!.tier = Math.max(tb + step, floors[a]!); changed = true; }
      else if (tb > ta + step) { plates[b]!.tier = Math.max(ta + step, floors[b]!); changed = true; }
    }
    if (!changed) break;
  }
}

/** Each plate's own reading of the potential, before the steps between plates are capped: its
 *  `relief` and a first `tier`, with the hub's plate at the hub's tier. Returns the tier each plate's
 *  ground can carry, by plate id. */
function readTiers(
  plates: Plate[], field: Float32Array, coast: Int16Array, ask: TierAsk, hub: HubPlate,
): Map<number, number> {
  const headrooms = new Map<number, number>();
  let top = 0;
  for (const plate of plates) {
    let sum = 0;
    const depths: number[] = [];
    for (const i of plate.cells) {
      sum += field[i]!;
      depths.push(coast[i]!);
    }
    depths.sort((a, b) => a - b);
    // The tier half the plate can carry: a surface whose middle is deep enough stands at it and
    // slopes off at its rim, where the sculptor's own per-cell cap takes over.
    headrooms.set(plate.id, depths.length ? TIER_PER_CELL * depths[depths.length >> 1]! : 0);
    plate.relief = plate.cells.length ? sum / plate.cells.length : 0;
    if (plate.id !== hub.id) top = Math.max(top, plate.relief);
  }
  // Normalize plate means so the requested peak is reachable. The exponent controls how far height
  // spreads down the slope: low richness raises only the top, while high richness terraces it all.
  const gamma = lerpClamped(RELIEF_GAMMA.low, RELIEF_GAMMA.high, ask.richness);
  const scale = ask.massif && top > 0 ? 1 / top : 1;
  for (const plate of plates) {
    const reading = Math.pow(clamp01(plate.relief * scale), gamma);
    plate.tier = Math.min(Math.round(reading * ask.peakTier), headrooms.get(plate.id)!, ELEVATION_MAX);
    if (plate.id === hub.id) plate.tier = hub.tier;
  }
  return headrooms;
}

/**
 * The least tier each plate may stand at: the hub's own tier on the plaza's plate, `hubStep` below
 * it on the plates beside it and `PLATE_STEP_MAX` lower per plate further out, never below zero.
 * Neighbouring floors differ by at most the step their edge allows, so relaxing toward them keeps
 * every step legal.
 */
function hubFloors(
  count: number, edges: readonly [number, number][], hubPlateId: number, hubTier: number, hubStep: number,
): Int8Array {
  const floors = new Int8Array(count);
  if (hubTier <= 0 || hubPlateId < 0 || hubPlateId >= count) return floors;
  floors[hubPlateId] = hubTier;
  const queue = [hubPlateId];
  for (let head = 0; head < queue.length; head++) {
    const at = queue[head]!;
    const next = at === hubPlateId ? hubTier - hubStep : floors[at]! - PLATE_STEP_MAX;
    if (next <= 0) continue;
    for (const [a, b] of edges) {
      const to = a === at ? b : b === at ? a : -1;
      if (to < 0 || to === hubPlateId || floors[to]! >= next) continue;
      floors[to] = next;
      queue.push(to);
    }
  }
  return floors;
}

/**
 * The mass has a skirt: the plates between the plaza and the summit climb toward it. Read plate by
 * plate, a massif stands beside relief-floor ground and the relaxation drops it to a knoll; reading
 * the summit's claim backward over the plate graph gives each plate at least the height the summit
 * needs, capped by what its ground supports. The plaza keeps its tier, so this never raises the hub.
 */
function raiseSkirt(
  plates: Plate[], edges: readonly [number, number][], headrooms: ReadonlyMap<number, number>,
  hubPlateId: number,
): void {
  const summit = plates.reduce((best, p) => (p.tier > best.tier ? p : best), plates[0]!);
  if (!summit || summit.tier <= 0) return;
  const want = new Map<number, number>([[summit.id, summit.tier]]);
  const queue = [summit.id];
  for (let head = 0; head < queue.length; head++) {
    const at = queue[head]!;
    const next = want.get(at)! - PLATE_STEP_MAX;
    if (next <= 0) continue;
    for (const [a, b] of edges) {
      for (const [from, to] of [[a, b], [b, a]] as const) {
        if (from !== at || to === hubPlateId) continue;
        if ((want.get(to) ?? -1) >= next) continue;
        want.set(to, next);
        queue.push(to);
      }
    }
  }
  for (const plate of plates) {
    if (plate.id === hubPlateId) continue;
    const asked = want.get(plate.id);
    if (asked === undefined) continue;
    plate.tier = Math.min(Math.max(plate.tier, asked), headrooms.get(plate.id)!, ELEVATION_MAX);
  }
}

/**
 * The summit: nested terraces cut into the tallest ground until the asked peak is reached. Touching
 * plates step at most `PLATE_STEP_MAX`, so the partition alone runs out of height, and the mass is a
 * terraced massif. So the top-tier ground keeps a ring and gives its interior to a new
 * plate a step higher, repeated while height is owed and a terrace still fits. Each crown steps at
 * most `PLATE_STEP_MAX` over its ring, the 3x3 support V-MTN-03 reads, and is a plate like any other
 * to the streets, districts and walk.
 */
function raiseCrown(
  graph: PlateGraph, coast: Int16Array, peakTier: number, hubPlateId: number, hubAt: { x: number; y: number },
): number {
  const { plates, plateOf, W, H } = graph;
  let hub = hubPlateId;
  for (let step = 0; step < CROWN_STEPS_MAX; step++) {
    const top = plates.reduce((m, p) => Math.max(m, p.tier), 0);
    if (top <= 0 || top >= peakTier) return hub;
    // A crown may stand on everything within V-MTN-03's window of its own tier, whichever plate it
    // belongs to; reading only the top plate leaves no room for a terrace on a narrow mass.
    //
    // How many tiers a crown lifts and how far down its ground may reach trade against each other: a
    // deeper reach is a wider terrace and a longer flight (`maxRampRun()` cells of run per tier).
    // One tier at a time where the ground allows, so crowns stand a few cells in and come out broad,
    // a plateau to walk on; taller lifts are for a mass with no room for a third terrace.
    //
    // Coast headroom is read per cell, so one corner near the shore does not demote the whole
    // terrace; a cell without headroom for the tier is simply not crown ground.
    let cells: number[] = [], tier = 0;
    for (let lift = 1; lift <= Math.min(PLATE_STEP_MAX, peakTier - top) && !cells.length; lift++) {
      const want = top + lift;
      for (let floor = want - PLATE_STEP_MAX; floor <= top; floor++) {
        const support = new Set<number>();
        for (const plate of plates) {
          if (plate.tier < floor) continue;
          for (const i of plate.cells) {
            if (TIER_PER_CELL * coast[i]! < want) continue;
            support.add(i);
          }
        }
        const full = crownInset(want - floor);
        const inner = insetOf(support, { W, H }, Math.min(CROWN_RING_MIN, full), full, hubAt);
        if (inner.length < CROWN_MIN_CELLS) continue;
        if (want < tier || (want === tier && inner.length <= cells.length)) continue;
        cells = inner; tier = want;
      }
    }
    // A step that finds no crown ends the pass: nothing about the plates changed, so the next step
    // would ask the same question of the same ground and be told the same thing. A massif can stop a
    // tier short here: with one tier still owed the lift may only be 1, and every floor it could stand
    // on can erode to zero cells at the inset that lift needs. The mass is thin rather than short, so
    // what closes it is a wider mass and not a taller search.
    if (!cells.length) break;
    const taken = new Set(cells);
    const id = plates.length;
    for (const plate of plates) {
      const kept = plate.cells.filter((i) => !taken.has(i));
      if (kept.length === plate.cells.length) continue;
      plate.cells = kept;
      plate.rect = indexBounds(kept, W);
    }
    for (const i of cells) plateOf[i] = id;
    plates.push({ id, rect: indexBounds(cells, W), cells, tier, relief: 1 });
    // A plate the crown cut in two is two surfaces, and a plate is one: the pieces stand as plates
    // of their own at the same tier, which is legal by construction and true to what the ground is.
    hub = splitDonors(plates, plateOf, W, H, hub);
  }
  return hub;
}

/**
 * How many tiers a plate beside the plaza's own may stand above it. A flight off the apron has only
 * the apron to run on (`hubApron()`): against a wall two or three tiers high no flight fits between
 * the plaza's trunks and the step, the streets beyond it are pruned for want of a way to the plaza,
 * and which faces of the plaza met such a wall moved with every cell the plaza moved.
 */
const HUB_STEP_MAX = 1;

/**
 * How far the plaza's own plate reaches round the plaza, in cells: the trunk against the plaza's face
 * and the cell beyond it the flat trait's window reads (`streets/board.ts:makeBoard`), a flight's dual-grid
 * margin, and the runs of a `HUB_STEP_MAX` flight with its landing (`maxRampRun()` each), so a trunk
 * crossing the apron's edge has ground to climb off it on.
 */
const hubApron = (): number => TRUNK_W + 1 + 1 + (HUB_STEP_MAX + 1) * maxRampRun();

/**
 * Gives the plaza's plate every planet cell within `hubApron()` of the plaza, so the plaza stands on
 * one level apron on every side, and returns where the plaza's plate ended up.
 *
 * The cut is blind to the plaza: it tiles the land round it like any other ground, so the plaza's
 * own plate can be a sliver along one face while the plates on its other faces are cut a terrace or
 * three up. The four trunks that ring the plaza are laid against its faces at the plaza's level, and
 * a face that stands on another plate gets no trunk at all, which leaves every street beyond it
 * unreachable and pruned. Which plates a face lands on moved with every cell the plaza moved, so the
 * network flipped between whole and almost nothing; the apron makes the ring the plaza's own whatever
 * the plaza's position. Plates the apron splits stand as plates of their own (`splitDonors`).
 */
function claimApron(plates: Plate[], plateOf: Int16Array, size: { W: number; H: number }, hubArea: Rect, hubPlateId: number): number {
  const { W, H } = size;
  const hub = plates[hubPlateId];
  if (!hub || hubArea.w <= 0 || hubArea.h <= 0) return hubPlateId;
  const taken = new Set<number>();
  const claim = (i: number): void => {
    plateOf[i] = hubPlateId;
    taken.add(i);
  };
  const apron = hubApron();
  for (let y = Math.max(0, hubArea.y - apron); y < Math.min(H, hubArea.y + hubArea.h + apron); y++) {
    for (let x = Math.max(0, hubArea.x - apron); x < Math.min(W, hubArea.x + hubArea.w + apron); x++) {
      const i = flatIndex(x, y, W);
      const id = plateOf[i]!;
      if (id < 0 || id === hubPlateId) continue;
      claim(i);
    }
  }
  if (taken.size === 0) return hubPlateId;
  // A kerb claimed can leave the next one against the new edge, so the claim runs to a fixpoint.
  for (let kerbs = kerbCells(plateOf, W, H, hubPlateId); kerbs.length > 0; kerbs = kerbCells(plateOf, W, H, hubPlateId)) {
    for (const i of kerbs) claim(i);
  }
  for (const plate of plates) {
    if (plate.id === hubPlateId) continue;
    plate.cells = plate.cells.filter((i) => !taken.has(i));
    if (plate.cells.length > 0) plate.rect = indexBounds(plate.cells, W);
  }
  hub.cells = [...hub.cells, ...taken].sort((a, b) => a - b);
  hub.rect = indexBounds(hub.cells, W);
  return splitDonors(plates, plateOf, W, H, hubPlateId);
}

/**
 * The cells of other plates that stand one cell wide between the plaza's plate and different ground
 * beyond (another plate, the plaza's plate again, or the planet's edge), read straight out from each
 * face of the plaza's plate. No road tile's level 2x2 window fits in such a strip, so at its own tier
 * it is only a ditch or a kerb along the plateau's edge, cutting a street that runs across it.
 */
function kerbCells(plateOf: Int16Array, W: number, H: number, hubId: number): number[] {
  const out: number[] = [];
  const at = (x: number, y: number): number => (x < 0 || y < 0 || x >= W || y >= H ? -1 : plateOf[flatIndex(x, y, W)]!);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (plateOf[flatIndex(x, y, W)] !== hubId) continue;
      for (const [dx, dy] of NEIGHBORS4) {
        const donor = at(x + dx, y + dy);
        if (donor < 0 || donor === hubId || at(x + 2 * dx, y + 2 * dy) === donor) continue;
        out.push(flatIndex(x + dx, y + dy, W));
      }
    }
  }
  return out;
}

/** Every plate cut into pieces by the crown, re-registered one plate per piece: the largest keeps
 *  the id, the rest are appended, and a plate the crown consumed entirely is dropped. Returns where
 *  the plaza's plate ended up. */
function splitDonors(
  plates: Plate[], plateOf: Int16Array, W: number, H: number, hubPlateId: number,
): number {
  const added: Plate[] = [];
  for (const plate of plates) {
    if (plate.cells.length === 0) continue;
    const pieces = surfacesOf(plate.cells, W, H);
    if (pieces.length < 2) continue;
    pieces.sort((a, b) => b.length - a.length);
    plate.cells = pieces[0]!;
    plate.rect = indexBounds(plate.cells, W);
    for (const piece of pieces.slice(1)) {
      const id = plates.length + added.length;
      for (const i of piece) plateOf[i] = id;
      added.push({ id, rect: indexBounds(piece, W), cells: piece, tier: plate.tier, relief: plate.relief });
    }
  }
  plates.push(...added);
  return compact(plates, plateOf, hubPlateId);
}

/** Drops the emptied plates and renumbers what is left, so `plates[id].id === id` holds — the
 *  invariant every `plateOf` lookup in the tree rests on. */
function compact(plates: Plate[], plateOf: Int16Array, hubPlateId: number): number {
  const remap = new Map<number, number>();
  const kept: Plate[] = [];
  for (const plate of plates) {
    if (plate.cells.length === 0) continue;
    remap.set(plate.id, kept.length);
    plate.id = kept.length;
    kept.push(plate);
  }
  plates.length = 0;
  plates.push(...kept);
  for (let i = 0; i < plateOf.length; i++) {
    const id = plateOf[i]!;
    if (id >= 0) plateOf[i] = remap.get(id) ?? -1;
  }
  return remap.get(hubPlateId) ?? 0;
}

/** The cells as 4-connected surfaces, each ascending. */
function surfacesOf(cells: readonly number[], W: number, H: number): number[][] {
  const own = new Set(cells);
  const piece = components(own, W, H);
  const out: number[][] = [];
  for (const i of own) (out[piece.get(i)!] ??= []).push(i);
  return out.map((cellsOf) => cellsOf.sort((a, b) => a - b));
}

/**
 * The interior of a region of cells: the largest connected piece left after eroding `ring` cells in
 * from everything outside it and `flight` cells in from the boundary facing `toward`. Ascending, or
 * empty. Chebyshev distance, V-MTN-03's support window, keeps the ground under a crown one connected
 * surface and leaves room for a ramp's run on the climbing side. Where `toward` sits on the centroid
 * or its half is empty, every side pays the flight inset.
 */
function insetOf(
  region: ReadonlySet<number>, size: { W: number; H: number }, ring: number,
  flight = ring, toward?: { x: number; y: number },
): number[] {
  const { W, H } = size;
  const seeds: number[] = [];
  for (const i of region) {
    const x = i % W, y = (i / W) | 0;
    for (const [dx, dy] of NEIGHBORS8) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H || !region.has(flatIndex(nx, ny, W))) {
        seeds.push(i);
        break;
      }
    }
  }
  if (seeds.length === 0) return [];
  const distance = stepDistance(seeds, W, H, true);
  const climb = flight > ring && toward ? facingSeeds(seeds, W, region, toward) : null;
  const climbDistance = climb && climb.length ? stepDistance(climb, W, H, true) : null;
  const inside = new Set<number>();
  for (const i of region) {
    if (distance[i]! < (climbDistance ? ring : Math.max(ring, flight))) continue;
    if (climbDistance && climbDistance[i]! < flight) continue;
    inside.add(i);
  }
  // An erosion can break one surface into several; a crown is one terrace, so the largest piece is
  // the crown and the rest stays on the ring it was cut from.
  let best: number[] = [];
  for (const piece of surfacesOf([...inside], W, H)) if (piece.length > best.length) best = piece;
  return best;
}

/** The boundary cells on the `toward` side of the region's centroid: the half of the outline a walk
 *  coming from `toward` would meet, and so the half that has to carry the flight's run. */
function facingSeeds(
  seeds: readonly number[], W: number, region: ReadonlySet<number>,
  toward: { x: number; y: number },
): number[] {
  let cx = 0, cy = 0;
  for (const i of region) { cx += i % W; cy += (i / W) | 0; }
  cx /= region.size; cy /= region.size;
  const ux = toward.x - cx, uy = toward.y - cy;
  const len = Math.hypot(ux, uy);
  if (len < 1) return [];
  return seeds.filter((i) => ((i % W) - cx) * ux + (((i / W) | 0) - cy) * uy > 0);
}

/** Tier-weighted centroid of the plates other than the plaza's own: where a reader would say the
 *  map's mass sits. */
function massCentroidOf(
  plates: readonly Plate[], W: number, hub: { x: number; y: number }, hubPlateId: number,
): { x: number; y: number } {
  let weight = 0, sx = 0, sy = 0;
  for (const plate of plates) {
    if (plate.tier <= 0 || plate.id === hubPlateId) continue;
    for (const i of plate.cells) {
      weight += plate.tier;
      sx += plate.tier * (i % W);
      sy += plate.tier * ((i / W) | 0);
    }
  }
  return weight > 0 ? { x: sx / weight, y: sy / weight } : { x: hub.x, y: hub.y };
}
