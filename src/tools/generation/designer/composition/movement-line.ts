/**
 * Plans a primary walk from the plaza market to a high-ground lookout before terrain is shaped.
 * Seeded intermediate roles guide street width, terrace crossings, nearby water, district themes,
 * and set-piece scale. The result is pure and deterministic for its seed, template, composition,
 * and richness.
 */
import { flatIndex } from '../../../../core/model/grid-model';
import { makeRng, type Rng } from '../../../../core/model/rng';
import { CellZone, type MacroCoord, type MapTemplate, type Rect } from '../../../../core/model/types';
import { plazaRect, cellTiers, MASSIF_PEAK_FROM, plateAdjacency, type CompositionPlan, type Plate } from './composition';

import type { SeedInfo, ThemeFamily, ThemeId } from '../types';

// --- what a movement line is ---------------------------------------------------------------------

/** What a stop IS on the walk. The roles are the narrative, and each one names a slice of the theme
 *  library rather than a template. */
export type StopRole = 'market' | 'garden' | 'waterside' | 'climb' | 'lookout';

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
 *  direction it RUNS along, `line` the fixed coordinate across it. */
export interface MovementSegment {
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
 *  six the line crosses the island more than once and stops reading as one walk. */
const STOP_COUNT = { low: 3, high: 6 } as const;
/** The tallest step the walk prefers to take between two stops, in tiers. A flight is `RAMP_RUN`
 *  cells of run per tier, so a taller step is one the ground below it usually has no room for, and a
 *  leg the flights cannot carry is a leg the settling prunes. */
const CLIMB_STEP_MAX = 2;
/** Stops the walk may spend BEYOND its count to reach the mass. A walk that has not arrived by then
 *  is on an island whose high ground is most of the map away from the plaza, and going on turns one
 *  walk into a tour. Four rather than two since the mass is cut into TERRACES: the summit of a
 *  terraced island stands several steps up, and each step is a plate the walk has to cross. */
const STOP_SLACK = 4;
/** How wide the line's own street is. The style target's approaches read 4 to 6 cells against a 3-wide
 *  trunk, so the primary walk is the widest pavement on the map. */
export const LINE_W = 4;
/** How far off the line a lake is set, and how big it is asked to be. The walk skirts the water: a
 *  body ON the line would be a channel the street cannot cross without a deck. */
const LAKE_OFFSET = 4;
const LAKE_SIZE = { w: 15, h: 9 } as const;
/** How far off the line a cascade band is set, so the falls stand BESIDE the climb rather than under
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
  /** Each theme carries its own family, because the kit library dispatches on the pair: a theme
   *  handed to the wrong family's kit is a style nothing answers with. */
  themes: readonly { id: ThemeId; family: ThemeFamily }[];
  near: number; far: number; high: number;
}> = [
  {
    role: 'market',
    themes: [
      { id: 'cafe', family: 'food-leisure' }, { id: 'teahouse', family: 'food-leisure' },
      { id: 'banquet', family: 'food-leisure' }, { id: 'picnic', family: 'food-leisure' },
      { id: 'stage', family: 'culture' },
    ],
    near: 3.0, far: 0.2, high: 0.1,
  },
  {
    role: 'garden',
    themes: [
      { id: 'garden', family: 'nature' }, { id: 'flower-field', family: 'nature' },
      { id: 'park', family: 'nature' }, { id: 'tree-avenue', family: 'nature' },
      { id: 'bamboo-court', family: 'nature' },
    ],
    near: 1.4, far: 1.0, high: 0.4,
  },
  {
    role: 'waterside',
    themes: [
      { id: 'waterside-deck', family: 'viewpoint' }, { id: 'lake-fountain', family: 'nature' },
      { id: 'seaside-dining', family: 'food-leisure' },
    ],
    near: 0.4, far: 1.5, high: 0.4,
  },
  {
    role: 'climb',
    themes: [{ id: 'mountain-water', family: 'nature' }, { id: 'canyon', family: 'nature' }],
    near: 0.1, far: 1.0, high: 2.2,
  },
  {
    role: 'lookout',
    themes: [{ id: 'lookout', family: 'viewpoint' }, { id: 'panorama-deck', family: 'viewpoint' }],
    near: 0.05, far: 1.4, high: 1.8,
  },
];

// --- entry point ---------------------------------------------------------------------------------

/** The walk one map is built around: where it goes, what is met along it, and what water it asks
 *  for. An island with no plate to walk to comes back with an empty line, and every stage that reads
 *  one carries on exactly as it did before there was one. */
export function planMovementLine(
  seed: number, template: MapTemplate, composition: CompositionPlan,
  richness = composition.seedInfo.richness,
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
  const plaza = plazaRect(template);

  // WHERE THE WALK CAN STAND is decided before where it goes: a plate offering no cell a street
  // could be laid on is a plate no stop may be put on, and the DESTINATION is a stop like any other.
  // Reading it afterwards instead dropped the mass out of the walk silently — the chain ended at the
  // summit and the stop list ended one plate short of it.
  const anchorOf = plateAnchors(composition, tiers, land, W, H);
  const chain = walkPlates(composition, rng, r, W, H, anchorOf);
  const anchors = chain.filter((plate) => anchorOf.has(plate))
    .map((plate) => ({ plate, at: anchorOf.get(plate)! }));
  if (anchors.length === 0) return empty;

  // The walk leaves the plaza, not the plaza's middle: the first leg starts on the ring, which is
  // where a trunk can actually be laid.
  const start = plazaGate(plaza, anchors[0]!.at);
  const waypoints = [start, ...anchors.map((a) => a.at)];
  const segments = legs(waypoints, tiers, land, W, H, seed);
  if (segments.length === 0) return empty;

  const stops = assignRoles(anchors, tiers, composition, W, rng);
  const trace = traceOf(segments);
  return {
    seedInfo, segments, stops, trace,
    waterWants: wantWater(stops, segments, tiers, land, W, H),
    // THE LAST STOP, not the last cell of the trace: a stretch is traced from its low coordinate to
    // its high one whichever way the walk runs along it, so a final leg heading west or north ends
    // the trace at the far end of itself.
    terminus: anchors[anchors.length - 1]!.at,
  };
}

// --- the plate chain -----------------------------------------------------------------------------

/**
 * The plates the walk visits, from the plaza's own outward.
 *
 * The destination is the highest ground the walk can actually REACH AND STAND ON: the tallest plate
 * that is anchored (it offers a cell a street could be laid on) and connected to the plaza's own over
 * the plate graph. Not simply the tallest plate — a summit across a channel is a summit no walk ends
 * at, and calling the plate it stranded on a look-out is the fiat this whole step exists to avoid.
 *
 * The route to it is grown one plate at a time rather than taken as a shortest path, because a
 * shortest path is the same walk on every map with the same island: at each step the neighbour that
 * makes progress is preferred, a seeded tilt breaks the ties, and where the walk is still short of
 * its stop count a lateral neighbour is taken instead, which is the wander that gives two seeds two
 * different stories on one island. THE WANDER BACKTRACKS. A greedy walk with a seen-set strands in a
 * pocket of the plate graph and the loop then breaks with the summit unvisited: measured, 3 of 20
 * seeds ended on tier 1, 2 and 6 of an island built to 8, all three labelled a look-out.
 */
function walkPlates(
  composition: CompositionPlan, rng: Rng, richness: number, W: number, H: number,
  anchorOf: ReadonlyMap<number, MacroCoord>,
): number[] {
  const { plates, plazaPlateId } = composition;
  const want = Math.round(lerp(STOP_COUNT.low, STOP_COUNT.high, richness));
  const neighbours = neighbourMap(composition, W, H);
  const start = plazaPlateId >= 0 && plazaPlateId < plates.length ? plazaPlateId : 0;
  const fromStart = graphDistance(neighbours, plates.length, start);
  // A MASSIF IS WORTH CROSSING THE ISLAND FOR AND A MOUND IS NOT, and that is the only thing the two
  // cases differ in. It is the composition's OWN test — below `MASSIF_PEAK_FROM` there is no skirt and
  // no crown, and what is raised is a corner of scenery — so a map without one spends no more than its
  // stop count getting anywhere: forcing a tour across a flat island cost richness 0 a quarter of its
  // street ends, measured. What does NOT differ is that the walk still ends on the highest ground it
  // can stand on, because a mound the walk could have finished on and wandered past is the same fiat
  // at a smaller scale (measured, three low-relief runs of six ended on the bottom terrace of a map
  // built to three while the other three ended on the mound).
  const massif = composition.peakTier >= MASSIF_PEAK_FROM;
  const cap = massif ? want + STOP_SLACK : want;
  // THE DESTINATION IS THE HIGHEST GROUND THE WALK CAN REACH AND STAND ON, which is not always the
  // tallest plate: a summit across a channel is a summit no walk ends at, and one offering no cell a
  // street could be laid on is a summit with nowhere to stand. Without a massif it also has to be
  // RAISED and IN RANGE, since the budget is the walk's own length there.
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
  // NOTHING TO ARRIVE AT: a map with no raised plate in range, which is the flat garden town at the
  // quiet end of the axis. The walk is the greedy wander it always was there, leaning away from the
  // plaza toward the plate the archetype read highest — ties to the lowest id, since on a flat island
  // many plates read alike.
  if (goal < 0) {
    if (massif) return [];
    const highest = plates.reduce((best, p) => (p.tier > plates[best]!.tier ? p.id : best), 0);
    return wander(plates, neighbours, graphDistance(neighbours, plates.length, highest), rng, want, start);
  }
  const toGoal = graphDistance(neighbours, plates.length, goal);
  // THE WALK ENDS AT THE MASS, and the stop count is what it may spend getting there rather than a
  // reason to stop short. Breaking at the count put the look-out on whatever plate the walk happened
  // to reach — low ground called a look-out by fiat — which is the near-low-far-high rule inverted.
  const route = routeTo(plates, neighbours, toGoal, rng, want, cap, start, goal);
  // A ROUTE THAT ARRIVES EXISTS, since the goal was chosen among the plates the plaza can reach; what
  // may not exist is one the stop budget affords, or one the search found inside its own budget. Then
  // the walk is the shortest way to the mass — longer than the map would have liked, and still a walk
  // that ends where the composition put its height.
  return route.length ? route : shortestRoute(neighbours, toGoal, start, goal);
}

/** The walk on an island with nothing raised inside its own budget: the greedy wander, bounded by its
 *  stop count, which is what every walk was before there was a summit to arrive at. */
function wander(
  plates: readonly Plate[], neighbours: ReadonlyMap<number, number[]>, toGoal: readonly number[],
  rng: Rng, want: number, start: number,
): number[] {
  const chain: number[] = [];
  const seen = new Set<number>([start]);
  let current = start;
  for (let guard = 0; guard < plates.length && chain.length < want; guard++) {
    const options = (neighbours.get(current) ?? []).filter((id) => !seen.has(id));
    if (options.length === 0) break;
    // ONE DRAW, since there is nothing to backtrack into: the wander takes the step it takes.
    const { first } = preferred(plates, toGoal, current, options, want, chain.length);
    const pick = first[rng.int(first.length)]!;
    chain.push(pick);
    seen.add(pick);
    current = pick;
  }
  return chain;
}

/** How much work a route search may spend before the shortest path is taken instead. A plate graph
 *  holds at most `PLATE_TOTAL_MAX` nodes and the depth bound prunes hard, so this is reached only on
 *  a graph shaped to defeat the bound rather than on any island measured here. */
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
  plates: readonly Plate[], neighbours: ReadonlyMap<number, number[]>, toGoal: readonly number[],
  rng: Rng, want: number, cap: number, start: number, goal: number,
): number[] {
  const chain: number[] = [];
  const seen = new Set<number>([start]);
  let spent = 0;
  const step = (at: number): boolean => {
    if (at === goal) return true;
    if (chain.length >= cap || ++spent > ROUTE_BUDGET) return false;
    const options = (neighbours.get(at) ?? []).filter((id) => !seen.has(id));
    const { first, rest } = preferred(plates, toGoal, at, options, want, chain.length);
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
 * The order a step's options are tried in: the one the walk wants first.
 *
 * Progress toward the mass unless the walk still owes stops AND has hops to spare, in which case a
 * lateral step buys one: the same destination reached the long way round is a different walk.
 *
 * THE WALK CLIMBS, which is what a lateral step is otherwise free to forget. Near-low-far-high is a
 * fact about the ROUTE as much as about the ground: a walk that wanders the bottom terrace for five
 * stops and then meets the whole mass at once is a flat walk with a viewpoint bolted on, and it is
 * what the pavement's own entropy reads as a single-storey town. So a step that stays at the walk's
 * own level or rises is preferred.
 *
 * A STEP THE WALK CAN CLIMB comes before that. The flight that carries the line over a step is
 * `RAMP_RUN` cells of run per tier, so a three-tier step needs twelve cells of the terrace below it
 * and there is usually no such room: the leg is then laid, found unreachable and pruned, and the map
 * comes back with no primary walk at all (measured on one seed of ten, whose walk crossed 0, 3, 5 and
 * 8 in four steps). So a gentle step is preferred, then a rising one.
 *
 * `first` is the group the walk chooses inside — seeded, which is what gives two seeds two stories on
 * one island — and `rest` is what the route search falls back through when nothing beyond `first`
 * arrives. The two are kept apart rather than returned as one order because the choice and the
 * fallback are different acts: a wander with nothing to backtrack into draws once from `first`.
 */
function preferred(
  plates: readonly Plate[], toGoal: readonly number[], at: number,
  options: readonly number[], want: number, spent: number,
): { first: number[]; rest: number[] } {
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
 * The options of one preference group in the order the walk draws them, DRAWN LAZILY.
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
 *  on (its dual-grid window level and on the island). A plate offering none is absent from the map,
 *  which is what keeps it out of both the destination and the stop list. */
function plateAnchors(
  composition: CompositionPlan, tiers: Int8Array, land: Uint8Array, W: number, H: number,
): Map<number, MacroCoord> {
  const out = new Map<number, MacroCoord>();
  for (const p of composition.plates) {
    const cx = p.rect.x + p.rect.w / 2, cy = p.rect.y + p.rect.h / 2;
    let best: MacroCoord | null = null, bestD = Infinity;
    for (const i of p.cells) {
      const x = i % W, y = (i / W) | 0;
      if (!levelWindow(tiers, land, x, y, W, H)) continue;
      const d = Math.abs(x - cx) + Math.abs(y - cy);
      if (d < bestD) { bestD = d; best = { x, y }; }
    }
    if (best) out.set(p.id, best);
  }
  return out;
}

/** Whether a street's own window — the cell plus one column right and one row below — stands on the
 *  island at one tier. The same reading `streets.ts` builds its pavable mask from. */
function levelWindow(tiers: Int8Array, land: Uint8Array, x: number, y: number, W: number, H: number): boolean {
  if (x < 0 || y < 0 || x + 1 >= W || y + 1 >= H) return false;
  const t = tiers[flatIndex(x, y, W)]!;
  for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) {
    const i = flatIndex(x + dx, y + dy, W);
    if (!land[i] || tiers[i] !== t) return false;
  }
  return true;
}

/** The point on the plaza's ring the walk sets off from: the middle of whichever side faces the
 *  first stop. */
function plazaGate(plaza: Rect, toward: MacroCoord): MacroCoord {
  const cx = plaza.x + plaza.w / 2, cy = plaza.y + plaza.h / 2;
  const dx = toward.x - cx, dy = toward.y - cy;
  if (Math.abs(dx) >= Math.abs(dy)) {
    return { x: Math.round(dx >= 0 ? plaza.x + plaza.w : plaza.x - 1), y: Math.round(cy) };
  }
  return { x: Math.round(cx), y: Math.round(dy >= 0 ? plaza.y + plaza.h : plaza.y - 1) };
}

// --- the polyline --------------------------------------------------------------------------------

/**
 * The waypoints joined into axis-aligned stretches: each leg is an L, and the elbow is put on
 * whichever of the two ways round runs over more ground a street can be laid on.
 *
 * An L rather than a diagonal because a street here is a line at one coordinate — that is what makes
 * a block's frontage straight — and a walk that turns at its stops reads as a route through places
 * rather than as a ruled line across the island.
 */
function legs(
  waypoints: readonly MacroCoord[], tiers: Int8Array, land: Uint8Array, W: number, H: number, seed: number,
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
    const scoreX = legScore(viaX, tiers, land, W, H);
    const scoreY = legScore(viaY, tiers, land, W, H);
    const pick = scoreX > scoreY || (scoreX === scoreY && hash01(seed ^ 0x1e6, k) < 0.5) ? viaX : viaY;
    for (const seg of pick) if (seg.to > seg.from) out.push(seg);
  }
  return merge(out);
}

/** How much of a leg stands on ground a street could be laid on. */
function legScore(
  segments: readonly MovementSegment[], tiers: Int8Array, land: Uint8Array, W: number, H: number,
): number {
  let n = 0;
  for (const seg of segments) {
    for (let t = seg.from; t <= seg.to; t++) {
      const x = seg.axis === 'y' ? seg.line : t;
      const y = seg.axis === 'y' ? t : seg.line;
      if (levelWindow(tiers, land, x, y, W, H)) n++;
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
    // look-out. A look-out drawn HALFWAY along is a view the walk turns its back on, so the role is
    // the terminus's alone and the draw between the ends picks from the rest.
    const forced = index === last ? 'lookout' : index === 0 && last > 0 ? 'market' : null;
    const entry = forced
      ? STOP_ROLES.find((s) => s.role === forced)!
      : drawRole(rng, t, high);
    const theme = entry.themes[rng.int(entry.themes.length)]!;
    return {
      index, at: anchor.at, tier, plate: anchor.plate,
      role: entry.role, themeId: theme.id, family: theme.family,
      // Every other stop is drawn big, so the walk alternates a set piece with a quieter block
      // rather than running past the same block size all the way out.
      setPiece: index % 2 === 0,
    };
  });
}

function drawRole(rng: Rng, t: number, high: number): (typeof STOP_ROLES)[number] {
  const pool = STOP_ROLES.filter((s) => s.role !== 'lookout');
  const weights = pool.map((s) => Math.max(0.01, lerp(s.near, s.far, t) + s.high * high));
  const total = weights.reduce((a, b) => a + b, 0);
  let roll = rng.float() * total;
  for (let k = 0; k < weights.length; k++) {
    roll -= weights[k]!;
    if (roll <= 0) return pool[k]!;
  }
  return pool[pool.length - 1]!;
}

// --- the water the walk asks for -----------------------------------------------------------------

/**
 * Where the walk wants water: a lake beside every waterside stop, and a cascade beside every stretch
 * that climbs a tier.
 *
 * Both are asked for BESIDE the line rather than on it. A body on the line is a channel the street
 * cannot cross without a deck, and the one place the walk does step over water is chosen later by
 * `streets.ts`, on the pavement it actually laid.
 */
function wantWater(
  stops: readonly MovementStop[], segments: readonly MovementSegment[], tiers: Int8Array,
  land: Uint8Array, W: number, H: number,
): WaterWant[] {
  const out: WaterWant[] = [];
  for (const stop of stops) {
    const seg = nearestSegment(segments, stop.at);
    if (!seg) continue;
    if (stop.role === 'waterside') {
      const rect = besideLine(seg, stop.at, LAKE_OFFSET, LAKE_SIZE.w, LAKE_SIZE.h);
      if (fitsOnLand(rect, tiers, land, stop.tier, W, H)) {
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

/** Whether a wanted body stands wholly on island ground at one tier. A want that does not is dropped
 *  here rather than handed to the sculptor to refuse. */
function fitsOnLand(
  rect: Rect, tiers: Int8Array, land: Uint8Array, tier: number, W: number, H: number,
): boolean {
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

// --- the island ----------------------------------------------------------------------------------

function landMask(template: MapTemplate): Uint8Array {
  const W = template.width, H = template.height;
  const out = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (template.zones[y]?.[x] === CellZone.Grass) out[flatIndex(x, y, W)] = 1;
    }
  }
  return out;
}

// --- arithmetic ----------------------------------------------------------------------------------

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const lerp = (a: number, b: number, t: number): number => a + (b - a) * clamp01(t);

/** Avalanche of two integers into one 32-bit value: neighbouring inputs give unrelated outputs. */
function mix(a: number, b: number): number {
  let h = (Math.imul(a ^ b, 0x27d4eb2d) + 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

/** A 0..1 hash of two integers: an elbow's tie is broken positionally rather than off the rng
 *  stream, so it lands in the same place whatever order the legs were considered in. */
function hash01(a: number, b: number): number {
  return mix(Math.imul(a, 0x2545f491), b) / 4294967296;
}
