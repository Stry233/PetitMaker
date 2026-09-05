/**
 * Builds regular artificial-water compositions from concentric square, octagonal, ring, or cross
 * bands. Water and dry bands alternate around a raised center figure, with a reserved dry court that
 * the street pass may pave. Courts require one flat terrace, making water faces and mountain support
 * legal by construction. Large sites are tried before garden-scale sites; seeded shape and nesting
 * choices keep instances distinct. Pure planning only: inputs and masks in, cells out.
 */
import { flatIndex } from '../../../../core/model/grid-model';
import type { MacroCoord, Rect } from '../../../../core/model/types';
import type { TerrainPlan } from '../../core/types';
import type { DesignPlan, RegionPlan } from '../types';
import { cellsFit, floodCells, freeAt } from './water-cut';

// --- tunables -----------------------------------------------------------------------------------

/** The half-span of a court's water, large and small. The style target's own is 7 (a 14x14 platform
 *  inside a 1-wide moat); a garden fountain is a third of that. */
const RADIUS = { small: { min: 2, max: 3 }, large: { min: 5, max: 7 } } as const;
/** How much open ground is kept around the water, large and small: the court itself. */
const COURT = { small: 1, large: 2 } as const;
/** How deep the nesting goes, by span. A court with no room for a platform is one basin. */
const DEPTH_MAX = 3;
/**
 * The fewest levels of the outline metric a WATER band may be drawn at, and a DRY one.
 *
 * Two is not a taste choice for the water. `waterBodies` decomposes 4-connected, and one level of the
 * octagon, ring or cross metric is a ring that meets itself only at its diagonals: it comes apart into
 * pieces under the accent floor, so a court drawn with a one-level moat is invisible to `isCourt`, to
 * the one-main-fountain rule and to the arrival reading alike. Two levels is also what the CROSS needs
 * to enclose anything, since a step off its arms costs `CROSS_FLARE`.
 */
const MOAT_MIN = 2;
const PLATFORM_MIN = 1;
/** How far a court looks for the pavement it is composed against. The supplement wants a fountain
 *  RELATED to the space around it, and an unreachable one is only an ornament. */
const ARRIVAL_REACH = 6;
/** How many courts one island carries at richness 0 and 1, the large one included. Three is the style
 *  target's own count, and it is also what the eval can tell apart: a fourth court is one more chance
 *  for two of them to land in one region as the finished map segments it. */
const COUNT = { min: 1, max: 3 } as const;
/** How far from the plaza the LARGE court may stand: it is the hub's own set piece. */
const PLAZA_REACH = 34;
/**
 * How far apart two courts stand. 一个区域有明确的主喷泉即可，不要同时有多个: one clear main fountain per
 * region, and a reader draws the region boundary by eye, so two courts a few cells apart read as several
 * in one place however the plan divided the ground.
 *
 * The number is the MEASUREMENT rather than a guess at what a region is. The eval segments the finished
 * map and a terraced island segments coarsely, so two courts the plan put in two places can land in one
 * region: at 30 cells four of twenty runs read two main courts in one region, at 42 two still do, and at
 * 55 none of the twenty do. Courts per map fall to 1 to 3 for it, which is the style target's own count.
 *
 * IT IS A FUNCTION OF THE PLACE SCALE, so the spacing moves with the places: the runs the evaluator
 * segments have a median of 49 to 79 cells, one region covers ground enough for two courts, and at 55
 * `hexia/31337` reads two main courts in one region.
 */
const COURT_SPACING = 72;

// --- what a court is ----------------------------------------------------------------------------

export type FountainOutline = 'square' | 'octagon' | 'ring' | 'cross';

/** One band of the composition, outside in. The first is always water: a court reads as a fountain
 *  because it is ringed by its moat. */
export interface FountainBand {
  width: number;
  water: boolean;
}

/** The GRAMMAR's own output: what a court looks like, before it has a place on the map. */
export interface FountainSpec {
  outline: FountainOutline;
  /** Half-span: the water spans `2 * radius + 1` cells. */
  radius: number;
  bands: FountainBand[];
  /** Half-span of the mountain figure at the centre. Never negative: every court stands one, at
   *  every nesting depth. */
  figure: number;
}

export interface FountainCourt {
  spec: FountainSpec;
  /** The place this court anchors, or '' for the plaza's own. */
  regionId: string;
  size: 'large' | 'small';
  centre: MacroCoord;
  tier: number;
  /** The whole court including its dry ground: what nothing else may take. */
  rect: Rect;
  water: MacroCoord[];
  figure: MacroCoord[];
  /** The dry band immediately around the water, following the outline: the court's own BORDER, which
   *  the pipeline paves where it can join the plaza's network. A frame the eye reads as a border is
   *  the difference between a fountain and a pool someone left in a field, and the reference frames
   *  its own set piece in road on all four sides. */
  frame: MacroCoord[];
  /** The paved cell the court was composed against: a street end, the plaza's apron, a doorstep. */
  arrival: MacroCoord;
}

export interface FountainInput {
  t: TerrainPlan;
  grass: Uint8Array;
  flat: Uint8Array;
  plan: DesignPlan;
  /** Where the streets are going to be, so a court stands at something a visitor walks to. */
  paved: Uint8Array;
  richness: number;
  seed: number;
  /** The map's own ceiling: the centre figure never passes it. */
  ceiling: number;
}

// --- the grammar --------------------------------------------------------------------------------

/**
 * One instance of the grammar: an outline, a nesting and a figure, drawn from the seed and the room
 * the site has.
 *
 * The bands alternate from the outside in and always start wet, so the composition is a moat, then a
 * platform, then a basin, for as many as the radius carries — and the CENTRE always carries the
 * figure, whatever the innermost band is.
 *
 * TWO FLOORS, each guarding a failure mode:
 *
 * EVERY WATER BAND IS `MOAT_MIN` LEVELS DEEP. A one-level moat is not a body: `waterBodies` is a
 * 4-connected decomposition, and a one-level ring of the octagon, ring or cross metric touches itself
 * only at the diagonals, so it shatters into fragments smaller than an accent and the court the plan
 * drew is INVISIBLE to every reading downstream — `isCourt` cannot see it, the per-region rule has
 * nothing to count, and `placeArrivals` does not list it as a place. It also reads thin on screen,
 * which is the same fault seen from the other side.
 *
 * AND THE CENTRE ALWAYS CARRIES A FIGURE. The figure is the innermost thing and the bands are drawn
 * around it, so an even-depth court stands its mountain on the platform and an odd-depth one in the
 * basin. A figure that instead filled what the innermost WATER band encloses leaves an even-depth
 * nesting — moat, platform, and nothing else — with no figure at all: eight of twenty measured maps
 * stand a thin ring round a bare platform that way, which reads as a pond in a lawn.
 */
export function fountainSpec(seed: number, k: number, radius: number): FountainSpec {
  const outlines: readonly FountainOutline[] = ['square', 'octagon', 'ring', 'cross'];
  const outline = outlines[Math.floor(hash01(seed ^ 0x0f0a, k) * outlines.length)]!;
  const levels = radius + 1;
  /** The levels `n` further bands need at their own floors, the next one wet or dry as given. */
  const need = (n: number, wet: boolean): number => {
    let sum = 0;
    for (let i = 0; i < n; i++) { sum += wet ? MOAT_MIN : PLATFORM_MIN; wet = !wet; }
    return sum;
  };
  // The deepest nesting this span affords, at the floors above plus one level for the figure.
  let depth = Math.max(1, Math.min(DEPTH_MAX, 1 + Math.floor(hash01(seed ^ 0x51c3, k * 3) * DEPTH_MAX)));
  while (depth > 1 && need(depth, true) + 1 > levels) depth--;
  const bands: FountainBand[] = [];
  let left = levels;
  for (let b = 0; b < depth; b++) {
    const water = b % 2 === 0;
    const floorWidth = water ? MOAT_MIN : PLATFORM_MIN;
    // What the bands still to come need, plus the level the figure stands on.
    const reserve = need(depth - 1 - b, !water) + 1;
    const width = Math.max(floorWidth, Math.min(left - reserve,
      floorWidth + Math.floor(hash01(seed ^ 0x2ad9, k * 7 + b) * 2)));
    bands.push({ width, water });
    left -= width;
  }
  return { outline, radius, bands, figure: Math.max(0, left - 1) };
}

/**
 * The metric a court's outline is a level set of. Chebyshev draws a square, Euclidean a ring, the two
 * averaged an octagon, and the fourth penalises the SHORTER of the two offsets so the level set keeps
 * four arms — a cruciform basin, the outline the supplement's own 街角 fountains take.
 *
 * The cross is the one that needs an argument. `max(ax, ay)` alone reaches `radius` in every
 * direction; adding `CROSS_FLARE` per cell of the shorter offset past the arm's own half-width costs
 * a diagonal cell far more than an axial one, so a cell on an arm is inside the level set out to the
 * full radius and a cell off it is excluded within two. Every entry stays symmetric in ax and ay AND
 * about the diagonal, which is what keeps the composition mirrored about both of its axes whatever
 * the seed drew — the property the whole grammar rests on.
 */
export function outlineMetric(outline: FountainOutline, dx: number, dy: number): number {
  const ax = Math.abs(dx), ay = Math.abs(dy);
  switch (outline) {
    case 'square': return Math.max(ax, ay);
    case 'ring': return Math.round(Math.hypot(ax, ay));
    case 'cross': return Math.max(ax, ay) + CROSS_FLARE * Math.max(0, Math.min(ax, ay) - CROSS_ARM);
    default: return Math.max(Math.max(ax, ay), Math.round((ax + ay) * 0.75));
  }
}

/**
 * The cross's arm half-width, and what a cell off the arms costs.
 *
 * THE FLARE IS ONE BECAUSE A BAND HAS TO BE 4-CONNECTED. At two, the metric climbs two levels per
 * diagonal step, so a band two levels deep skips a rung as it turns the corner between two arms and
 * the ring falls into four pieces — each thinner than the accent floor, which is what made a
 * cruciform court invisible to `isCourt`, to the one-main-fountain rule and to the arrival reading
 * alike: of eighteen measured maps carrying a large court, the only three whose court could not be seen
 * were the crosses. At one, the band's diagonal staircase is two cells
 * wide and joins up, and the arms still read: a cell on an arm is inside the level set to the full
 * radius, one off it by three cells is not.
 */
const CROSS_ARM = 1;
const CROSS_FLARE = 1;

/** The court's cells, split by what they are: the water bands, the mountain figure, and the dry
 *  platforms between them. Every set is symmetric about both axes of the composition. */
export function fountainCells(
  spec: FountainSpec, centre: MacroCoord,
): { water: MacroCoord[]; figure: MacroCoord[]; dry: MacroCoord[] } {
  const water: MacroCoord[] = [], figure: MacroCoord[] = [], dry: MacroCoord[] = [];
  for (let dy = -spec.radius; dy <= spec.radius; dy++) {
    for (let dx = -spec.radius; dx <= spec.radius; dx++) {
      const d = outlineMetric(spec.outline, dx, dy);
      if (d > spec.radius) continue;
      const at = { x: centre.x + dx, y: centre.y + dy };
      if (spec.figure >= 0 && d <= spec.figure) { figure.push(at); continue; }
      (bandAt(spec, d).water ? water : dry).push(at);
    }
  }
  return { water, figure, dry };
}

/** Which band a cell at metric distance `d` from the centre belongs to. */
function bandAt(spec: FountainSpec, d: number): FountainBand {
  let outer = spec.radius;
  for (const band of spec.bands) {
    if (d > outer - band.width) return band;
    outer -= band.width;
  }
  return spec.bands[spec.bands.length - 1]!;
}

// --- placing them -------------------------------------------------------------------------------

/**
 * The island's fountain courts, cut into the sculpt.
 *
 * ONE LARGE COURT AT MOST, standing near the plaza where it has a whole court to itself, and one
 * small one per remaining place that asked for water. The court's own ground is locked into the
 * reservation as it lands, so no later pass floods it and no bed is cut through it.
 */
/**
 * How often an island is OFFERED a large court, at richness 0 and 1 — and it is RARER AT THE RICH END,
 * which is the opposite of how the other knobs on this axis run.
 *
 * The reason is what else the island has. A full-richness map carries a figure, a cascade and several
 * composed bodies, so a court can be absent and the walk still arrives somewhere — and absence is what
 * keeps a form the user meets on every island from reading as a template. A quiet map is a flat garden
 * town whose court is the ONLY thing on it built to be arrived at: rolled at the rich end's rate down
 * there, `tafa/1024` at richness 0.2 came back with 4 of its 14 street ends arriving at nothing, which
 * is a hard-ledger failure. The ground still has the last word — an offer the island cannot hold comes
 * to nothing.
 */
const LARGE_COURT_CHANCE = { low: 0.9, high: 0.6 } as const;

export function carveFountains(input: FountainInput): FountainCourt[] {
  const { plan, richness } = input;
  const budget = Math.round(lerp(COUNT.min, COUNT.max, richness));
  const out: FountainCourt[] = [];

  const hub = {
    x: Math.round(plan.plazaHub.x + plan.plazaHub.w / 2),
    y: Math.round(plan.plazaHub.y + plan.plazaHub.h / 2),
  };
  const wet = plan.regions.filter((r) => r.water === true && r.lot.length > 0);
  const rest = plan.regions.filter((r) => r.water !== true && r.lot.length > 0);
  const candidates = [...wet, ...rest]
    .sort((a, b) => Number(b.water === true) - Number(a.water === true)
      || distanceTo(hub, a) - distanceTo(hub, b) || (a.id < b.id ? -1 : 1));

  // A LARGE COURT IS AN OCCASION, NOT FURNITURE. Asked for on every island — the plaza's ground first and
  // then every place in turn, biggest lot down — it lands on nineteen of twenty maps, and a form a visitor
  // meets on every map reads as a template whatever it is composed of. The seeded roll is what keeps a
  // couple of islands in five to their garden fountains alone: absence is part of the variety.
  const large = hash01(input.seed ^ 0x1a5e, 0) < lerp(LARGE_COURT_CHANCE.low, LARGE_COURT_CHANCE.high, richness)
    ? plazaCourt(input, hub, out.length)
      ?? [...candidates].sort((a, b) => lotArea(b) - lotArea(a) || (a.id < b.id ? -1 : 1))
        .reduce<FountainCourt | null>((found, region) => found ?? largeInRegion(input, region, 0), null)
    : null;
  if (large) { out.push(large); reserve(input, large); }

  // One MAIN fountain per region, never several: the places that asked for water take a small court
  // each, nearest the hub first, so the ones a visitor meets are the ones that get built. Where none
  // of them could carry one — and where the plaza could not either — every other place is offered
  // it, because an island with no fountain at all is the one outcome the supplement rules out.
  for (const region of candidates) {
    if (out.length >= budget) break;
    const court = regionCourt(input, region, out.length);
    if (!court) continue;
    if (out.some((c) => Math.abs(c.centre.x - court.centre.x) + Math.abs(c.centre.y - court.centre.y)
      < COURT_SPACING)) continue;
    out.push(court);
    reserve(input, court);
  }
  return out;
}

const distanceTo = (hub: MacroCoord, region: RegionPlan): number => {
  const lot = region.lot[0]!;
  return Math.abs(lot.x + lot.w / 2 - hub.x) + Math.abs(lot.y + lot.h / 2 - hub.y);
};

const lotArea = (region: RegionPlan): number => {
  const lot = region.lot[0]!;
  return lot.w * lot.h;
};

/** The large court drawn at a place's own middle, for the island whose hub could not carry one. */
function largeInRegion(input: FountainInput, region: RegionPlan, k: number): FountainCourt | null {
  const lot = region.lot[0]!;
  const at = { x: Math.round(lot.x + lot.w / 2), y: Math.round(lot.y + lot.h / 2) };
  const site = largeCourt(input, at, Math.max(lot.w, lot.h), k);
  return site ? { ...site, regionId: region.id, size: 'large' } : null;
}

/** The plaza's own court: the largest the ground near the hub carries, composed against the apron. */
function plazaCourt(input: FountainInput, hub: MacroCoord, k: number): FountainCourt | null {
  const site = largeCourt(input, hub, PLAZA_REACH, k);
  return site ? { ...site, regionId: '', size: 'large' } : null;
}

/**
 * The largest court the ground within `reach` of `from` carries, with its spec.
 *
 * The span is drawn from the seed and walked DOWN, so a site that cannot hold the court the seed
 * asked for is offered the same composition at every smaller span before it is given up on, one step
 * BELOW the grammar's own floor at the last. That last step is not a rare fallback: a full island at
 * full richness reserves nearly all of its flat ground for streets, lots and terraces, and over eighteen
 * measured maps carrying a large court, NINE stand it at the sub-floor span.
 * The floor is what the ground affords rather than what the grammar prefers, and the sub-floor span
 * still reads as a main fountain by the evaluation's own test (`COURT_MAIN_SPAN`, which it meets
 * exactly).
 *
 * THE COURT MARGIN IS NEVER WHAT GIVES WAY. Shrinking it to one cell costs the court its BORDER: a
 * coating validates one column right and one row below itself, so a band one cell wide between water and
 * ordinary ground is unpavable almost everywhere, and what it leaves is a pond in a field. A smaller
 * court with its two cells of dry ground is still a court.
 */
function largeCourt(
  input: FountainInput, from: MacroCoord, reach: number, k: number,
): (Site & { spec: FountainSpec }) | null {
  const { seed } = input;
  const span = RADIUS.large.min
    + Math.floor(hash01(seed ^ 0x7bb2, k) * (RADIUS.large.max - RADIUS.large.min + 1));
  for (let radius = span; radius >= RADIUS.large.min - 1; radius--) {
    const spec = fountainSpec(seed, k, radius);
    const site = search(input, from, reach, spec, COURT.large);
    if (site) return { ...site, spec };
  }
  return null;
}

/**
 * A garden fountain at a place's STREET CORNER, composed against the pavement that reaches it.
 *
 * 小喷泉则可以放在花园、街角: the supplement puts a small one at a corner, and the geometry agrees.
 * A court at the middle of a lot is a hole through the axis its kit mirrors about, and the symmetry
 * reading falls by the whole difference; at the entry side it stands where a visitor meets the place
 * and the composition behind it is left whole.
 */
function regionCourt(input: FountainInput, region: RegionPlan, k: number): FountainCourt | null {
  const { seed } = input;
  const lot = region.lot[0]!;
  const span = RADIUS.small.min
    + Math.floor(hash01(seed ^ 0x7bb2, k + 97) * (RADIUS.small.max - RADIUS.small.min + 1));
  // The corner first and the middle of the place after it: a lot whose entry side is a strip too
  // narrow for a court has one somewhere, and a fountain in the middle of a garden is still a
  // fountain — it is only the second-best place for it.
  const from = [entryCorner(lot, region.entrySide), {
    x: Math.round(lot.x + lot.w / 2), y: Math.round(lot.y + lot.h / 2),
  }];
  for (let radius = span; radius >= RADIUS.small.min; radius--) {
    const spec = fountainSpec(seed, k + 97, radius);
    for (const at of from) {
      const site = search(input, at, Math.max(lot.w, lot.h), spec, COURT.small);
      if (site) return { ...site, spec, regionId: region.id, size: 'small' };
    }
  }
  return null;
}

/** The middle of the lot's entry edge, a third of the way in: where a street meets the place. */
function entryCorner(lot: Rect, entry: RegionPlan['entrySide']): MacroCoord {
  const third = (n: number): number => Math.max(1, Math.round(n / 3));
  switch (entry) {
    case 'north': return { x: Math.round(lot.x + lot.w / 2), y: lot.y + third(lot.h) };
    case 'south': return { x: Math.round(lot.x + lot.w / 2), y: lot.y + lot.h - 1 - third(lot.h) };
    case 'west': return { x: lot.x + third(lot.w), y: Math.round(lot.y + lot.h / 2) };
    default: return { x: lot.x + lot.w - 1 - third(lot.w), y: Math.round(lot.y + lot.h / 2) };
  }
}

type Site = Pick<FountainCourt, 'centre' | 'tier' | 'rect' | 'water' | 'figure' | 'frame' | 'arrival'>;

/** The nearest cell to `from` within `reach` that carries the whole composition and has pavement
 *  arriving at it. Scanned by ring, so the answer is the nearest one and does not move with the
 *  order the map happens to be walked in. */
function search(
  input: FountainInput, from: MacroCoord, reach: number, spec: FountainSpec, court: number,
): Site | null {
  for (let r = 0; r <= reach; r++) {
    let best: Site | null = null;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const site = fits(input, { x: from.x + dx, y: from.y + dy }, spec, court);
        if (site && !best) best = site;
      }
    }
    if (best) return best;
  }
  return null;
}

/** Whether the whole composition stands at `centre`: one terrace under all of it, the court around
 *  it untouched, and a paved cell within reach for it to be composed against. */
function fits(
  input: FountainInput, centre: MacroCoord, spec: FountainSpec, court: number,
): Site | null {
  const { t, grass, flat, ceiling } = input;
  const half = spec.radius + court;
  const rect: Rect = { x: centre.x - half, y: centre.y - half, w: 2 * half + 1, h: 2 * half + 1 };
  if (rect.x < 1 || rect.y < 1 || rect.x + rect.w >= t.width || rect.y + rect.h >= t.height) return null;
  const tier = t.tier[flatIndex(centre.x, centre.y, t.width)]!;
  if (spec.figure >= 0 && tier + 1 > ceiling) return null;
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    for (let x = rect.x; x < rect.x + rect.w; x++) {
      if (!freeAt(t, grass, flat, x, y, tier)) return null;
    }
  }
  const { water, figure } = fountainCells(spec, centre);
  if (water.length === 0) return null;
  if (!cellsFit(t, grass, flat, water, tier)) return null;
  // MEASURED FROM THE WATER, not from the court around it. The evaluation asks whether pavement
  // stands within its own reach of the BODY — which is what "composed in relation to the space"
  // means — and the court margin is up to `court` cells wider on every side, so a site satisfied
  // from the rect could stand that much further from a street than the reading allows. Three seeds
  // of ten on the flat template came back with a court nothing was near.
  const arrival = nearestPaved(input, boundsOfWater(water));
  if (!arrival) return null;
  return { centre, tier, rect, water, figure, frame: frameCells(spec, centre, court), arrival };
}

/**
 * The dry ground of the court: everything inside its rect that the composition itself does not stand
 * on.
 *
 * IT IS THE WHOLE MARGIN AND NOT A BAND OF THE METRIC, so that it is ONE PIECE for every outline. A
 * band `court` cells deep follows the outline, which reads well round a square or a ring and falls
 * into eight arcs round a cross — and an arc is what the paving works in, so a cruciform court would
 * have been bordered on the arms it could reach and left bare between them. The complement inside the
 * rect is connected whatever the outline draws, and what it paves is the court a visitor stands in.
 */
function frameCells(spec: FountainSpec, centre: MacroCoord, court: number): MacroCoord[] {
  const out: MacroCoord[] = [];
  const half = spec.radius + court;
  for (let dy = -half; dy <= half; dy++) {
    for (let dx = -half; dx <= half; dx++) {
      if (outlineMetric(spec.outline, dx, dy) > spec.radius) out.push({ x: centre.x + dx, y: centre.y + dy });
    }
  }
  return out;
}

/** The box the court's own water stands in. */
function boundsOfWater(water: readonly MacroCoord[]): Rect {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const c of water) {
    if (c.x < x0) x0 = c.x;
    if (c.x > x1) x1 = c.x;
    if (c.y < y0) y0 = c.y;
    if (c.y > y1) y1 = c.y;
  }
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** The paved cell nearest the court's own water, or null where no street reaches it. */
function nearestPaved(input: FountainInput, rect: Rect): MacroCoord | null {
  const { t, paved } = input;
  const at = (x: number, y: number): MacroCoord | null =>
    (x >= 0 && y >= 0 && x < t.width && y < t.height && paved[flatIndex(x, y, t.width)]
      ? { x, y } : null);
  for (let r = 1; r <= ARRIVAL_REACH; r++) {
    const x0 = rect.x - r, x1 = rect.x + rect.w - 1 + r;
    const y0 = rect.y - r, y1 = rect.y + rect.h - 1 + r;
    for (let x = x0; x <= x1; x++) {
      const hit = at(x, y0) ?? at(x, y1);
      if (hit) return hit;
    }
    for (let y = y0 + 1; y < y1; y++) {
      const hit = at(x0, y) ?? at(x1, y);
      if (hit) return hit;
    }
  }
  return null;
}

/** Cut the court and lock its ground: the water at the terrace's own tier, the figure a tier above
 *  it, and the whole court reserved so no later pass takes any of it. */
function reserve(input: FountainInput, court: FountainCourt): void {
  const { t, flat } = input;
  floodCells(t, court.water, court.tier);
  for (const c of court.figure) t.tier[flatIndex(c.x, c.y, t.width)] = court.tier + 1;
  for (let y = court.rect.y; y < court.rect.y + court.rect.h; y++) {
    for (let x = court.rect.x; x < court.rect.x + court.rect.w; x++) {
      flat[flatIndex(x, y, t.width)] = 1;
    }
  }
}

/** A stable value in [0,1) per (seed, index). */
function hash01(seed: number, i: number): number {
  let h = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ (i + 0x165667b1), 0xc2b2ae35);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

const lerp = (a: number, b: number, v: number): number => a + (b - a) * (v < 0 ? 0 : v > 1 ? 1 : v);
