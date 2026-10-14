/**
 * Plans a primary walk from the plaza market to a high-ground lookout before terrain is shaped.
 * Seeded intermediate roles guide street width, terrace crossings, nearby water, district themes,
 * and set-piece scale. The result is pure and deterministic for its seed, template, composition,
 * and richness.
 */
import { flatIndex } from '../../../../core/grid/rect';
import { makeRng, type Rng, mix, hash01, weightedIndex } from '../../../../core/base/rng';
import { clamp01, lerpClamped } from '../../../../core/base/math';
import type { MacroCoord } from '../../../../core/model/types';
import type { Rect } from '../../../../core/grid/rect';
import { cellTiers, landMask, levelWindows, hubRect } from '../planet';
import { MASSIF_PEAK_FROM, type CompositionPlan } from './composition';
import { plateAdjacency, type Plate } from './plates';

import type { DesignInput, SeedInfo } from '../types';
import { familyOf, stopThemes, type StopRole, type ThemeFamily, type ThemeId } from '../themes';

// --- what a movement line is ---------------------------------------------------------------------

/** One stop: a district the walk passes through, with the theme it is met as. */
export interface MovementStop {
  /** Position along the walk, 0 at the plaza. */
  index: number;
  at: MacroCoord;
  tier: number;
  plate: number;
  role: StopRole;
  themeId: ThemeId;
  family: ThemeFamily;
  /** A stop drawn at district scale rather than at place scale: the big blocks the walk's rhythm
   *  wants beside the small ones. */
  setPiece: boolean;
}

/** One straight stretch of the line, in the same vocabulary a street is written in: `axis` is the
 *  direction it runs along, `line` the fixed coordinate across it. */
interface MovementSegment {
  axis: 'x' | 'y';
  line: number;
  from: number;
  to: number;
}

/** Water the line asks for, in relation to the walk. The sculptor honours what the ground allows. */
export interface WaterWant {
  /** `lake` is the body a waterside stop's walk skirts; `cascade` the fall beside a climb. */
  kind: 'lake' | 'cascade';
  rect: Rect;
  tier: number;
  /** The stop this water belongs to. */
  stop: number;
}

export interface MovementLine {
  seedInfo: SeedInfo;
  segments: MovementSegment[];
  stops: MovementStop[];
  /** Every cell the centreline passes through, in walk order: the trace a diagnostic sheet draws. */
  trace: MacroCoord[];
  waterWants: WaterWant[];
  /** Where the walk ends: the look-out the banner faces. */
  terminus: MacroCoord;
}

// --- tunables ------------------------------------------------------------------------------------

/** How many stops a walk holds, at richness 0 and 1. Under three there is no sequence to read; past
 *  six the line crosses the planet more than once and stops reading as one walk. */
const STOP_COUNT = { low: 3, high: 6 } as const;
/** The tallest step the walk prefers to take between two stops, in tiers. A flight uses one catalog ramp length
 *  per tier, so a taller step is one the ground below it usually has no room for, and a
 *  leg the flights cannot carry is a leg the settling prunes. */
const CLIMB_STEP_MAX = 2;
/** Stops the walk may spend beyond its count to reach the mass. A walk that has not arrived by then
 *  is on a planet whose high ground is most of the map away from the plaza, and going on turns one
 *  walk into a tour. Four rather than two since the mass is cut into terraces: the summit of a
 *  terraced planet stands several steps up, and each step is a plate the walk has to cross. */
const STOP_SLACK = 4;
/** How wide the line's own street is. An approach to the plaza reads 4 to 6 cells against a 3-wide
 *  trunk, so the primary walk is the widest pavement on the map. */
export const LINE_W = 4;
/** How far off the line a lake is set, and how big it is asked to be. The walk skirts the water: a
 *  body on the line would be a channel the street cannot cross without a deck. */
const LAKE_OFFSET = 4;
const LAKE_SIZE = { w: 15, h: 9 } as const;
/** How far off the line a cascade band is set, so the falls stand beside the climb rather than under
 *  the flight's own corridor. */
const CASCADE_OFFSET = 5;
const CASCADE_LONG = 14;
const CASCADE_DEEP = 3;

/**
 * The roles a stop may take, and what each one is worth along the walk.
 *
 * `near` and `far` are the weights at the plaza end and at the far end; `high` is what standing on
 * raised ground adds. So the market crowds the plaza, the gardens hold the middle, the waterside and
 * the climb belong to the outer half, and the look-out is worth most at the top of the composition.
 * Every role keeps a nonzero weight everywhere: a weight of zero is a stop no seed can ever draw.
 */
const STOP_ROLES: ReadonlyArray<{
  role: StopRole;
  /** The themes a stop of this role is met as (`themes.ts:stopThemes`). */
  themes: readonly ThemeId[];
  near: number; far: number; high: number;
}> = ([
  { role: 'market', near: 3.0, far: 0.2, high: 0.1 },
  { role: 'garden', near: 1.4, far: 1.0, high: 0.4 },
  { role: 'waterside', near: 0.4, far: 1.5, high: 0.4 },
  { role: 'climb', near: 0.1, far: 1.0, high: 2.2 },
  { role: 'lookout', near: 0.05, far: 1.4, high: 1.8 },
] as const).map((r) => ({ ...r, themes: stopThemes(r.role) }));

// --- entry point ---------------------------------------------------------------------------------

/** The walk one map is built around: where it goes, what is met along it, and what water it asks
 *  for. A planet with no plate to walk to comes back with an empty line, and every stage that reads
 *  one carries on exactly as it did before there was one. */
export function planMovementLine(
  { seed, template, composition, richness }: DesignInput & { composition: CompositionPlan },
): MovementLine {
  const r = clamp01(richness);
  const rng = makeRng(mix(seed, 0x6d0e5f11));
  const W = template.width, H = template.height;
  const seedInfo: SeedInfo = { seed, richness: r, templateId: template.id };
  const empty: MovementLine = {
    seedInfo, segments: [], stops: [], trace: [], waterWants: [], terminus: { x: 0, y: 0 },
  };
  if (composition.plates.length === 0) return empty;

  const tiers = cellTiers(template, composition);
  const land = landMask(template);
  const level = levelWindows(template, tiers);
  const hubArea = hubRect(template);

  // Where the walk can stand is decided before where it goes: a plate offering no cell a street
  // could be laid on is a plate no stop may be put on, and the destination is a stop like any other.
  // Reading it afterwards instead dropped the mass out of the walk silently — the chain ended at the
  // summit and the stop list ended one plate short of it.
  const anchorOf = plateAnchors(composition, level, W);
  const chain = walkPlates(composition, rng, r, { W, H }, anchorOf);
  const anchors = chain.filter((plate) => anchorOf.has(plate))
    .map((plate) => ({ plate, at: anchorOf.get(plate)! }));
  if (anchors.length === 0) return empty;

  // The walk leaves the plaza, not the plaza's middle: the first leg starts on the ring, which is
  // where a trunk can actually be laid.
  const start = hubGate(hubArea, anchors[0]!.at);
  const waypoints = [start, ...anchors.map((a) => a.at)];
  const segments = legs(waypoints, level, W, seed);
  if (segments.length === 0) return empty;

  const stops = assignRoles(anchors, tiers, composition, W, rng);
  const trace = traceOf(segments);
  return {
    seedInfo, segments, stops, trace,
    waterWants: wantWater(stops, segments, { tiers, land, W, H }),
    // The last stop, not the last cell of the trace: a stretch is traced from its low coordinate to
    // its high one whichever way the walk runs along it, so a final leg heading west or north ends
    // the trace at the far end of itself.
    terminus: anchors[anchors.length - 1]!.at,
  };
}

// --- the plate chain -----------------------------------------------------------------------------

/**
 * The plates the walk visits, from the plaza's outward. The destination is the tallest plate that is
 * anchored (offers a cell a street can be laid on) and connected to the plaza's over the plate graph,
 * since a summit across a channel is one no walk ends at.
 *
 * The route grows one plate at a time rather than as a shortest path, which would be the same walk
 * on every map of a planet: progress is preferred, a seeded tilt breaks ties, and a walk short of its
 * stop count takes a lateral neighbour. The wander backtracks, since a greedy walk with a seen-set
 * strands in a pocket and leaves the summit unvisited.
 */
function walkPlates(
  composition: CompositionPlan, rng: Rng, richness: number, size: { W: number; H: number },
  anchorOf: ReadonlyMap<number, MacroCoord>,
): number[] {
  const { W, H } = size;
  const { plates, hubPlateId } = composition;
  const want = Math.round(lerpClamped(STOP_COUNT.low, STOP_COUNT.high, richness));
  const neighbours = neighbourMap(composition, W, H);
  const start = hubPlateId >= 0 && hubPlateId < plates.length ? hubPlateId : 0;
  const fromStart = graphDistance(neighbours, plates.length, start);
  // A massif is worth crossing the planet for and a mound is not, and that is the only thing the two
  // cases differ in. It is the composition's own test (below `MASSIF_PEAK_FROM` there is no skirt and
  // no crown), so a map without one spends no more than its stop count getting anywhere: a forced
  // tour across a flat planet costs it street ends. Either way the walk ends on the highest ground it
  // can stand on, because a mound the walk could have finished on and wandered past is the same fiat
  // at a smaller scale.
  const massif = composition.peakTier >= MASSIF_PEAK_FROM;
  const cap = massif ? want + STOP_SLACK : want;
  // The destination is the highest ground the walk can reach and stand on, which is not always the
  // tallest plate: a summit across a channel is a summit no walk ends at, and one offering no cell a
  // street could be laid on is a summit with nowhere to stand. Without a massif it also has to be
  // Raised and in range, since the budget is the walk's own length there.
  let goal = -1;
  for (const p of plates) {
    if (p.id === start || !anchorOf.has(p.id) || fromStart[p.id] === Infinity) continue;
    if (!massif && (p.tier <= 0 || (fromStart[p.id] ?? Infinity) > cap)) continue;
    const best = goal >= 0 ? plates[goal]! : null;
    // The bigger plate breaks a tie on tier: two terraces at one height are one summit, and the walk
    // ends on the half of it there is room to stand on.
    if (!best || p.tier > best.tier
      || (p.tier === best.tier && p.cells.length > best.cells.length)) goal = p.id;
  }
  // Nothing to arrive at: a map with no raised plate in range, which is the flat garden town at the
  // quiet end of the axis. The walk is the greedy wander it always was there, leaning away from the
  // plaza toward the plate the archetype read highest — ties to the lowest id, since on a flat planet
  // many plates read alike.
  if (goal < 0) {
    if (massif) return [];
    const highest = plates.reduce((best, p) => (p.tier > plates[best]!.tier ? p.id : best), 0);
    return wander({ plates, neighbours, toGoal: graphDistance(neighbours, plates.length, highest) }, rng, want, start);
  }
  const toGoal = graphDistance(neighbours, plates.length, goal);
  // The walk ends at the mass, and the stop count is what it may spend getting there rather than a
  // reason to stop short. Breaking at the count put the look-out on whatever plate the walk happened
  // to reach — low ground called a look-out by fiat — which is the near-low-far-high rule inverted.
  const route = routeTo({ plates, neighbours, toGoal }, { rng, want, cap, start, goal });
  // A route that arrives exists, since the goal was chosen among the plates the plaza can reach; what
  // may not exist is one the stop budget affords, or one the search found inside its own budget. Then
  // the walk is the shortest way to the mass — longer than the map would have liked, and still a walk
  // that ends where the composition put its height.
  return route.length ? route : shortestRoute(neighbours, toGoal, start, goal);
}

/** The plate graph a walk moves over, with each plate's hop distance to where it is going. */
interface PlateGraph { plates: readonly Plate[]; neighbours: ReadonlyMap<number, number[]>; toGoal: readonly number[] }

/** The planet's ground as the water wants read it: each cell's tier, whether it is land, and the map size. */
interface Ground { tiers: Int8Array; land: Uint8Array; W: number; H: number }

/** The walk on a planet with nothing raised inside its own budget: the greedy wander, bounded by its
 *  stop count, which is what every walk was before there was a summit to arrive at. */
function wander(graph: PlateGraph, rng: Rng, want: number, start: number): number[] {
  const { plates, neighbours } = graph;
  const chain: number[] = [];
  const seen = new Set<number>([start]);
  let current = start;
  for (let guard = 0; guard < plates.length && chain.length < want; guard++) {
    const options = (neighbours.get(current) ?? []).filter((id) => !seen.has(id));
    if (options.length === 0) break;
    // One draw, since there is nothing to backtrack into: the wander takes the step it takes.
    const { first } = preferred(graph, current, options, { want, spent: chain.length });
    const pick = first[rng.int(first.length)]!;
    chain.push(pick);
    seen.add(pick);
    current = pick;
  }
  return chain;
}

/** How much work a route search may spend before the shortest path is taken instead. A plate graph
 *  holds at most `PLATE_TOTAL_MAX` nodes and the depth bound prunes hard, so this is reached only on
 *  a graph shaped to defeat the bound rather than on any planet measured here. */
const ROUTE_BUDGET = 4000;

/**
 * The route the walk takes to the mass: the preferred step first, and the next one where that step
 * leads nowhere.
 *
 * Depth-first with the preference order as its branch order, so the walk a map gets is the greedy pick's
 * wherever the greedy pick arrives, and differs only where the greedy pick strands. Pruned by the hop
 * budget — a step from which the goal stands further away than the budget's remainder is not a step this
 * walk can take — which is what keeps the search small.
 */
function routeTo(
  graph: PlateGraph, { rng, want, cap, start, goal }: { rng: Rng; want: number; cap: number; start: number; goal: number },
): number[] {
  const { neighbours } = graph;
  const chain: number[] = [];
  const seen = new Set<number>([start]);
  let spent = 0;
  const step = (at: number): boolean => {
    if (at === goal) return true;
    if (chain.length >= cap || ++spent > ROUTE_BUDGET) return false;
    const options = (neighbours.get(at) ?? []).filter((id) => !seen.has(id));
    const { first, rest } = preferred(graph, at, options, { want, spent: chain.length });
    for (const next of concat(draw(first, rng), rest)) {
      chain.push(next);
      seen.add(next);
      if (step(next)) return true;
      chain.pop();
      seen.delete(next);
    }
    return false;
  };
  return step(start) ? chain : [];
}

/** The fewest hops to the mass, taken when the budget affords no other route. Ties go to the lower
 *  plate id, so the fallback is one walk rather than whichever the graph happened to enumerate. */
function shortestRoute(
  neighbours: ReadonlyMap<number, number[]>, toGoal: readonly number[], start: number, goal: number,
): number[] {
  const chain: number[] = [];
  let at = start;
  while (at !== goal && chain.length < toGoal.length) {
    const here = toGoal[at] ?? Infinity;
    let next = -1;
    for (const id of neighbours.get(at) ?? []) {
      if ((toGoal[id] ?? Infinity) < here && (next < 0 || id < next)) next = id;
    }
    if (next < 0) break;
    chain.push(next);
    at = next;
  }
  return chain;
}

/**
 * The order a step's options are tried in. Progress toward the mass, unless the walk still owes
 * stops and has hops to spare, when a lateral step buys one. Within that, a step the walk can climb
 * comes first (a gentle step, then a rising one, since each tier's flight is one catalog ramp length
 * and a steep step can exhaust the terrace below), and a step that stays level or rises beats one
 * that drops, so the route climbs rather than meeting the whole mass at the end.
 *
 * `first` is the seeded group the walk chooses inside; `rest` is what the route search falls back
 * through when nothing beyond `first` arrives. A wander with nothing to backtrack into draws once
 * from `first`.
 */
function preferred(
  graph: Pick<PlateGraph, 'plates' | 'toGoal'>, at: number, options: readonly number[], budget: { want: number; spent: number },
): { first: number[]; rest: number[] } {
  const { plates, toGoal } = graph;
  const { want, spent } = budget;
  if (options.length <= 1) return { first: [...options], rest: [] };
  const here = toGoal[at] ?? Infinity;
  const owed = want - spent;
  const nearer = options.filter((id) => (toGoal[id] ?? Infinity) < here);
  const lateral = options.filter((id) => (toGoal[id] ?? Infinity) >= here);
  const pool = owed > (here === Infinity ? 0 : here) && lateral.length ? lateral
    : nearer.length ? nearer : options;
  const level = plates[at]?.tier ?? 0;
  const climbable = pool.filter((id) => Math.abs((plates[id]?.tier ?? 0) - level) <= CLIMB_STEP_MAX);
  const rising = (climbable.length ? climbable : pool).filter((id) => (plates[id]?.tier ?? 0) >= level);
  const first = [...(rising.length ? rising : climbable.length ? climbable : pool)];
  return { first, rest: options.filter((id) => !first.includes(id)).sort((a, b) => a - b) };
}

/**
 * The options of one preference group in the order the walk draws them, drawn lazily.
 *
 * One draw off the stream per option actually taken, so a step the search never has to reconsider costs
 * exactly the one draw the walk itself would have spent on it. That is what keeps a map whose first
 * choice arrives on the route the greedy pick gives: the backtracking changes the walk only where the
 * greedy pick would strand.
 */
function* draw(ids: readonly number[], rng: Rng): Generator<number> {
  const pool = [...ids];
  while (pool.length) yield pool.splice(rng.int(pool.length), 1)[0]!;
}

/** The drawn group, then the fallbacks, without spending a draw on a fallback nobody reaches. */
function* concat(drawn: Generator<number>, rest: readonly number[]): Generator<number> {
  yield* drawn;
  yield* rest;
}

function neighbourMap(composition: CompositionPlan, W: number, H: number): Map<number, number[]> {
  const out = new Map<number, number[]>();
  const push = (a: number, b: number): void => {
    const list = out.get(a);
    if (list) list.push(b);
    else out.set(a, [b]);
  };
  for (const [a, b] of plateAdjacency(composition.plates, composition.plateOf, W, H)) {
    push(a, b);
    push(b, a);
  }
  for (const list of out.values()) list.sort((x, y) => x - y);
  return out;
}

/** Hops from every plate to `goal` over the plate graph. */
function graphDistance(neighbours: ReadonlyMap<number, number[]>, count: number, goal: number): number[] {
  const out = new Array<number>(count).fill(Infinity);
  if (goal < 0 || goal >= count) return out;
  out[goal] = 0;
  const queue = [goal];
  for (let head = 0; head < queue.length; head++) {
    const at = queue[head]!;
    for (const next of neighbours.get(at) ?? []) {
      if (out[next] !== Infinity) continue;
      out[next] = out[at]! + 1;
      queue.push(next);
    }
  }
  return out;
}

/** Where the walk meets each plate: the cell nearest the plate's own middle that a street could stand
 *  on (its dual-grid window level and on the planet). A plate offering none is absent from the map,
 *  which is what keeps it out of both the destination and the stop list. */
function plateAnchors(composition: CompositionPlan, level: Uint8Array, W: number): Map<number, MacroCoord> {
  const out = new Map<number, MacroCoord>();
  for (const p of composition.plates) {
    const cx = p.rect.x + p.rect.w / 2, cy = p.rect.y + p.rect.h / 2;
    let best: MacroCoord | null = null, bestD = Infinity;
    for (const i of p.cells) {
      const x = i % W, y = (i / W) | 0;
      if (!level[i]) continue;
      const d = Math.abs(x - cx) + Math.abs(y - cy);
      if (d < bestD) { bestD = d; best = { x, y }; }
    }
    if (best) out.set(p.id, best);
  }
  return out;
}

/** The point on the plaza's ring the walk sets off from: the middle of whichever side faces the
 *  first stop. */
function hubGate(hubArea: Rect, toward: MacroCoord): MacroCoord {
  const cx = hubArea.x + hubArea.w / 2, cy = hubArea.y + hubArea.h / 2;
  const dx = toward.x - cx, dy = toward.y - cy;
  if (Math.abs(dx) >= Math.abs(dy)) {
    return { x: Math.round(dx >= 0 ? hubArea.x + hubArea.w : hubArea.x - 1), y: Math.round(cy) };
  }
  return { x: Math.round(cx), y: Math.round(dy >= 0 ? hubArea.y + hubArea.h : hubArea.y - 1) };
}

// --- the polyline --------------------------------------------------------------------------------

/**
 * The waypoints joined into axis-aligned stretches: each leg is an L, and the elbow is put on
 * whichever of the two ways round runs over more ground a street can be laid on.
 *
 * An L rather than a diagonal because a street here is a line at one coordinate — that is what makes
 * a block's frontage straight — and a walk that turns at its stops reads as a route through places
 * rather than as a ruled line across the planet.
 */
function legs(
  waypoints: readonly MacroCoord[], level: Uint8Array, W: number, seed: number,
): MovementSegment[] {
  const out: MovementSegment[] = [];
  for (let k = 0; k + 1 < waypoints.length; k++) {
    const a = waypoints[k]!, b = waypoints[k + 1]!;
    const viaX: MovementSegment[] = [
      { axis: 'x', line: a.y, from: Math.min(a.x, b.x), to: Math.max(a.x, b.x) },
      { axis: 'y', line: b.x, from: Math.min(a.y, b.y), to: Math.max(a.y, b.y) },
    ];
    const viaY: MovementSegment[] = [
      { axis: 'y', line: a.x, from: Math.min(a.y, b.y), to: Math.max(a.y, b.y) },
      { axis: 'x', line: b.y, from: Math.min(a.x, b.x), to: Math.max(a.x, b.x) },
    ];
    const scoreX = legScore(viaX, level, W);
    const scoreY = legScore(viaY, level, W);
    const pick = scoreX > scoreY || (scoreX === scoreY && hash01(seed ^ 0x1e6, k) < 0.5) ? viaX : viaY;
    for (const seg of pick) if (seg.to > seg.from) out.push(seg);
  }
  return merge(out);
}

/** How much of a leg stands on ground a street could be laid on. */
function legScore(segments: readonly MovementSegment[], level: Uint8Array, W: number): number {
  let n = 0;
  for (const seg of segments) {
    for (let t = seg.from; t <= seg.to; t++) {
      const x = seg.axis === 'y' ? seg.line : t;
      const y = seg.axis === 'y' ? t : seg.line;
      if (x >= 0 && y >= 0 && x < W && level[flatIndex(x, y, W)]) n++;
    }
  }
  return n;
}

/** Consecutive stretches on one line folded into one, so the trunk the streets lay is as long and as
 *  unbroken as the ground allows. */
function merge(segments: readonly MovementSegment[]): MovementSegment[] {
  const out: MovementSegment[] = [];
  for (const seg of segments) {
    const last = out[out.length - 1];
    if (last && last.axis === seg.axis && last.line === seg.line
      && seg.from <= last.to + 1 && seg.to >= last.from - 1) {
      last.from = Math.min(last.from, seg.from);
      last.to = Math.max(last.to, seg.to);
      continue;
    }
    out.push({ ...seg });
  }
  return out;
}

/** Every cell the centreline covers, in walk order. */
function traceOf(segments: readonly MovementSegment[]): MacroCoord[] {
  const out: MacroCoord[] = [];
  for (const seg of segments) {
    for (let t = seg.from; t <= seg.to; t++) {
      out.push(seg.axis === 'y' ? { x: seg.line, y: t } : { x: t, y: seg.line });
    }
  }
  return out;
}

// --- the sequence --------------------------------------------------------------------------------

/** The role and theme each stop is met as: a weighted draw over the library, conditioned on how far
 *  along the walk the stop stands and how high its ground is. The ends are fixed — the walk leaves
 *  the plaza through a market and finishes at a look-out. */
function assignRoles(
  anchors: readonly { plate: number; at: MacroCoord }[], tiers: Int8Array,
  composition: CompositionPlan, W: number, rng: Rng,
): MovementStop[] {
  const peak = Math.max(1, composition.plates.reduce((m, p) => Math.max(m, p.tier), 0));
  const last = anchors.length - 1;
  return anchors.map((anchor, index) => {
    const tier = tiers[flatIndex(anchor.at.x, anchor.at.y, W)] ?? 0;
    const t = last > 0 ? index / last : 1;
    const high = tier / peak;
    // The two ends are the walk's own: it leaves the plaza through a market and finishes at a
    // look-out. A look-out drawn halfway along is a view the walk turns its back on, so the role is
    // the terminus's alone and the draw between the ends picks from the rest.
    const forced = index === last ? 'lookout' : index === 0 && last > 0 ? 'market' : null;
    const entry = forced
      ? STOP_ROLES.find((s) => s.role === forced)!
      : drawRole(rng, t, high);
    const theme = rng.pick(entry.themes);
    return {
      index, at: anchor.at, tier, plate: anchor.plate,
      role: entry.role, themeId: theme, family: familyOf(theme),
      // Every other stop is drawn big, so the walk alternates a set piece with a quieter block
      // rather than running past the same block size all the way out.
      setPiece: index % 2 === 0,
    };
  });
}

function drawRole(rng: Rng, t: number, high: number): (typeof STOP_ROLES)[number] {
  const pool = STOP_ROLES.filter((s) => s.role !== 'lookout');
  return pool[weightedIndex(rng, pool.map((s) => Math.max(0.01, lerpClamped(s.near, s.far, t) + s.high * high)))]!;
}

// --- the water the walk asks for -----------------------------------------------------------------

/**
 * Where the walk wants water: a lake beside every waterside stop, and a cascade beside every stretch
 * that climbs a tier.
 *
 * Both are asked for beside the line rather than on it. A body on the line is a channel the street
 * cannot cross without a deck, and the one place the walk does step over water is chosen later by
 * `streets.ts`, on the pavement it actually laid.
 */
function wantWater(stops: readonly MovementStop[], segments: readonly MovementSegment[], ground: Ground): WaterWant[] {
  const out: WaterWant[] = [];
  for (const stop of stops) {
    const seg = nearestSegment(segments, stop.at);
    if (!seg) continue;
    if (stop.role === 'waterside') {
      const rect = besideLine(seg, stop.at, LAKE_OFFSET, LAKE_SIZE.w, LAKE_SIZE.h);
      if (fitsOnLand(rect, ground, stop.tier)) {
        out.push({ kind: 'lake', rect, tier: stop.tier, stop: stop.index });
      }
    }
    if (stop.role === 'climb' || (stop.index > 0 && stop.tier > (stops[stop.index - 1]?.tier ?? 0))) {
      const rect = besideLine(seg, stop.at, CASCADE_OFFSET, CASCADE_LONG, CASCADE_DEEP);
      out.push({ kind: 'cascade', rect, tier: stop.tier, stop: stop.index });
    }
  }
  return out;
}

/** The stretch of the line nearest a stop: the one the water is set beside. */
function nearestSegment(segments: readonly MovementSegment[], at: MacroCoord): MovementSegment | null {
  let best: MovementSegment | null = null, bestD = Infinity;
  for (const seg of segments) {
    const along = seg.axis === 'y' ? at.y : at.x;
    const clamped = Math.max(seg.from, Math.min(seg.to, along));
    const across = seg.axis === 'y' ? at.x : at.y;
    const d = Math.abs(across - seg.line) + Math.abs(along - clamped);
    if (d < bestD) { bestD = d; best = seg; }
  }
  return best;
}

/** A rect set `offset` cells to one side of the line at the stop, `long` along it and `deep` across.
 *  The side is the one the stop's own coordinate leans to, so two stops on one stretch do not stack
 *  their water on top of each other. */
function besideLine(
  seg: MovementSegment, at: MacroCoord, offset: number, long: number, deep: number,
): Rect {
  const along = seg.axis === 'y' ? at.y : at.x;
  const across = seg.axis === 'y' ? at.x : at.y;
  const side = across >= seg.line ? 1 : -1;
  const lo = Math.round(along - long / 2);
  const start = seg.line + side * offset - (side < 0 ? deep : 0);
  return seg.axis === 'y'
    ? { x: start, y: lo, w: deep, h: long }
    : { x: lo, y: start, w: long, h: deep };
}

/** Whether a wanted body stands wholly on planet ground at one tier. A want that does not is dropped
 *  here rather than handed to the sculptor to refuse. */
function fitsOnLand(rect: Rect, ground: Ground, tier: number): boolean {
  const { tiers, land, W, H } = ground;
  if (rect.w < 2 || rect.h < 2) return false;
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    for (let x = rect.x; x < rect.x + rect.w; x++) {
      if (x < 1 || y < 1 || x >= W - 1 || y >= H - 1) return false;
      const i = flatIndex(x, y, W);
      if (!land[i] || tiers[i] !== tier) return false;
    }
  }
  return true;
}

// --- arithmetic ----------------------------------------------------------------------------------

