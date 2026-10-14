/**
 * Places the regular artificial-water compositions `fountain-grammar.ts` draws, each with a reserved
 * dry court around it that the street pass may pave. Courts require one flat terrace, making water faces and mountain support
 * legal by construction. Large sites are tried before garden-scale sites; seeded shape and nesting
 * choices keep instances distinct. Pure planning only: inputs and masks in, cells out.
 */
import { flatIndex } from '../../../../core/grid/rect';
import type { MacroCoord } from '../../../../core/model/types';
import type { Rect } from '../../../../core/grid/rect';
import type { TerrainPlan } from '../../terrain-plan/types';
import type { DesignPlan, RegionPlan } from '../types';
import { cellsFit, floodCells, freeAt, boundsOfCells } from './water-cut';
import { seedHash01 } from '../../../../core/base/hash';
import { fountainCells, fountainSpec, outlineMetric, type FountainSpec } from './fountain-grammar';
import { lerpClamped } from '../../../../core/base/math';

// --- tunables -----------------------------------------------------------------------------------

/** The half-span of a court's water, large and small. A main court is 7 (a 14x14 platform inside a
 *  1-wide moat); a garden fountain is a third of that. */
const RADIUS = { small: { min: 2, max: 3 }, large: { min: 5, max: 7 } } as const;
/** How much open ground is kept around the water, large and small: the court itself. */
const COURT = { small: 1, large: 2 } as const;
/** How far a court looks for the pavement it is composed against. A fountain is related to the space
 *  around it, and an unreachable one is only an ornament. */
const ARRIVAL_REACH = 6;
/** How many courts one planet carries at richness 0 and 1, the large one included. At most three, so
 *  no two share a region: a fourth court is one more chance for two of them to land in one region as
 *  the finished map divides into places. */
const COUNT = { min: 1, max: 3 } as const;
/** How far from the plaza the large court may stand: it is the hub's own set piece. */
const HUB_REACH = 34;
/**
 * How far apart two courts stand. One clear main fountain per region, and a reader draws the region
 * boundary by eye, so two courts a few cells apart read as several in one place however the plan
 * divided the ground.
 *
 * A terraced planet reads as coarse regions, so two courts the plan put in two places can land in one.
 * The spacing is set from the size of a region as the finished map reads (a median of 49 to 79 cells)
 * rather than from the plan, and keeps courts per map at 1 to 3. It is a function of the place scale
 * and moves with the places.
 */
const COURT_SPACING = 72;

// --- what a court is ----------------------------------------------------------------------------

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
  /** The dry band immediately around the water, following the outline: the court's own border, which
   *  the pipeline paves where it can join the plaza's network. A frame the eye reads as a border is
   *  the difference between a fountain and a pool someone left in a field, so a set piece is framed in
   *  road on all four sides. */
  frame: MacroCoord[];
  /** The paved cell the court was composed against: a street end, the plaza's apron, a doorstep. */
  arrival: MacroCoord;
}

interface FountainInput {
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

// --- placing them -------------------------------------------------------------------------------

/**
 * How often a planet is offered a large court, at richness 0 and 1 — and it is rarer at the rich end,
 * which is the opposite of how the other knobs on this axis run.
 *
 * The reason is what else the planet has. A full-richness map carries a figure, a cascade and several
 * composed bodies, so a court can be absent and the walk still arrives somewhere — and absence is what
 * keeps a form the user meets on every planet from reading as a template. A quiet map is a flat garden
 * town whose court is the only thing on it built to be arrived at, so rolling it at the rich end's rate
 * leaves street ends arriving at nothing, a broken plan. The ground still has the last word: an
 * offer the planet cannot hold comes to nothing.
 */
const LARGE_COURT_CHANCE = { low: 0.9, high: 0.6 } as const;

/**
 * The planet's fountain courts, cut into the sculpt.
 *
 * One large court at most, standing near the plaza where it has a whole court to itself, and one
 * small one per remaining place that asked for water. The court's own ground is locked into the
 * reservation as it lands, so no later pass floods it and no bed is cut through it.
 */
export function carveFountains(input: FountainInput): FountainCourt[] {
  const { plan, richness } = input;
  const budget = Math.round(lerpClamped(COUNT.min, COUNT.max, richness));
  const out: FountainCourt[] = [];

  const hub = {
    x: Math.round(plan.hubArea.x + plan.hubArea.w / 2),
    y: Math.round(plan.hubArea.y + plan.hubArea.h / 2),
  };
  const wet = plan.regions.filter((r) => r.water === true && r.lot.length > 0);
  const rest = plan.regions.filter((r) => r.water !== true && r.lot.length > 0);
  const candidates = [...wet, ...rest]
    .sort((a, b) => Number(b.water === true) - Number(a.water === true)
      || distanceTo(hub, a) - distanceTo(hub, b) || (a.id < b.id ? -1 : 1));

  // A large court is an occasion, not furniture. Asked for on every planet — the plaza's ground first and
  // then every place in turn, biggest lot down — it lands on nineteen of twenty maps, and a form a visitor
  // meets on every map reads as a template whatever it is composed of. The seeded roll is what keeps a
  // couple of planets in five to their garden fountains alone: absence is part of the variety.
  const large = seedHash01(input.seed ^ 0x1a5e, 0) < lerpClamped(LARGE_COURT_CHANCE.low, LARGE_COURT_CHANCE.high, richness)
    ? hubCourt(input, hub, out.length)
      ?? [...candidates].sort((a, b) => lotArea(b) - lotArea(a) || (a.id < b.id ? -1 : 1))
        .reduce<FountainCourt | null>((found, region) => found ?? largeInRegion(input, region, 0), null)
    : null;
  if (large) { out.push(large); reserve(input, large); }

  // One main fountain per region, never several: the places that asked for water take a small court
  // each, nearest the hub first, so the ones a visitor meets are the ones that get built. Where none
  // of them could carry one — and where the plaza could not either — every other place is offered
  // it, because a planet with no fountain at all is ruled out.
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

/** The large court drawn at a place's own middle, for the planet whose hub could not carry one. */
function largeInRegion(input: FountainInput, region: RegionPlan, k: number): FountainCourt | null {
  const lot = region.lot[0]!;
  const at = { x: Math.round(lot.x + lot.w / 2), y: Math.round(lot.y + lot.h / 2) };
  const site = largeCourt(input, at, Math.max(lot.w, lot.h), k);
  return site ? { ...site, regionId: region.id, size: 'large' } : null;
}

/** The plaza's own court: the largest the ground near the hub carries, composed against the apron. */
function hubCourt(input: FountainInput, hub: MacroCoord, k: number): FountainCourt | null {
  const site = largeCourt(input, hub, HUB_REACH, k);
  return site ? { ...site, regionId: '', size: 'large' } : null;
}

/**
 * The largest court the ground within `reach` of `from` carries, with its spec. The seeded span is
 * walked down, offering the same composition at every smaller span and finally one below the
 * grammar's floor, which a full planet's reserved ground often needs; that span still meets
 * `COURT_MAIN_SPAN`. The court margin never gives way: a one-cell band between water and ground is
 * unpavable (a coating validates one column right and one row below), leaving a pond in a field.
 */
function largeCourt(
  input: FountainInput, from: MacroCoord, reach: number, k: number,
): (Site & { spec: FountainSpec }) | null {
  const { seed } = input;
  const span = RADIUS.large.min
    + Math.floor(seedHash01(seed ^ 0x7bb2, k) * (RADIUS.large.max - RADIUS.large.min + 1));
  for (let radius = span; radius >= RADIUS.large.min - 1; radius--) {
    const spec = fountainSpec(seed, k, radius);
    const site = search(input, from, reach, spec, COURT.large);
    if (site) return { ...site, spec };
  }
  return null;
}

/**
 * A garden fountain at a place's street corner, composed against the pavement that reaches it.
 *
 * Small fountains may stand in gardens and at street corners.
 * A court at the middle of a lot is a hole through the axis its kit mirrors about, and the symmetry
 * reading falls by the whole difference; at the entry side it stands where a visitor meets the place
 * and the composition behind it is left whole.
 */
function regionCourt(input: FountainInput, region: RegionPlan, k: number): FountainCourt | null {
  const { seed } = input;
  const lot = region.lot[0]!;
  const span = RADIUS.small.min
    + Math.floor(seedHash01(seed ^ 0x7bb2, k + 97) * (RADIUS.small.max - RADIUS.small.min + 1));
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
      if (!freeAt({ t, grass, flat }, x, y, tier)) return null;
    }
  }
  const { water, figure } = fountainCells(spec, centre);
  if (water.length === 0) return null;
  if (!cellsFit(t, grass, flat, water, tier)) return null;
  // Measured from the water, not from the court around it. A court arrives when pavement stands
  // within its own reach of the body — which is what "composed in relation to the space"
  // means — and the court margin is up to `court` cells wider on every side, so a site satisfied
  // from the rect could stand that much further from a street than the reading allows. Three seeds
  // of ten on the flat template came back with a court nothing was near.
  const arrival = nearestPaved(input, boundsOfCells(water));
  if (!arrival) return null;
  return { centre, tier, rect, water, figure, frame: frameCells(spec, centre, court), arrival };
}

/**
 * The dry ground of the court: everything inside its rect that the composition itself does not stand
 * on.
 *
 * It is the whole margin and not a band of the metric, so that it is one piece for every outline. A
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


