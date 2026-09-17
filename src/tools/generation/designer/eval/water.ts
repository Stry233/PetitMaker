/**
 * IS THE WATER A SYSTEM: the ledger, the fountain courts, the shape of the course, and how the
 * whole of it is distributed over shapes.
 *
 * The hard half is `waterStoryLedger` — every body of more than an accent belongs to the map's water
 * system or the map cannot explain it, and a solid mountain-framed rectangle among them is a tofu lake.
 * The rest is reported rather than gated: what a composition class is worth is a matter of taste, and
 * the ladder of classes is authored rather than discovered.
 */
import { distanceField } from '../../../../core/model/grid-model';
import { detectWaterfalls } from '../../../../core/model/waterfall-geometry';
import type { GridState, Rect } from '../../../../core/model/types';
import { NB4, readGrid, segmentRegions, type EvalGrid } from './grid';
import { bandScore } from './reference';
import {
  bodiesTouch, COMB_FLIPS_MIN, bandFlips, extentOf, mirrors, mountainFrame, spannedByCrossing,
  streamLike, touchesOffLand, WATER_ACCENT_MAX, waterBodies, type WaterBody,
} from './water-bodies';

/** A TOFU LAKE: a solid rectangle of this many cells or more, framed by mountain on three of its four
 *  sides, with nothing to say for itself. One of these on a map is a failure. */
const TOFU_MIN = 15;

const TOFU_FILL = 0.85;

const TOFU_FRAME = 3;

/**
 * Share of a map's water that may stand outside its system.
 *
 * Measured by this code on the two fixtures: 2.5% of the style target's water and 8.3% of the garden
 * town's, in both cases the small compact pools that read as a trough or a bed. The bar is the worse of
 * the two with room, so a map that spends a seventh of its water on nothing fails and the references do
 * not.
 *
 * A TERRACED PLANET FRAMES A POOL MORE OFTEN, which pushes the reading up: an accent cut on a terrace
 * has a step on two or three of its sides, and the test that decides whether a body belongs to the
 * map's water story asks exactly that. Composing the water pushes it back down, since most of a map's
 * water then stands in a few large figures that account for themselves and the accents are a smaller
 * share of a bigger total. Measured over both templates at three richness levels, ten seeds each.
 */
const UNACCOUNTED_MAX = 0.12;

/** How far a fountain court looks for the space it is composed against. */
const COURT_REACH = 6;

/**
 * What makes a court a MAIN fountain rather than an ornament, which is the distinction the whole
 * per-region rule rests on: 一个区域有明确的主喷泉即可，不要同时有多个, and in the same breath
 * 小喷泉则可以放在花园、街角 — a garden or street-corner fountain standing beside the main one is what
 * the supplement asks for, not what it forbids.
 *
 * IT IS THE SPAN AND NOT THE CELL COUNT. A cell floor conflates the two: a large court drawn as a
 * thin ring round a wide platform holds 32 water cells and a small solid cruciform basin holds 20, so
 * a floor that admits the second admits neither or both. The span separates them by construction —
 * the grammar draws a garden court at half-span 2 to 3 and a large one at 5 to 7 — and it is what a
 * reader means by a fountain that commands its space.
 */
const COURT_MAIN_SPAN = 9;

const COURT_MAIN_MIN = 12;

/** The widest a formal court can be and still be a court: past this it is a pond that happens to
 *  hold an islet. The reference's own is 14 across. */
const COURT_SPAN_MAX = 17;

/** How closely a body has to mirror itself about both axes of its box to read as composed. */
const COURT_MIRROR_MIN = 0.9;

/**
 * The stream-shape floors, from the game's own guidance on watercourses (做成有方向的曲线，避免长距离
 * 笔直，可以有缓弯、急弯、局部变宽变窄).
 *
 * Measured by this code on the two fixtures: the style target's own course reads 7.6 bends per 10
 * cells of length, 17 distinct local widths and a longest straight run of 3; the garden town's is
 * the flat map's raised channel and reads 0, 1 and 17. So a bar has to separate them, and both
 * numbers sit where they do for that reason — `STREAM_STRAIGHT_MAX` is also the planner's own
 * declared bound plus the two cells a fall moves the head.
 */
export const STREAM_STRAIGHT_MAX = 16;

/** How many of a map's largest bodies the distribution reading takes. Seven is the count the style
 *  target's 63% is measured over. */
const TOP_BODIES = 7;

/** Surface levels a body must span to read as a cascade STAIR rather than as a fall on one step. */
const STAIR_TIERS_MIN = 3;

/** The most congruent FEATURE bodies a map may carry. The style target reads exactly 3. */
export const CONGRUENT_MAX = 3;

/**
 * The size a body must reach to be counted in the congruence reading: the same cut the reference's own
 * coarse signatures are taken over, its 45 bodies of 20 cells or more.
 *
 * The tail below it repeats far more often than three times on the style target itself — 8 bodies of
 * 3x1 and 7 of 2x1 — so a cap read over the tail would fail the reference. The cap is about the
 * FEATURES: a map whose composed bodies are copies of each other reads as machine output.
 */
const CONGRUENT_MIN_CELLS = 20;

const STREAM_BENDS_PER_10 = 0.6;

/** The WATER STORY ledger: does every body of water on the map belong to the map's water system?
 *
 *  A body is ACCOUNTED FOR when it is part of a course (it spans more than one surface level), a
 *  cascade (it presents a capped waterfall face), a formal court or islet pond (it holds an enclosed
 *  islet and mirrors about both of its own axes), a crossing the walk steps over (a bridge or a ramp
 *  stands at it), or a stream (a long thin shape rather than a compact one) — or when it touches a
 *  body that is. Everything else of more than `WATER_ACCENT_MAX` cells is water the map cannot
 *  explain, and a solid mountain-framed rectangle among them is the tofu lake by name. */
export interface WaterStoryLedger {
  pass: boolean;
  /** Bodies larger than an accent. */
  bodies: number;
  accounted: number;
  unaccountedCells: number;
  unaccountedShare: number;
  /** Solid mountain-framed rectangles with no story: the failure this reading exists for. */
  tofu: number;
  /** Where the first few unaccounted bodies stand, so a log entry can name them. */
  where: { x: number; y: number; cells: number }[];
}

export function waterStoryLedger(state: GridState, g = readGrid(state)): WaterStoryLedger {
  const bodies = waterBodies(g, state);
  const big = bodies.filter((b) => b.cells.length > WATER_ACCENT_MAX);
  const accounted = new Set<WaterBody>();
  for (const body of big) if (selfAccounts(g, body)) accounted.add(body);
  // A body TOUCHING an accounted one is the same water: a pond at the foot of a cascade, a bay off a
  // reach that the 4-connected reading cut apart at a diagonal.
  for (let pass = 0; pass < 2; pass++) {
    for (const body of big) {
      if (accounted.has(body)) continue;
      if (big.some((other) => accounted.has(other) && bodiesTouch(g, body, other))) accounted.add(body);
    }
  }
  let unaccountedCells = 0, tofu = 0;
  const where: { x: number; y: number; cells: number }[] = [];
  const water = bodies.reduce((a, b) => a + b.cells.length, 0);
  for (const body of big) {
    if (accounted.has(body)) continue;
    unaccountedCells += body.cells.length;
    if (where.length < 4) where.push({ x: body.x0, y: body.y0, cells: body.cells.length });
    if (body.cells.length >= TOFU_MIN && body.fill >= TOFU_FILL && mountainFrame(g, body) >= TOFU_FRAME) tofu++;
  }
  const unaccountedShare = water ? unaccountedCells / water : 0;
  return {
    pass: tofu === 0 && unaccountedShare <= UNACCOUNTED_MAX,
    bodies: big.length, accounted: accounted.size, unaccountedCells, unaccountedShare, tofu, where,
  };
}

/** Whether a body explains itself, without help from its neighbours. */
function selfAccounts(g: EvalGrid, body: WaterBody): boolean {
  if (body.tiers.size > 1 || body.faced) return true;
  // TWO OR MORE enclosed islets is a FIGURE: the panel a landmark writes its phrase into, whose ink
  // is retained ground inside the flooded field. The style target's own banner reads exactly this
  // way, and a shape test cannot recover the semantics any other way.
  if (body.holes >= 2) return true;
  if (body.holes > 0 && mirrors(g, body) >= COURT_MIRROR_MIN) return true;
  // A COMB is a composed class of its own (6 of the style target's 83 bodies, 9 of them with four or
  // more band flips): water bars alternating with dry ridges, which is what the target's
  // own planted water gardens are built from. A solid rectangle has no flips at all, so this cannot
  // account for the tofu the ledger exists to catch.
  if (bandFlips(g, body) >= COMB_FLIPS_MIN) return true;
  if (spannedByCrossing(g, body)) return true;
  return streamLike(body);
}

/** FOUNTAIN PRESENCE: the formal nested courts standing on the map, and whether each is composed
 *  against something a visitor walks to. One MAIN fountain per region and never several. */
export interface FountainPresence {
  pass: boolean;
  courts: number;
  /** Courts with the plaza, a street or a building's frontage within reach. */
  related: number;
  /** The most main fountains standing in any one region. */
  perRegion: number;
}

export function fountainPresence(state: GridState, g = readGrid(state)): FountainPresence {
  const courts = nestedAsOne(waterBodies(g, state).filter((b) => isCourt(g, b)));
  const related = courts.filter((b) => relatedToSpace(g, b)).length;
  const regions = segmentRegions(g);
  const regionOf = new Int32Array(g.W * g.H).fill(-1);
  for (const [k, region] of regions.entries()) for (const i of region.cells) regionOf[i] = k;
  const perRegionCount = new Map<number, number>();
  for (const court of courts) {
    if (court.cells.length < COURT_MAIN_MIN) continue;
    if (Math.max(court.x1 - court.x0, court.y1 - court.y0) + 1 < COURT_MAIN_SPAN) continue;
    const near = nearestRegionOf(g, regionOf, court);
    if (near < 0) continue;
    perRegionCount.set(near, (perRegionCount.get(near) ?? 0) + 1);
  }
  const perRegion = perRegionCount.size ? Math.max(...perRegionCount.values()) : 0;
  return { pass: related >= 1 && perRegion <= 1, courts: courts.length, related, perRegion };
}

/** The boxes the map's formal courts stand in, nested annuli merged. The arrival reading asks for
 *  them by the same test that counts them here, so the two cannot disagree about what a court is. */
export function courtBoxes(state: GridState, g = readGrid(state)): Rect[] {
  return nestedAsOne(waterBodies(g, state).filter((b) => isCourt(g, b)))
    .map((b) => ({ x: b.x0, y: b.y0, w: b.x1 - b.x0 + 1, h: b.y1 - b.y0 + 1 }));
}

/**
 * ONE NESTED COMPOSITION IS ONE COURT.
 *
 * `waterBodies` is a 4-connected decomposition, and a nesting is not connected: a moat, its basin and
 * whatever stands between them are separate annuli standing inside one another, and each of them
 * reads as a court on its own — same box, same mirror, its own islet. Counted as bodies, ONE
 * fountain of nesting depth 3 answers "how many main fountains stand in this region" with 2, which is
 * the supplement's own rule failing on the composition it asks for. `figure.ts` makes the same move
 * for the set piece and for the same reason.
 *
 * Boxes that OVERLAP are one composition. Concentric annuli nest, so the test is exact for what it is
 * here to merge, and two courts genuinely standing apart have disjoint boxes — the grammar keeps its
 * own dry margin around each, and the planner keeps them `COURT_SPACING` apart on top of that.
 */
function nestedAsOne(courts: readonly WaterBody[]): WaterBody[] {
  const out: WaterBody[] = [];
  for (const court of courts) {
    const host = out.find((o) => o.x0 <= court.x1 && court.x0 <= o.x1 && o.y0 <= court.y1 && court.y0 <= o.y1);
    if (!host) { out.push({ ...court, cells: [...court.cells], tiers: new Set(court.tiers) }); continue; }
    host.cells.push(...court.cells);
    host.x0 = Math.min(host.x0, court.x0); host.y0 = Math.min(host.y0, court.y0);
    host.x1 = Math.max(host.x1, court.x1); host.y1 = Math.max(host.y1, court.y1);
    host.holes = Math.max(host.holes, court.holes);
  }
  return out;
}

/** A formal court: a regular nested composition, small enough to read as one and mirrored about the
 *  better of its own axes, holding an islet (its platform or its centre figure). */
function isCourt(g: EvalGrid, body: WaterBody): boolean {
  if (body.cells.length <= WATER_ACCENT_MAX || body.holes === 0) return false;
  if (body.x1 - body.x0 + 1 > COURT_SPAN_MAX || body.y1 - body.y0 + 1 > COURT_SPAN_MAX) return false;
  return mirrors(g, body) >= COURT_MIRROR_MIN;
}

/** Whether pavement, the plaza or a building stands within reach of the court: the RELATION the
 *  supplement asks a fountain to be composed with. */
function relatedToSpace(g: EvalGrid, body: WaterBody): boolean {
  const { W, H } = g;
  for (let y = body.y0 - COURT_REACH; y <= body.y1 + COURT_REACH; y++) {
    for (let x = body.x0 - COURT_REACH; x <= body.x1 + COURT_REACH; x++) {
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const i = y * W + x;
      if (g.paved[i] || g.plaza[i] || g.structure[i]) return true;
    }
  }
  return false;
}

/** The region a court stands in, read at the cells around it: a court is water, so it is never
 *  inside a region itself. */
function nearestRegionOf(g: EvalGrid, regionOf: Int32Array, body: WaterBody): number {
  const { W, H } = g;
  for (let r = 1; r <= COURT_REACH; r++) {
    for (let y = body.y0 - r; y <= body.y1 + r; y++) {
      for (let x = body.x0 - r; x <= body.x1 + r; x++) {
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        const k = regionOf[y * W + x]!;
        if (k >= 0) return k;
      }
    }
  }
  return -1;
}

/** STREAM SHAPE: how the map's own watercourse is drawn. Read on the largest body that reads as a
 *  course, so a map with no stream reports zeros rather than a shape it does not have. */
export interface StreamShape {
  /** Whether a course was found at all. */
  present: boolean;
  cells: number;
  bends: number;
  bendsPer10: number;
  /** How many distinct local widths the course runs at. */
  widths: number;
  longestStraight: number;
  source: boolean;
  destination: boolean;
  score: number;
}

export function streamShape(state: GridState, g = readGrid(state)): StreamShape {
  // THE COURSE IS THE MOST-DESCENDING BODY THAT READS AS A CHANNEL, and both halves of that are needed.
  // Neither cell count nor extent finds it — a cascade's band and its landing are two tiers and can
  // outweigh a modest course on both while being three cells long — and descent alone does not find it
  // either on a map carrying CASCADE STAIRS: a stair spans as many terraces as a course and is ten times
  // as wide, so it wins a descent-ordered sort and the map's own watercourse is never read (by descent
  // alone the share of courses showing both ends reads 4 of 10 rather than 6). A channel is thin over its
  // own length, which is what `streamLike` says and what a stair is not.
  // A DESCENDING CHANNEL first, then a body that merely descends, then one that merely runs.
  const kind = (b: WaterBody): number => (b.tiers.size > 1 ? 2 : 0) + (streamLike(b) ? 1 : 0);
  const course = waterBodies(g, state)
    .filter((b) => b.cells.length > WATER_ACCENT_MAX && (b.tiers.size > 1 || streamLike(b)))
    .sort((a, b) => kind(b) - kind(a)
      || b.tiers.size - a.tiers.size || extentOf(b) - extentOf(a)
      || b.cells.length - a.cells.length)[0] ?? null;
  const empty: StreamShape = {
    present: false, cells: 0, bends: 0, bendsPer10: 0, widths: 0, longestStraight: 0,
    source: false, destination: false, score: 0,
  };
  if (!course) return empty;
  const { W } = g;
  const alongX = course.x1 - course.x0 >= course.y1 - course.y0;
  const lo = alongX ? course.x0 : course.y0, hi = alongX ? course.x1 : course.y1;
  const centre: number[] = [], width: number[] = [];
  for (let a = lo; a <= hi; a++) {
    let sum = 0, n = 0;
    for (const i of course.cells) {
      const x = i % W, y = (i / W) | 0;
      if ((alongX ? x : y) !== a) continue;
      sum += alongX ? y : x; n++;
    }
    if (n === 0) { centre.push(NaN); width.push(0); continue; }
    centre.push(sum / n); width.push(n);
  }
  let bends = 0, straight = 0, longestStraight = 0, last = 0;
  for (let k = 1; k < centre.length; k++) {
    const a = centre[k - 1]!, b = centre[k]!;
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    const step = Math.sign(Math.round(b - a));
    if (step !== last) { bends++; straight = 1; } else straight++;
    longestStraight = Math.max(longestStraight, straight);
    last = step;
  }
  const widths = new Set(width.filter((w) => w > 0)).size;
  const length = hi - lo + 1;
  const bendsPer10 = length ? (10 * bends) / length : 0;
  // A SOURCE is high ground the course comes down from; a DESTINATION is where it arrives — a body
  // three times its own median width, or the coast.
  const run = [...width].filter((w) => w > 0).sort((a, b) => a - b);
  const median = run[Math.floor(run.length / 2)] ?? 1;
  // A FINISHED MAP DOES NOT SAY WHICH WAY THE WATER RUNS, so the two ends are read for what they
  // are rather than for which is which. A SOURCE is high ground the course comes down from, or a
  // pool at one end of it; an ARRIVAL is the coast, or a widening of at least twice the channel that
  // feeds it — the pond a course ends in is the widest thing on it.
  const third = Math.max(1, Math.floor(width.length / 3));
  const pooled = width.slice(0, third).some((w) => w >= 2 * median)
    || width.slice(width.length - third).some((w) => w >= 2 * median);
  const source = course.tiers.size > 1 || pooled;
  const destination = touchesOffLand(g, course) || Math.max(...width) >= 2 * median;
  const score = (
    bandScore(bendsPer10, STREAM_BENDS_PER_10, 10, STREAM_BENDS_PER_10)
    + (widths > 1 ? 1 : 0)
    + (longestStraight <= STREAM_STRAIGHT_MAX ? 1 : 0)
    + (source ? 1 : 0) + (destination ? 1 : 0)
  ) / 5;
  return {
    present: true, cells: course.cells.length, bends, bendsPer10, widths, longestStraight,
    source, destination, score,
  };
}

/** How much of a map's water is COMPOSED, in the same vocabulary the references were read with.
 *  Reported, never gated: what a composition class is worth is a matter of taste, and the ladder of
 *  classes is authored rather than discovered. */
export interface WaterComposition {
  bodies: number;
  cells: number;
  share: number;
  /** Bodies holding an enclosed dry islet: the pool-with-islet class. */
  withIsland: number;
  /** Bodies whose bounding box alternates wet and dry bands four times or more on one axis: a comb,
   *  which is the shape a water garden's bars and beds make. */
  combs: number;
  /** Bodies standing on more than one tier, which is a cascade rather than a pool. */
  multiTier: number;
  /** Water cells presenting at least one capped waterfall face. */
  facedCells: number;
  /** Distinct surface tiers carrying water. The style target carries water on all nine of its. */
  tiers: number;
  /** Cells of the largest body, as a share of all water. On the style target 7 bodies hold 63%. */
  largestShare: number;
  /** Share of the water standing in the largest `TOP_BODIES` bodies: the headline reading of the style
   *  target's distribution (7 bodies hold 63%), and the one that separates a few composed figures from
   *  an even sprinkle. */
  topShare: number;
  /** The most CONGRUENT feature bodies on the map: same bounding box and the same coarse 3x3 wet
   *  signature. The cap is 3, which is exactly what the style target reads. */
  congruent: number;
  /** Bodies that are a cascade STAIR: they span three or more surface levels and present a capped
   *  waterfall face, so the water is a vertical system rather than a pool. */
  stairs: number;
  /**
   * Share of the bodies larger than an accent whose RIM stands against a terrace step: ground on their
   * bank standing higher than the water's own surface.
   *
   * The reference's water is CUT INTO its terraces rather than laid on them — majority-water terraces,
   * moats round a platform — and this is that claim as one number. Reported, never gated: a coastal
   * lagoon and a pond on a plain are
   * both legitimate water, and what the number says is whether the planet's water was COMPOSED with
   * its landform or dropped onto it.
   */
  inTerrain: number;
  /** Plants whose footprint stands within 2 and within 4 cells of a water cell, as a share of all
   *  planting (the style target reads 50% and 69%, the garden town 8% and 26%). It is the reading that
   *  says whether the planting was GATHERED at the banks or merely
   *  laid on a map that happens to hold water. Reported, never gated. */
  nearWater2: number;
  nearWater4: number;
}

export function waterComposition(state: GridState): WaterComposition {
  const g = readGrid(state);
  // ONE DECOMPOSITION, read by every column below. It is shared with the ledger too, so the two answer
  // the same question about the same bodies: this pass counts SHAPES over them, the ledger counts what
  // each one belongs to.
  const bodies = waterBodies(g, state);
  const cells = bodies.reduce((a, b) => a + b.cells.length, 0);
  const top = bodies.slice(0, TOP_BODIES).reduce((a, b) => a + b.cells.length, 0);
  const largest = bodies[0]?.cells.length ?? 0;
  const signatures = new Map<string, number>();
  for (const body of bodies) {
    if (body.cells.length < CONGRUENT_MIN_CELLS) continue;
    const sig = coarseSignature(g, body);
    signatures.set(sig, (signatures.get(sig) ?? 0) + 1);
  }
  const stairs = bodies.filter((b) => b.tiers.size >= STAIR_TIERS_MIN && b.faced).length;
  const tiers = new Set<number>();
  let withIsland = 0, combs = 0, multiTier = 0;
  for (const body of bodies) {
    for (const l of body.tiers) tiers.add(l);
    if (body.tiers.size > 1) multiTier++;
    // An ISLET is dry ground inside the box that cannot reach the box's border without crossing the
    // body: the hole test the reference's own islet class is read by.
    if (body.holes > 0) withIsland++;
    // BAND FLIPS: rows (then columns) of the box counted as wet at half or more, the number of times
    // the reading changes. Four or more is a comb.
    if (bandFlips(g, body) >= COMB_FLIPS_MIN) combs++;
  }
  let facedCells = 0;
  for (const fall of detectWaterfalls(state)) facedCells += fall.cells.length;
  const near = plantsNearWater(g);
  const big = bodies.filter((b) => b.cells.length > WATER_ACCENT_MAX);
  const set = big.filter((b) => rimAgainstStep(g, b)).length;
  return {
    bodies: bodies.length, cells, share: g.landCells ? cells / g.landCells : 0,
    inTerrain: big.length ? set / big.length : 0,
    withIsland, combs, multiTier, facedCells, tiers: tiers.size,
    largestShare: cells ? largest / cells : 0,
    topShare: cells ? top / cells : 0,
    congruent: signatures.size ? Math.max(...signatures.values()) : 0,
    stairs,
    nearWater2: near.within2, nearWater4: near.within4,
  };
}

/**
 * A body's shape for the congruence reading: its bounding box, plus which of the nine coarse blocks of
 * that box are more than half wet.
 *
 * Box dimensions alone would call a comb and a solid rectangle of the same extent the same shape. Read
 * this way the style target returns the solid signature ten times and then twenty distinct signatures,
 * none repeated more than three times, which is the numeric form of a map that does not reuse one blob
 * shape.
 */
function coarseSignature(g: EvalGrid, body: WaterBody): string {
  const { W } = g;
  const bw = body.x1 - body.x0 + 1, bh = body.y1 - body.y0 + 1;
  const cells = new Set(body.cells);
  let bits = '';
  for (let by = 0; by < 3; by++) {
    for (let bx = 0; bx < 3; bx++) {
      const x0 = body.x0 + Math.floor((bx * bw) / 3), x1 = body.x0 + Math.floor(((bx + 1) * bw) / 3);
      const y0 = body.y0 + Math.floor((by * bh) / 3), y1 = body.y0 + Math.floor(((by + 1) * bh) / 3);
      let wet = 0, seen = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          seen++;
          if (cells.has(y * W + x)) wet++;
        }
      }
      bits += seen > 0 && wet * 2 >= seen ? '1' : '0';
    }
  }
  return `${bw}x${bh}:${bits}`;
}

/** Whether any cell on a body's bank stands ABOVE the body's own surface: the body is cut into a
 *  step rather than lying on top of a terrace. A step DOWN is not the same claim — that is a
 *  waterfall lip, which the story ledger reads on its own terms. */
function rimAgainstStep(g: EvalGrid, body: WaterBody): boolean {
  const { W, H } = g;
  const own = new Set(body.cells);
  for (const i of body.cells) {
    const x = i % W, y = (i / W) | 0;
    for (const [dx, dy] of NB4) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const j = ny * W + nx;
      if (own.has(j) || !g.land[j] || g.water[j]) continue;
      if (g.elev[j]! > g.elev[i]!) return true;
    }
  }
  return false;
}

/** Share of the map's planting standing within 2 and within 4 cells of water, Chebyshev, measured
 *  from a plant's own cell — the same distance the references are measured at. */
function plantsNearWater(g: EvalGrid): { within2: number; within4: number } {
  const { W, H } = g;
  const seeds: number[] = [];
  for (let i = 0; i < W * H; i++) if (g.water[i]) seeds.push(i);
  if (seeds.length === 0) return { within2: 0, within4: 0 };
  const dist = distanceField(seeds, W, H, true);
  let plants = 0, within2 = 0, within4 = 0;
  for (let i = 0; i < W * H; i++) {
    if (g.plantAt[i] === undefined) continue;
    plants++;
    const d = dist[i]!;
    if (d <= 2) within2++;
    if (d <= 4) within4++;
  }
  return plants ? { within2: within2 / plants, within4: within4 / plants } : { within2: 0, within4: 0 };
}
