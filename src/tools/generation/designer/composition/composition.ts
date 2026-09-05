/**
 * Plans the island's coarse terrace mass before streets and places are assigned. Every buildable
 * cell belongs to one 4-connected, single-tier plate. The seeded archetype chooses an axis relative
 * to the low plaza plate; adjacent tiers and coast-facing heights are capped to satisfy the terrain
 * support rules. Pure and deterministic for `(seed, template, richness)` so it can run in a worker.
 */
import { ELEVATION_MAX } from '../../../../core/model/constants';
import { distanceField, flatIndex } from '../../../../core/model/grid-model';
import { makeRng, type Rng } from '../../../../core/model/rng';
import { CellZone, type MapTemplate, type Rect } from '../../../../core/model/types';
import { directionOf, RAMP_RUN, STEP, type Direction, type SeedInfo } from '../types';

/** The template's plaza as whole macro cells: the hub every stage measures from. The plaza
 *  config sits on the half grid, so the rect is the cells it touches. */
export function plazaRect(template: MapTemplate): Rect {
  const p = template.plaza;
  const x = Math.floor(p.x), y = Math.floor(p.y);
  return { x, y, w: Math.ceil(p.x + p.width) - x, h: Math.ceil(p.y + p.height) - y };
}

// --- what a composition is -----------------------------------------------------------------------

/** Where a map's mass sits. The four wall sides and the four corners are one archetype each in the
 *  plan's vocabulary; `axis` (and `crossAxis` for a corner) says which side or corner it is. */
export type CompositionArchetype =
  | 'north-wall' | 'east-wall' | 'south-wall' | 'west-wall'
  | 'corner-highland' | 'rim' | 'distributed-massifs' | 'low-relief';

/** One continuous terrace surface: a 4-connected run of buildable cells standing at one tier. */
export interface Plate {
  id: number;
  /** Bounding box of `cells`, in macro cells. */
  rect: Rect;
  /** Flat cell indices (`y * width + x`), ascending. */
  cells: number[];
  tier: number;
  /** Mean archetype potential over the plate, 0..1: what the tier was rounded from before the
   *  step and headroom caps were applied. */
  relief: number;
}

/** The coarse structure of one map: the archetype, its axis, and the plates that tile the island. */
export interface CompositionPlan {
  seedInfo: SeedInfo;
  archetype: CompositionArchetype;
  /** The direction the ground rises TOWARD, measured from the plaza. */
  axis: Direction;
  /** The corner archetype's second side; absent otherwise. */
  crossAxis?: Direction;
  /** The tallest tier this composition asks for. */
  peakTier: number;
  plates: Plate[];
  /** The plate the plaza stands on: low, and the one every other tier is measured against. */
  plazaPlateId: number;
  /** Tier-weighted centroid of the plan's mass, in macro cells. The plaza hub where nothing rises. */
  massCentroid: { x: number; y: number };
  /** Plate id per cell, -1 off the buildable island. */
  plateOf: Int16Array;
}

// --- tunables ------------------------------------------------------------------------------------

/**
 * How much weight each archetype carries at richness 0 and at richness 1.
 *
 * The two decoded references are the two ends of this table: a flat garden town (0.3% mountain) and
 * a terraced island whose mass piles against one side. So a quiet map is mostly low-relief and a
 * rich one is mostly dramatic, and every archetype keeps a nonzero weight at both ends — a weight of
 * zero is a composition no seed can ever draw.
 */
export const ARCHETYPE_WEIGHTS: ReadonlyArray<{ archetype: CompositionArchetype; low: number; high: number }> = [
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

/** V-MTN-03's window: a mountain at N >= 4 needs a full 3x3 of support at >= N-3, so three tiers is
 *  the most one surface may stand above the surface beside it, and three tiers per cell of distance
 *  from unbuildable ground is the most a plate may claim at all. */
export const PLATE_STEP_MAX = 3;
const TIER_PER_CELL = 3;

/** How many plates a map is cut into, at richness 0 and 1, before disconnected fragments are folded
 *  into their neighbours. The references' coarse partitions run 17-24 blocks; a plate is one step
 *  coarser than a block, because the streets of stage B cut plates into blocks. */
const PLATE_COUNT = { low: 9, high: 24 } as const;
/** Plates a map may hold whatever the seed drew: the count band the tests hold this planner to. */
export const PLATE_COUNT_BAND = { min: 8, max: 29 } as const;
/** The shortest side a plate may be cut to. A composed place is 7x7 to 10x10 on the references and a
 *  street runs beside it, so a narrower plate could hold neither. */
const PLATE_MIN_SIDE = 12;
/**
 * The same two numbers for a plate ON THE MASS, where a plate is a TERRACE rather than a block.
 *
 * The mass is a staircase: the terraces of the reference island run a few cells deep, and cutting
 * them at a town block's scale is what spread the wedding cake over a whole island. Seven cells is
 * what a terrace has to hold to be walked on at all — a two-wide street with the dual-grid margin
 * either side of it, or the run of one ramp.
 */
const TERRACE_MIN_SIDE = 7;
const TERRACE_MIN_CELLS = 60;
/** Where the mass begins, as a share of the archetype's own top potential, and how much harder a
 *  slab standing there is cut. */
const MASSIF_FROM = 0.45;
const MASSIF_PULL = 2;
/** Extra plates the mass may be cut into beyond the map's own target, at full richness: the rungs of
 *  the staircase. A quiet map has no mass to terrace and spends none of them. */
const MASSIF_PLATES = 8;
/**
 * The asked peak from which a composition builds a TERRACED MASSIF — a skirt climbing to the summit
 * and the summit's own crowns — rather than letting the plates carry whatever height they read.
 *
 * Under four tiers there is nothing to build one out of: V-MTN-03 has no support to ask for below 4,
 * a plate can stand three tiers above its neighbour unaided, and the quiet end of the richness axis
 * is a flat garden town whose raised corner is scenery. Measured, skirting and crowning a map asked
 * for two or three tiers broke it in the way a flat map breaks: terraces the streets could not reach,
 * blocks with no frontage, street ends stopping at a step with nothing beyond it.
 */
export const MASSIF_PEAK_FROM = 4;
/** The fewest cells a plate may hold. Below this a fragment is folded into the neighbour it shares
 *  the most boundary with: a terrace nobody can stand a place on is a seam, not a surface. */
const PLATE_MIN_CELLS = 110;
/** How far a cut may sit from the middle of the slab it divides. Straight down the middle every time
 *  reads as a chequerboard; past this the two halves stop being comparable places. */
const SPLIT_JITTER = 0.3;

/** The tallest tier a composition reaches, at richness 0 and 1. */
const PEAK_TIER = { low: 2, high: ELEVATION_MAX } as const;
/** How the height is spread down the composition's own slope, at richness 0 and 1: an exponent on
 *  each plate's share of the top reading. Above 1 the rise is kept to the very top of the mass (the
 *  garden town is 99% ground level); at 1 the whole slope terraces, which is the target island. */
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
/** How thick the ring stands on the sides the flight does NOT climb: V-MTN-03's own window. */
const CROWN_RING_MIN = 1;
/** How far in a crown climbing `tiers` tiers stands from the ground it rises out of, ON THE SIDE THE
 *  FLIGHT CLIMBS. */
const crownInset = (tiers: number): number => RAMP_RUN * tiers + CROWN_INSET_MARGIN;

/** Maximum base plates plus the additional nested summit terraces. */
export const PLATE_TOTAL_MAX = PLATE_COUNT_BAND.max + CROWN_STEPS_MAX;
/**
 * The potential every buildable cell carries whatever the archetype says, at richness 0 and 1.
 *
 * The terraced reference's far quarters read mean elevation 1.5 and 1.4, and only 17% of that island
 * stands at ground level: the side AWAY from the mass is not sea level, it is the bottom terrace. At
 * richness 1 this floor is worth several tiers against the peak; below that it rounds away, which is the
 * flat garden-town reading.
 *
 * IT IS WHAT PUTS THE WALK ABOVE THE GROUND FLOOR. What matters is where a visitor STANDS, and a map
 * whose whole town sits on the bottom terrace is a viewpoint at the end of a flat walk however tall its
 * summit is. Over ten seeds at full richness, raising this floor from a tier to two moves the pavement
 * with sight of mass at level 5 or above from 19% to 21% and the ramps a map carries from 11 to 14.
 *
 * IT IS ALSO BOUNDED BY WHAT A STREET CAN STAND ON. Every tier the floor adds is another step, and a
 * coating needs its whole 2x2 window at ONE tier: pushed to three tiers, two seeds of twenty came
 * back with 2% of the island paved — a map with no network at all. The value here is the highest one
 * at which every seed of both templates still lays a street grid.
 */
const RELIEF_FLOOR = { low: 0, high: 0.22 } as const;
/**
 * How far inland the floor takes to reach its full value, in cells.
 *
 * The shore keeps the ground it starts at, so an island is not a plateau with a cliff all the way
 * round its coast — and the RAMP is what spreads the pavement over several levels rather than
 * standing all of it on one bottom terrace: at eight cells the walk climbed to one high floor and
 * read 1.18 bits of elevation entropy, at twenty-four it grades over three or four levels and reads
 * 1.58. The longer foot is also what keeps each band WIDE enough to be paved.
 */
const FLOOR_FOOT = 24;
/** How far inland the raised rim starts to climb, in cells: the shore itself has no room under it to
 *  support height. */
const RIM_FOOT = 5;
/** Massifs one `distributed-massifs` map carries, and each massif's radius as a share of the
 *  island's own radius. */
const MASSIF_COUNT = { min: 2, max: 4 } as const;
const MASSIF_RADIUS = { min: 0.22, max: 0.42 } as const;
/** How far the mass centroid must stand from the plaza before it names a direction, in cells. Under
 *  it the composition is radial or flat and the archetype's own axis stands. */
export const MASS_OFFSET_MIN = 4;

// --- entry point ---------------------------------------------------------------------------------

/** The coarse structure of one map: which archetype, which axis, and the plates that tile it. */
export function planComposition(
  seed: number, template: MapTemplate, richness = 0.5, maxTier = ELEVATION_MAX,
): CompositionPlan {
  const r = clamp01(richness);
  // The archetype is the FIRST draw off the stream, and mulberry32 answers neighbouring seeds with
  // neighbouring first floats — a batch of seeds counting up would take the same archetype most of
  // the time. Avalanching the seed first is what makes the choice vary across a batch.
  const rng = makeRng(mix(seed, 0x51a7c0de));
  const W = template.width, H = template.height;
  const land = landMask(template);
  const box = landBox(land, W, H);
  const hub = plazaCentre(template);

  const choice = chooseArchetype(rng, r);
  const coast = coastDistance(land, W, H);
  // The map's own ceiling is applied HERE and nowhere later: clamping the tiers after the streets
  // were planned on them would leave a flight with no step to climb.
  const ceiling = clampInt(maxTier, 1, ELEVATION_MAX);
  const peakTier = choice.archetype === 'low-relief'
    ? clampInt(Math.round(lerp(LOW_RELIEF_PEAK.low, LOW_RELIEF_PEAK.high, r)), 1, ceiling)
    : clampInt(Math.round(lerp(PEAK_TIER.low, PEAK_TIER.high, r)), 1, ceiling);
  const field = potentialField({ archetype: choice.archetype, axis: choice.axis, crossAxis: choice.crossAxis, land, W, H, hub, coast, rng });
  // THE SIDE AWAY FROM THE MASS IS THE BOTTOM TERRACE, not sea level: the terraced reference's far
  // quarters read mean elevation 1.5 and only 17% of that island stands at ground level.
  // Per CELL and off the coast distance, so the shore keeps the ground it starts at and
  // an island is not a plateau with a cliff all the way round it.
  const floor = lerp(RELIEF_FLOOR.low, RELIEF_FLOOR.high, r);
  for (let i = 0; i < field.length; i++) {
    if (!land[i]) continue;
    const here = floor * clamp01(coast[i]! / FLOOR_FOOT);
    if (field[i]! < here) field[i] = here;
  }

  // The cut reads the potential, which is why the field is drawn first: the town is cut into blocks
  // and the mass into TERRACES, and the two want different sizes.
  // THE MASSIF IS BUILT ONLY WHERE ONE WAS ASKED FOR: the finer cut on the mass, the skirt that
  // climbs to the summit and the summit's own crowns are all one decision, and below `MASSIF_PEAK_FROM`
  // the answer is no. What is left is the plates' own reading of the archetype, which is the flat
  // garden town this axis starts from.
  const massif = peakTier >= MASSIF_PEAK_FROM;
  const plates = cutPlates(
    land, W, H, box, plateTarget(rng, r), mix(seed, 0x7f4a7c15), field,
    massif ? Math.round(lerp(0, MASSIF_PLATES, r)) : 0,
  );
  const plateOf = new Int16Array(W * H).fill(-1);
  for (const p of plates) for (const i of p.cells) plateOf[i] = p.id;

  let plazaPlateId = nearestPlateTo(plates, plateOf, W, H, hub);
  assignTiers(plates, plateOf, W, H, field, coast, peakTier, plazaPlateId, r, massif);
  // The cut can only climb three tiers per plate it is deep, so the summit's own terraces are what
  // carries the last of the asked height. They are plates like any other, so every later stage — the
  // streets and their flights, the districts, the walk's own destination — reads them for free.
  if (massif) plazaPlateId = raiseCrown(plates, plateOf, W, H, coast, peakTier, plazaPlateId, hub);

  const massCentroid = massCentroidOf(plates, W, hub);
  const axis = resolveAxis(choice, massCentroid, landCentroid(land, W));

  return {
    seedInfo: { seed, richness: r, templateId: template.id },
    archetype: choice.archetype, axis, crossAxis: choice.crossAxis,
    peakTier, plates, plazaPlateId, massCentroid, plateOf,
  };
}

/**
 * Where terrain may be painted at all (V-ZONE-01): a buildable cell whose north, west and
 * north-west neighbours are buildable too.
 *
 * A painted block renders shifted half a tile up and left, so it bleeds onto those three cells and
 * the zone rule refuses the paint where any of them is sea or beach. Every stage that asks how high
 * the ground stands reads this, so the plan and the commit cannot disagree about the shoreline.
 */
export function paintableMask(template: MapTemplate): Uint8Array {
  const W = template.width, H = template.height;
  const out = new Uint8Array(W * H);
  const grass = (x: number, y: number): boolean => template.zones[y]?.[x] === CellZone.Grass;
  const clear = (x: number, y: number): boolean =>
    x < 0 || y < 0 || x >= W || y >= H || grass(x, y);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (grass(x, y) && clear(x - 1, y) && clear(x, y - 1) && clear(x - 1, y - 1)) {
        out[flatIndex(x, y, W)] = 1;
      }
    }
  }
  return out;
}

/**
 * The tier every cell actually STANDS at once the composition is realized: its plate's tier, capped
 * at `TIER_PER_CELL` per cell of distance from the nearest ground no block may stand on.
 *
 * A plate takes its tier from the ground its MIDDLE can support, so its rim slopes down to the
 * shore, and this is where that slope is drawn. The cap is V-MTN-03 read forward: a cell `d` cells
 * inland standing at `3d` has every 3x3 neighbour at distance `d-1` or more, capped at `3d - 3`,
 * which is exactly the support the rule asks for, and `PLATE_STEP_MAX` bounds what a neighbouring
 * PLATE may claim by the same three tiers. So the whole field is legal by construction, wherever
 * two plates meet and wherever one meets the sea.
 *
 * EVERY STAGE READS THIS ONE FIELD. The streets are laid on it (pavement needs its own 2x2 window at
 * one level), the districts are cut by it, and the sculptor writes it — a stage reading the plate's
 * nominal tier instead would plan pavement onto ground that comes out a tier lower.
 */
export function cellTiers(template: MapTemplate, plan: CompositionPlan): Int8Array {
  const W = template.width, H = template.height;
  const paintable = paintableMask(template);
  const seeds: number[] = [];
  for (let i = 0; i < paintable.length; i++) if (!paintable[i]) seeds.push(i);
  const inland = distanceField(seeds, W, H, true);
  const out = new Int8Array(W * H);
  for (let i = 0; i < out.length; i++) {
    if (!paintable[i]) continue;
    const plate = plan.plateOf[i]!;
    if (plate < 0) continue;
    out[i] = Math.max(0, Math.min(plan.plates[plate]!.tier, TIER_PER_CELL * inland[i]!));
  }
  return out;
}

// --- the archetype -------------------------------------------------------------------------------

interface ArchetypeChoice { archetype: CompositionArchetype; axis: Direction; crossAxis?: Direction }

const CARDINALS: readonly Direction[] = ['north', 'east', 'south', 'west'];

/** Draws the archetype against the richness-scaled weights, then the side or corner it faces. A
 *  wall's side is its id; every other archetype takes a seeded axis, which `resolveAxis` may replace
 *  with the direction its own mass ended up in. */
export function chooseArchetype(rng: Rng, richness: number): ArchetypeChoice {
  const r = clamp01(richness);
  const weights = ARCHETYPE_WEIGHTS.map((w) => Math.max(0, lerp(w.low, w.high, r)));
  const total = weights.reduce((a, b) => a + b, 0);
  let roll = rng.float() * total;
  let index = weights.length - 1;
  for (let k = 0; k < weights.length; k++) {
    roll -= weights[k]!;
    if (roll <= 0) { index = k; break; }
  }
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
 *  Measured against the island's centre of area, not the plaza: neither template's plaza stands at
 *  the middle of its land, so a plaza-relative reading would lean every map the same way. */
function resolveAxis(choice: ArchetypeChoice, mass: { x: number; y: number }, centre: { x: number; y: number }): Direction {
  if (choice.archetype !== 'rim' && choice.archetype !== 'distributed-massifs' && choice.archetype !== 'low-relief') {
    return choice.axis;
  }
  return directionOf(mass.x - centre.x, mass.y - centre.y, MASS_OFFSET_MIN) ?? choice.axis;
}

// --- the plates ----------------------------------------------------------------------------------

function plateTarget(rng: Rng, richness: number): number {
  const base = Math.round(lerp(PLATE_COUNT.low, PLATE_COUNT.high, richness));
  return clampInt(base + rng.int(4) - 1, PLATE_COUNT_BAND.min, PLATE_COUNT_BAND.max);
}

interface Slab { rect: Rect; land: number }

/**
 * Cuts the buildable island into plates: a rectilinear subdivision of the land's bounding box, each
 * slab's land taken as a plate.
 *
 * The cut is RECTILINEAR because the tier step drawn along it is what a district's boundary looks
 * like on the finished map, and the references' boundaries are straight. Where a cut falls is read
 * off the seed AND the slab's own coordinates rather than off the rng stream, so a slab lands in the
 * same place however many slabs were considered before it. Where a slab's land falls
 * into more than one piece (a bay between two headlands), each piece is its own plate — a plate is a
 * surface, and two pieces that do not touch are two surfaces — and a piece too small to compose on
 * is folded into the neighbour it shares the most boundary with.
 */
function cutPlates(
  land: Uint8Array, W: number, H: number, box: Rect, target: number, salt: number,
  field: Float32Array, massifPlates: number,
): Plate[] {
  const sum = integral(land, W, H);
  const lift = potentialSum(field, land, W, H);
  const slabs: Slab[] = [{ rect: box, land: rectSum(sum, W, box) }];
  const stuck = new Set<number>();
  // A slab's WANT is its land weighted by how high the composition wants it. The town is cut into
  // blocks and the mass into TERRACES, and a terrace is the narrower thing: the massif of a map
  // asked for eight tiers is a staircase of surfaces, so cutting it at a town block's scale spreads
  // the wedding cake over the whole island (measured: 85% of it came back as mountain) and leaves
  // the walk one step per quarter of the map.
  const pull = massifPlates > 0 ? MASSIF_PULL : 0;
  const want = (slab: Slab): number =>
    slab.land * (1 + pull * meanIn(lift, W, slab.rect));
  for (;;) {
    let pick = -1;
    for (let k = 0; k < slabs.length; k++) {
      if (stuck.has(k)) continue;
      if (pick < 0 || want(slabs[k]!) > want(slabs[pick]!)) pick = k;
    }
    if (pick < 0) break;
    const slab = slabs[pick]!;
    const mass = meanIn(lift, W, slab.rect) >= MASSIF_FROM;
    if (slabs.length >= (mass ? target + massifPlates : target)) break;
    const split = splitSlab(slab, sum, W, mix(salt, slabs.length), mass);
    if (!split) { stuck.add(pick); continue; }
    slabs[pick] = split[0];
    slabs.push(split[1]);
    stuck.clear();
  }
  return platesFromSlabs(slabs, land, W, H, field);
}

/** Divides a slab across its longer side, at a seeded offset from the middle. Returns null when
 *  neither axis can be cut into two halves that still hold a plate's worth of land. A slab on the
 *  MASS is cut to a terrace's scale rather than a block's. */
function splitSlab(
  slab: Slab, sum: Int32Array, W: number, salt: number, mass: boolean,
): [Slab, Slab] | null {
  const side = mass ? TERRACE_MIN_SIDE : PLATE_MIN_SIDE;
  const least = mass ? TERRACE_MIN_CELLS : PLATE_MIN_CELLS;
  const order: ('x' | 'y')[] = slab.rect.w >= slab.rect.h ? ['x', 'y'] : ['y', 'x'];
  for (const axis of order) {
    const span = axis === 'x' ? slab.rect.w : slab.rect.h;
    if (span < 2 * side) continue;
    const lo = side, hi = span - side;
    const t = 0.5 + (hash01(salt, axis === 'x' ? slab.rect.x : slab.rect.y) - 0.5) * SPLIT_JITTER;
    const cut = clampInt(Math.round(span * t), lo, hi);
    const a: Rect = axis === 'x'
      ? { x: slab.rect.x, y: slab.rect.y, w: cut, h: slab.rect.h }
      : { x: slab.rect.x, y: slab.rect.y, w: slab.rect.w, h: cut };
    const b: Rect = axis === 'x'
      ? { x: slab.rect.x + cut, y: slab.rect.y, w: slab.rect.w - cut, h: slab.rect.h }
      : { x: slab.rect.x, y: slab.rect.y + cut, w: slab.rect.w, h: slab.rect.h - cut };
    const landA = rectSum(sum, W, a), landB = rectSum(sum, W, b);
    if (landA < least || landB < least) continue;
    return [{ rect: a, land: landA }, { rect: b, land: landB }];
  }
  return null;
}

/** Mean of a per-cell field over a rect, off its own integral image. */
function meanIn(sum: Float64Array, W: number, r: Rect): number {
  const stride = W + 1;
  const x0 = r.x, y0 = r.y, x1 = r.x + r.w, y1 = r.y + r.h;
  const total = sum[y1 * stride + x1]! - sum[y0 * stride + x1]! - sum[y1 * stride + x0]! + sum[y0 * stride + x0]!;
  const area = Math.max(1, r.w * r.h);
  return total / area;
}

/** Integral image of the potential over the island, zero off it. */
function potentialSum(field: Float32Array, land: Uint8Array, W: number, H: number): Float64Array {
  const stride = W + 1;
  const sum = new Float64Array(stride * (H + 1));
  for (let y = 0; y < H; y++) {
    let row = 0;
    for (let x = 0; x < W; x++) {
      const i = flatIndex(x, y, W);
      row += land[i] ? field[i]! : 0;
      sum[(y + 1) * stride + x + 1] = sum[y * stride + x + 1]! + row;
    }
  }
  return sum;
}

/** The slabs' land as plates: one plate per connected piece, fragments folded into the neighbour
 *  they share the most boundary with, ids renumbered in raster order. */
function platesFromSlabs(
  slabs: readonly Slab[], land: Uint8Array, W: number, H: number, field: Float32Array,
): Plate[] {
  const owner = new Int16Array(W * H).fill(-1);
  const groups: number[][] = [];
  for (const slab of slabs) {
    const { x, y, w, h } = slab.rect;
    for (let cy = y; cy < y + h; cy++) {
      for (let cx = x; cx < x + w; cx++) {
        const i = flatIndex(cx, cy, W);
        if (!land[i] || owner[i]! >= 0) continue;
        // One connected piece of this slab's land.
        const id = groups.length;
        const cells: number[] = [];
        const stack = [i];
        owner[i] = id;
        while (stack.length) {
          const p = stack.pop()!;
          cells.push(p);
          const px = p % W, py = (p / W) | 0;
          for (const [dx, dy] of NB4) {
            const nx = px + dx, ny = py + dy;
            if (nx < x || ny < y || nx >= x + w || ny >= y + h) continue;
            const j = flatIndex(nx, ny, W);
            if (!land[j] || owner[j]! >= 0) continue;
            owner[j] = id; stack.push(j);
          }
        }
        cells.sort((a, b) => a - b);
        groups.push(cells);
      }
    }
  }
  foldFragments(groups, owner, W, H, field);
  const kept = groups.filter((cells) => cells.length > 0);
  kept.sort((a, b) => a[0]! - b[0]!);
  return kept.map((cells, id) => ({ id, rect: boundsOf(cells, W), cells, tier: 0, relief: 0 }));
}

/** Folds every piece under `PLATE_MIN_CELLS` into the neighbouring piece it shares the most boundary
 *  with, smallest first, until no fragment has a neighbour left to join. A piece with no neighbour
 *  at all is an islet: it keeps its cells and stands as a plate of its own, since dropping it would
 *  leave buildable ground on no plate. */
function foldFragments(
  groups: number[][], owner: Int16Array, W: number, H: number, field: Float32Array,
): void {
  // A TERRACE IS SMALLER THAN A BLOCK, so what counts as a fragment depends on where the piece
  // stands: on the mass a 60-cell surface is a step of the staircase, in the town it is a seam.
  const least = (cells: readonly number[]): number => {
    let sum = 0;
    for (const i of cells) sum += field[i]!;
    return cells.length && sum / cells.length >= MASSIF_FROM ? TERRACE_MIN_CELLS : PLATE_MIN_CELLS;
  };
  const islets = new Set<number>();
  for (;;) {
    let pick = -1;
    for (let id = 0; id < groups.length; id++) {
      const n = groups[id]!.length;
      if (n === 0 || n >= least(groups[id]!) || islets.has(id)) continue;
      if (pick < 0 || n < groups[pick]!.length) pick = id;
    }
    if (pick < 0) return;
    const shared = new Map<number, number>();
    for (const i of groups[pick]!) {
      const x = i % W, y = (i / W) | 0;
      for (const [dx, dy] of NB4) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const other = owner[flatIndex(nx, ny, W)]!;
        if (other < 0 || other === pick) continue;
        shared.set(other, (shared.get(other) ?? 0) + 1);
      }
    }
    if (shared.size === 0) { islets.add(pick); continue; }
    let best = -1, bestCount = -1;
    for (const [id, count] of [...shared.entries()].sort((a, b) => a[0] - b[0])) {
      if (count > bestCount) { best = id; bestCount = count; }
    }
    for (const i of groups[pick]!) owner[i] = best;
    groups[best] = [...groups[best]!, ...groups[pick]!].sort((a, b) => a - b);
    groups[pick] = [];
  }
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
 * How high the archetype wants each cell, 0..1, measured from the plaza outward (中心 → 四周). Zero is
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
      // A wall, a corner or a low-relief island: one axis, or two multiplied into a quadrant.
      const along = axisPotential(land, W, H, hub, axis);
      if (!crossAxis) return along;
      const across = axisPotential(land, W, H, hub, crossAxis);
      for (let i = 0; i < field.length; i++) field[i] = Math.sqrt(along[i]! * across[i]!);
      return field;
    }
  }
}

/** How far along `dir` a cell stands from the plaza, as a share of the farthest land cell in that
 *  direction. Zero on the plaza's other side: a wall rises on ONE side and the rest stays low. */
function axisPotential(land: Uint8Array, W: number, H: number, hub: { x: number; y: number }, dir: Direction): Float32Array {
  const step = STEP[dir];
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
      // A seeded tilt on the farthest-point pick, so two maps with the same island do not put their
      // massifs in the same places.
      const score = near * (0.75 + 0.5 * hash01(k, i));
      if (score > bestScore) { bestScore = score; best = i; }
    }
    if (best < 0) break;
    const x = best % W, y = (best / W) | 0;
    taken.push({ x, y });
    chosen.push({ x, y, radius: maxRad * lerp(MASSIF_RADIUS.min, MASSIF_RADIUS.max, rng.float()) });
  }
  return chosen;
}

// --- the tiers -----------------------------------------------------------------------------------

/**
 * Gives every plate its tier: the archetype's own reading of it, capped by how much support its
 * ground can offer, floored at the plaza's plate, then relaxed until no two neighbouring plates
 * stand more than `PLATE_STEP_MAX` apart.
 *
 * The relaxation is a shortest-path over the plate graph with `PLATE_STEP_MAX` per edge, so a plate
 * ends at the lowest of its own reading and every other plate's reading plus the climb to it. That
 * is the only way a cap can hold everywhere at once: lowering one plate lowers what its neighbours
 * may claim, and the neighbours' neighbours after them.
 *
 * THE READING IS RELATIVE TO THE COMPOSITION'S OWN TOP, not to the raw potential. A plate takes the
 * MEAN potential over its cells, and the archetype's potential is a ramp or a cone. Normalizing by
 * the highest plate mean makes the requested peak reachable while preserving the composition's
 * relative shape.
 */
function assignTiers(
  plates: Plate[], plateOf: Int16Array, W: number, H: number,
  field: Float32Array, coast: Int16Array, peakTier: number, plazaPlateId: number, richness: number,
  massif: boolean,
): void {
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
    if (plate.id !== plazaPlateId) top = Math.max(top, plate.relief);
  }
  // Normalize plate means so the requested peak is reachable. The exponent controls how far height
  // spreads down the slope: low richness raises only the top, while high richness terraces it all.
  const gamma = lerp(RELIEF_GAMMA.low, RELIEF_GAMMA.high, richness);
  const scale = massif && top > 0 ? 1 / top : 1;
  for (const plate of plates) {
    const reading = Math.pow(clamp01(plate.relief * scale), gamma);
    plate.tier = Math.min(Math.round(reading * peakTier), headrooms.get(plate.id)!, ELEVATION_MAX);
    if (plate.id === plazaPlateId) plate.tier = 0;
  }
  const edges = plateAdjacency(plates, plateOf, W, H);
  if (massif) raiseSkirt(plates, edges, headrooms, plazaPlateId);
  for (let pass = 0; pass < plates.length; pass++) {
    let changed = false;
    for (const [a, b] of edges) {
      const ta = plates[a]!.tier, tb = plates[b]!.tier;
      if (ta > tb + PLATE_STEP_MAX) { plates[a]!.tier = tb + PLATE_STEP_MAX; changed = true; }
      else if (tb > ta + PLATE_STEP_MAX) { plates[b]!.tier = ta + PLATE_STEP_MAX; changed = true; }
    }
    if (!changed) break;
  }
}

/**
 * THE MASS HAS A SKIRT: the plates between the plaza and the summit climb toward it.
 *
 * Without this the archetype's potential is read plate by plate and nothing joins them up. A massif
 * reads high at its own centre and near zero two plates out, so the summit stands beside ground at
 * the relief floor, the relaxation below then lowers the summit to that ground plus one step, and
 * a map asked for eight comes back at five — measured, and the shape it comes back as is a knoll
 * rather than a mountain. Reading the summit's claim BACKWARD over the plate graph is what makes
 * the composition a wedding cake: a plate carries at least as much height as the summit needs to
 * stand on it, or as much as its own ground can support, whichever is less.
 *
 * The plaza's plate keeps its zero and the relaxation still binds everything to it, so this can
 * raise the whole island without ever raising the hub.
 */
function raiseSkirt(
  plates: Plate[], edges: readonly [number, number][], headrooms: ReadonlyMap<number, number>,
  plazaPlateId: number,
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
        if (from !== at || to === plazaPlateId) continue;
        if ((want.get(to) ?? -1) >= next) continue;
        want.set(to, next);
        queue.push(to);
      }
    }
  }
  for (const plate of plates) {
    if (plate.id === plazaPlateId) continue;
    const asked = want.get(plate.id);
    if (asked === undefined) continue;
    plate.tier = Math.min(Math.max(plate.tier, asked), headrooms.get(plate.id)!, ELEVATION_MAX);
  }
}

/**
 * THE SUMMIT: nested terraces cut into the composition's tallest ground until the asked peak is
 * reached.
 *
 * Two things are true at once and this pass is what reconciles them. A plate is one surface and
 * touching plates step at most `PLATE_STEP_MAX`, so the partition alone runs out of height before
 * the caller's cap is reached. And the reference island is not a slab: its mass is a TERRACED
 * massif, one surface stepping up over the ring of the one below.
 *
 * So the highest GROUND — every plate standing at the top tier, which after the skirt pass is a
 * region rather than one slab — keeps a ring and gives its interior to a new plate a step higher,
 * and the new plate is crowned again while height is still owed and the ground still holds a
 * terrace worth standing on. Each crown is legal by the same argument every other plate is: it
 * steps at most `PLATE_STEP_MAX` over the ring it stands in, and the ring is the 3x3 support
 * V-MTN-03 reads. Nothing downstream is told about crowns — the streets, the districts and the walk
 * all read plates, and a crown is one, which is what puts a flight on the way up and a place on top.
 */
function raiseCrown(
  plates: Plate[], plateOf: Int16Array, W: number, H: number, coast: Int16Array, peakTier: number,
  plazaPlateId: number, hubAt: { x: number; y: number },
): number {
  let hub = plazaPlateId;
  for (let step = 0; step < CROWN_STEPS_MAX; step++) {
    const top = plates.reduce((m, p) => Math.max(m, p.tier), 0);
    if (top <= 0 || top >= peakTier) return hub;
    // THE GROUND A CROWN MAY STAND ON is everything already within V-MTN-03's window of the crown's
    // own tier, whichever plate it belongs to. Reading only the top plate makes the summit's shape
    // the shape of one slab of the cut — on a mass cut into a 34x16 band there is no room left for
    // a terrace, and the map stops a tier short of what was asked.
    //
    // Two knobs and both are geometry rather than taste: how many tiers the crown lifts, and how far
    // down the ground it stands on may reach. A deeper reach is a wider terrace and a longer flight
    // to climb it (`RAMP_RUN` cells of run per tier), so the two trade against each other.
    //
    // ONE TIER AT A TIME WHERE THE GROUND ALLOWS IT. A crown lifting three tiers has to stand thirteen
    // cells in (the flight that climbs it is four cells of run per tier), so it comes out a small cap
    // on a big hill; three crowns of one tier each stand five cells in and come out BROAD, which is
    // what the reference island's high ground is — a plateau a visitor walks on, not a peak they look
    // at. The taller lifts are what is left for a mass with no room for a third terrace.
    //
    // THE COAST'S HEADROOM IS READ PER CELL, not over the candidate as a whole. Read as the MINIMUM
    // coast distance over the whole terrace, the candidate demotes to what its one worst cell can
    // support, which is a terrace's worth of height thrown away for its nearest corner —
    // and with a one-sided ring the terrace reaches further, so the corner is nearer the shore and the
    // demotion cost six tafa seeds of twenty their asked cap. A cell without the headroom for the tier
    // is simply not ground the crown may stand on.
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
        const inner = insetOf(support, W, H, Math.min(CROWN_RING_MIN, full), full, hubAt);
        if (inner.length < CROWN_MIN_CELLS) continue;
        if (want < tier || (want === tier && inner.length <= cells.length)) continue;
        cells = inner; tier = want;
      }
    }
    // A STEP THAT FINDS NO CROWN ENDS THE PASS: nothing about the plates changed, so the next step
    // would ask the same question of the same ground and be told the same thing. Measured over twenty
    // seeds on both templates, this is where two `distributed-massifs` seeds on tafa stop a tier short
    // of eight. With one tier still owed the lift may only be 1, and EVERY floor it could stand on
    // erodes to exactly zero cells at the inset that lift needs (`tafa/31337`: 1553 cells at tier 5
    // taking inset 13, 480 at tier 6 taking 9, 100 at tier 7 taking 5; `tafa/60103`: 1067, 737, 86).
    // The mass is thin rather than short, so what closes it is a WIDER mass and not a taller search.
    if (!cells.length) break;
    const taken = new Set(cells);
    const id = plates.length;
    for (const plate of plates) {
      const kept = plate.cells.filter((i) => !taken.has(i));
      if (kept.length === plate.cells.length) continue;
      plate.cells = kept;
      plate.rect = boundsOf(kept, W);
    }
    for (const i of cells) plateOf[i] = id;
    plates.push({ id, rect: boundsOf(cells, W), cells, tier, relief: 1 });
    // A plate the crown cut in two is two surfaces, and a plate is one: the pieces stand as plates
    // of their own at the same tier, which is legal by construction and true to what the ground is.
    hub = splitDonors(plates, plateOf, W, H, hub);
  }
  return hub;
}

/** Every plate cut into pieces by the crown, re-registered one plate per piece: the largest keeps
 *  the id, the rest are appended, and a plate the crown consumed entirely is dropped. Returns where
 *  the plaza's plate ended up. */
function splitDonors(
  plates: Plate[], plateOf: Int16Array, W: number, H: number, plazaPlateId: number,
): number {
  const added: Plate[] = [];
  for (const plate of plates) {
    if (plate.cells.length === 0) continue;
    const pieces = surfacesOf(plate.cells, W, H);
    if (pieces.length < 2) continue;
    pieces.sort((a, b) => b.length - a.length);
    plate.cells = pieces[0]!;
    plate.rect = boundsOf(plate.cells, W);
    for (const piece of pieces.slice(1)) {
      const id = plates.length + added.length;
      for (const i of piece) plateOf[i] = id;
      added.push({ id, rect: boundsOf(piece, W), cells: piece, tier: plate.tier, relief: plate.relief });
    }
  }
  plates.push(...added);
  return compact(plates, plateOf, plazaPlateId);
}

/** Drops the emptied plates and renumbers what is left, so `plates[id].id === id` holds — the
 *  invariant every `plateOf` lookup in the tree rests on. */
function compact(plates: Plate[], plateOf: Int16Array, plazaPlateId: number): number {
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
  return remap.get(plazaPlateId) ?? 0;
}

/** The cells as 4-connected surfaces, each ascending. */
function surfacesOf(cells: readonly number[], W: number, H: number): number[][] {
  const own = new Set(cells);
  const seen = new Set<number>();
  const out: number[][] = [];
  for (const start of cells) {
    if (seen.has(start)) continue;
    const piece: number[] = [];
    const stack = [start];
    seen.add(start);
    while (stack.length) {
      const p = stack.pop()!;
      piece.push(p);
      const x = p % W, y = (p / W) | 0;
      for (const [dx, dy] of NB4) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const j = flatIndex(nx, ny, W);
        if (!own.has(j) || seen.has(j)) continue;
        seen.add(j);
        stack.push(j);
      }
    }
    out.push(piece.sort((a, b) => a - b));
  }
  return out;
}

/**
 * The interior of a region of cells: the largest connected piece of what survives being eroded
 * `ring` cells in from everything that is not the region, and `flight` cells in from the part of its
 * boundary that faces `toward`. Ascending, or an empty list where the erosion left nothing.
 *
 * The distance is CHEBYSHEV, the same window V-MTN-03 reads a cell's support over, so the ring left
 * behind is at least `ring` cells thick everywhere — which is what keeps the ground under a crown one
 * connected surface — and it is `flight` cells thick on the side a walk would climb, which is where
 * the run of a ramp has to fit.
 *
 * The FLIGHT SIDE is the half of the boundary on the `toward` side of the region's own centroid. Where
 * `toward` sits on the centroid, or the split leaves that half empty, every side pays the flight's own
 * inset: a terrace nobody can reach is worse than a narrow one.
 */
function insetOf(
  region: ReadonlySet<number>, W: number, H: number, ring: number,
  flight = ring, toward?: { x: number; y: number },
): number[] {
  const seeds: number[] = [];
  for (const i of region) {
    const x = i % W, y = (i / W) | 0;
    for (const [dx, dy] of NB8) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H || !region.has(flatIndex(nx, ny, W))) {
        seeds.push(i);
        break;
      }
    }
  }
  if (seeds.length === 0) return [];
  const distance = distanceField(seeds, W, H, true);
  const climb = flight > ring && toward ? facingSeeds(seeds, W, region, toward) : null;
  const climbDistance = climb && climb.length ? distanceField(climb, W, H, true) : null;
  const inside = new Set<number>();
  for (const i of region) {
    if (distance[i]! < (climbDistance ? ring : Math.max(ring, flight))) continue;
    if (climbDistance && climbDistance[i]! < flight) continue;
    inside.add(i);
  }
  // An erosion can break one surface into several; a crown is ONE terrace, so the largest piece is
  // the crown and the rest stays on the ring it was cut from.
  let best: number[] = [];
  const seen = new Set<number>();
  for (const start of inside) {
    if (seen.has(start)) continue;
    const piece: number[] = [];
    const stack = [start];
    seen.add(start);
    while (stack.length) {
      const p = stack.pop()!;
      piece.push(p);
      const x = p % W, y = (p / W) | 0;
      for (const [dx, dy] of NB4) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const j = flatIndex(nx, ny, W);
        if (!inside.has(j) || seen.has(j)) continue;
        seen.add(j);
        stack.push(j);
      }
    }
    if (piece.length > best.length) best = piece;
  }
  return best.sort((a, b) => a - b);
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

/**
 * Every pair of plates that TOUCH, each pair once, in id order.
 *
 * Touching includes a DIAGONAL touch, and it has to: V-MTN-03 reads the whole 3x3 around a cell, so
 * a plate whose corner cell meets another plate's corner cell has that cell's tier inside the window
 * it must be supported by. Two independent cuts can land on one coordinate and produce a `+`
 * junction where four plates meet at a point, and edge-only adjacency would bound those diagonal
 * pairs at twice the step, through the two plates between them, rather than at the step.
 */
export function plateAdjacency(plates: readonly Plate[], plateOf: Int16Array, W: number, H: number): [number, number][] {
  const seen = new Set<number>();
  const out: [number, number][] = [];
  for (const plate of plates) {
    for (const i of plate.cells) {
      const x = i % W, y = (i / W) | 0;
      for (const [dx, dy] of NB8) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const other = plateOf[flatIndex(nx, ny, W)]!;
        if (other < 0 || other === plate.id) continue;
        const lo = Math.min(plate.id, other), hi = Math.max(plate.id, other);
        const key = lo * plates.length + hi;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push([lo, hi]);
      }
    }
  }
  out.sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]));
  return out;
}

/** The plate holding the buildable cell nearest the plaza's centre. */
function nearestPlateTo(plates: readonly Plate[], plateOf: Int16Array, W: number, H: number, hub: { x: number; y: number }): number {
  let best = plates.length ? plates[0]!.id : -1, bestD = Infinity;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const id = plateOf[flatIndex(x, y, W)]!;
      if (id < 0) continue;
      const d = Math.hypot(x - hub.x, y - hub.y);
      if (d < bestD) { bestD = d; best = id; }
    }
  }
  return best;
}

/** Tier-weighted centroid of the plates: where a reader would say the map's mass sits. */
function massCentroidOf(plates: readonly Plate[], W: number, hub: { x: number; y: number }): { x: number; y: number } {
  let weight = 0, sx = 0, sy = 0;
  for (const plate of plates) {
    if (plate.tier <= 0) continue;
    for (const i of plate.cells) {
      weight += plate.tier;
      sx += plate.tier * (i % W);
      sy += plate.tier * ((i / W) | 0);
    }
  }
  return weight > 0 ? { x: sx / weight, y: sy / weight } : { x: hub.x, y: hub.y };
}

// --- the island ----------------------------------------------------------------------------------

const NB4 = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;
/** The 3x3 neighbourhood minus the cell: the window V-MTN-03 reads a cell's support over. */
const NB8 = [
  [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1],
] as const;

/** The buildable island: the Grass zone, the same mask the layout packs lots on. */
function landMask(template: MapTemplate): Uint8Array {
  const W = template.width, H = template.height;
  const land = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (template.zones[y]?.[x] === CellZone.Grass) land[flatIndex(x, y, W)] = 1;
    }
  }
  return land;
}

/** Chebyshev distance from the nearest unbuildable cell: how much support the ground can offer,
 *  three tiers per cell, exactly as the sculptor reads it. */
function coastDistance(land: Uint8Array, W: number, H: number): Int16Array {
  const seeds: number[] = [];
  for (let i = 0; i < land.length; i++) if (!land[i]) seeds.push(i);
  return distanceField(seeds, W, H, true);
}

/** The island's centre of area: the origin a mass direction is fairly measured from. */
function landCentroid(land: Uint8Array, W: number): { x: number; y: number } {
  let n = 0, sx = 0, sy = 0;
  for (let i = 0; i < land.length; i++) {
    if (!land[i]) continue;
    n++; sx += i % W; sy += (i / W) | 0;
  }
  return n ? { x: sx / n, y: sy / n } : { x: 0, y: 0 };
}

function landBox(land: Uint8Array, W: number, H: number): Rect {
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!land[flatIndex(x, y, W)]) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return x1 < 0 ? { x: 0, y: 0, w: 0, h: 0 } : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

function boundsOf(cells: readonly number[], W: number): Rect {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const i of cells) {
    const x = i % W, y = (i / W) | 0;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  if (!Number.isFinite(x0)) return { x: 0, y: 0, w: 0, h: 0 };
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** The plaza's centre in macro cells: the hub every distance here is measured from. */
function plazaCentre(template: MapTemplate): { x: number; y: number } {
  const r = plazaRect(template);
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}

// --- arithmetic ----------------------------------------------------------------------------------

function integral(mask: Uint8Array, W: number, H: number): Int32Array {
  const stride = W + 1;
  const sum = new Int32Array(stride * (H + 1));
  for (let y = 0; y < H; y++) {
    let row = 0;
    for (let x = 0; x < W; x++) {
      row += mask[flatIndex(x, y, W)] ? 1 : 0;
      sum[(y + 1) * stride + x + 1] = sum[y * stride + x + 1]! + row;
    }
  }
  return sum;
}

function rectSum(sum: Int32Array, W: number, r: Rect): number {
  const stride = W + 1;
  const x0 = r.x, y0 = r.y, x1 = r.x + r.w, y1 = r.y + r.h;
  return sum[y1 * stride + x1]! - sum[y0 * stride + x1]! - sum[y1 * stride + x0]! + sum[y0 * stride + x0]!;
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const clampInt = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, Math.round(v)));
const lerp = (a: number, b: number, t: number): number => a + (b - a) * clamp01(t);

/** Avalanche of two integers into one 32-bit value: neighbouring inputs give unrelated outputs. */
function mix(a: number, b: number): number {
  let h = (Math.imul(a ^ b, 0x27d4eb2d) + 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

/** A 0..1 hash of two integers: the split offsets read positionally rather than off the rng stream,
 *  so a cut lands in the same place whatever order the slabs were considered in. */
function hash01(a: number, b: number): number {
  return mix(Math.imul(a, 0x2545f491), b) / 4294967296;
}
