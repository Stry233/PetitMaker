/**
 * THE WATER STORY: one connected watercourse per island, with a source and a destination.
 *
 * The game's own guidance on water (水体) is written as a system rather than as four shapes. A pond is
 * where a stream ARRIVES; a stream is DIRECTIONAL and CURVED, changing width with the district it
 * passes and splitting into a tributary that rejoins; a waterfall is a VISUAL FOCUS at a real height difference
 * that CONTINUES downstream, and several of them are staggered in size and position. What it rules
 * out is independent bodies dropped where a budget happens to land them, with no source, no direction
 * and no arrival.
 *
 * So this module walks ONE course. It picks a SPRING on high ground near the walk, heads downhill,
 * runs a REACH along each terrace it crosses, cuts a FALL at every step it meets, and ends in a
 * shaped POND or at the coast. Richness scales its length and how many features it carries — the
 * falls, the tributary, the bays — never the grammar itself.
 *
 * LEGAL BY CONSTRUCTION, HOP BY HOP:
 *  - a reach's cells are judged as ONE body (`cellsFit`): everything outside stands at the reach's
 *    own level or above, so the water shows no face and V-WTR-02 asks it for no caps.
 *  - a fall is the one place a face is wanted. Its band sits on the lip at tier e with a cell of
 *    standing terrace at each perpendicular end — mountain at exactly e, which is the cap V-WTR-02
 *    names — and the row it pours onto, caps included, is read for uniformity first, which is
 *    V-WTR-03. The landing may be several tiers down and may itself be water: a plunge into the
 *    reach below is one body flowing, which is what makes the story read as one thing.
 *  - EVERY ATTEMPT IS TRANSACTIONAL. A spring whose course arrives nowhere is put back cell for cell
 *    and the next spring is tried; a tributary that does not rejoin is never flooded at all. One
 *    chained story or nothing.
 *
 * Pure over its inputs (a `TerrainPlan` and two masks): no state, no rules consulted, no browser
 * API, and the same (seed, plan) gives the same course.
 */
import { distanceField, flatIndex } from '../../../../core/model/grid-model';
import type { MacroCoord, Rect } from '../../../../core/model/types';
import type { TerrainPlan } from '../../core/types';
import type { MovementLine } from '../composition/movement-line';
import type { DesignPlan, RegionPlan, ThemeId } from '../types';
import {
  atTier, boundsOfCells, cellsFit, floodCells, freeAt, surfaceOf, uniform,
} from './water-cut';

// --- tunables -----------------------------------------------------------------------------------

/** How many steps the course runs at richness 0 and 1. The style target's own water spine, a banded
 *  ladder, runs 24 rows and its cascade stair 21; a course that crosses the island is the two of them
 *  joined. */
const COURSE_LENGTH = { min: 26, max: 120 } as const;
/** The stream's width, and the width a BAY widens to where it passes a park. The target's troughs read
 *  2 to 4 cells across and its water spine 1. */
const STREAM_WIDTH = { min: 1, max: 3 } as const;
const BAY_WIDTH = 5;
/** How many steps a bay stays open, and the fewest steps of course between two of them. */
const BAY_RUN = 5;
const BAY_GAP = 16;
/** How often the course turns: a sharp bend every `TURN_EVERY` steps or so, a gentle drift between.
 *  The supplement asks for both and rules out a long straight run, and `STRAIGHT_MAX` is the bound
 *  the eval then holds the finished course to. */
const TURN_EVERY = { min: 5, max: 12 } as const;
/** How far a bend runs before the head returns to the flow: the amplitude of the meander. */
const BEND_RUN = { min: 3, max: 7 } as const;
export const STRAIGHT_MAX = 14;
/** How far along the same lip a fall's narrower companion stands, and how many companions one course
 *  carries. */
const COMPANION_GAP = { min: 3, max: 9 } as const;
const COMPANION_MAX = 3;
/** The destination pond: its span at richness 0 and 1, and the smallest it may be trimmed to. The
 *  report reads the target's shaped pools at 6x7 to 15x17. */
const POND_SPAN = { min: 7, max: 17 } as const;
const POND_MIN = 4;
/** How far back along its last reach the course looks for room to arrive in. */
const POND_BACKTRACK = 24;
/** The side of the spring pool the course leaves from. */
const SPRING_SIDE = 3;
/** The fewest cells a course must lay before it is a story rather than a puddle. */
const COURSE_MIN = 12;
/** How many springs are tried before the island is left dry. */
const SPRING_TRIES = 8;
/** How far a spring looks for the step it is going to fall down, and how much of its distance from
 *  the coast counts in its favour. */
const FALL_LOOKAHEAD = 14;
const SPRING_INLAND = 16;
/** How far the head looks for lower ground when it asks which way the island falls away. */
const DOWNHILL_LOOK = 40;
/** The tributary: a 1-wide branch that must rejoin the course within this many cells. */
const TRIBUTARY_LENGTH = 16;
/** How many times a blocked head may step aside before the course gives up. */
const DETOUR_MAX = 24;
/** Below this richness the course carries no tributary. */
const TRIBUTARY_FROM = 0.4;

// --- what a story is ----------------------------------------------------------------------------

export type PondShape = 'lozenge' | 'u-moat' | 'islet' | 'diamond';

/** One run of the course along a single terrace. */
export interface StoryReach {
  tier: number;
  cells: MacroCoord[];
}

/** One fall, cut on the lip of a terrace step. `main` is the course's own; the companions are the
 *  narrower staggered ones beside it. */
export interface StoryFall {
  rect: Rect;
  tier: number;
  /** The level the water lands on: one tier down for a step, further for a plunge. */
  landsAt: number;
  main: boolean;
}

export interface StoryPond {
  shape: PondShape;
  rect: Rect;
  tier: number;
  cells: MacroCoord[];
}

export interface WaterStory {
  source: { at: MacroCoord; tier: number };
  /** The centre of the STREAM, source to arrival, in flow order: what a contact sheet draws so a
   *  reader can see where the water comes from and where it goes. The pond is its own shape and is
   *  drawn from `pond`, so the spine stays a line. */
  spine: MacroCoord[];
  reaches: StoryReach[];
  falls: StoryFall[];
  pond: StoryPond | null;
  /** Where the course ends. A course that ends nowhere is reverted, so this is never 'dry'. */
  ending: 'pond' | 'sea';
  /** The branch that leaves the course and rejoins it, where one was drawn. */
  tributary: MacroCoord[];
  bays: Rect[];
  /** Every cell the story flooded. */
  cells: MacroCoord[];
}

export interface StoryInput {
  t: TerrainPlan;
  grass: Uint8Array;
  flat: Uint8Array;
  /** The places, so the course narrows where it passes homes and widens into a bay in a park. */
  plan: DesignPlan;
  /** The walk, so the source stands where a visitor climbs rather than on the far side of the map. */
  line?: MovementLine | undefined;
  /**
   * Water already standing that the course should carry on FROM, where the map has some: the foot of
   * a cascade stair.
   *
   * A stair is the same water story told on a slope, so a course that starts a spring of its own
   * somewhere else leaves the map with two unrelated systems. Offered before the springs and never
   * instead of them — a mouth whose course arrives nowhere is put back like any other attempt.
   */
  mouth?: { at: MacroCoord; tier: number } | undefined;
  richness: number;
  seed: number;
}

type Vec = readonly [number, number];

const DIRS: readonly Vec[] = [[1, 0], [0, 1], [-1, 0], [0, -1]];
const left = (d: Vec): Vec => [d[1], -d[0]];
const right = (d: Vec): Vec => [-d[1], d[0]];
const perp = left;

// --- the course ---------------------------------------------------------------------------------

/**
 * Cut the island's water story, or leave it dry.
 *
 * Springs are tried in order of how high they stand and how near the walk passes; the first whose
 * course arrives somewhere is the map's. Everything a refused attempt cut is put back, so trying
 * another costs the map nothing.
 */
export function carveWaterStory(input: StoryInput): WaterStory | null {
  const { t } = input;
  const walk = walkField(input);
  const shape = regionShape(input.plan, t.width, t.height);
  const sources: Source[] = [
    ...(input.mouth ? [{ at: input.mouth.at, tier: input.mouth.tier, pool: false }] : []),
    ...springs(input, walk).map((s) => ({ ...s, pool: true })),
  ];
  for (const source of sources) {
    const snapTier = t.tier.slice(), snapWater = t.water.slice();
    const story = runCourse(input, source, shape);
    if (story) return story;
    t.tier.set(snapTier);
    t.water.set(snapWater);
  }
  return null;
}

/** Where a course may start: a SPRING, which cuts its own pool, or a MOUTH, which is water that is
 *  already standing and only has to be flowed on from. */
interface Source { at: MacroCoord; tier: number; pool: boolean }

/** Chebyshev distance from every cell to the walk's own trace, or null where no walk was planned.
 *  The source is drawn toward it: a story a visitor never passes is one nobody sees. */
function walkField(input: StoryInput): Int16Array | null {
  const trace = input.line?.trace ?? [];
  if (trace.length === 0) return null;
  const W = input.t.width, H = input.t.height;
  return distanceField(trace.map((c) => flatIndex(c.x, c.y, W)), W, H, true);
}

/** The supplement's own rule for a stream's width: narrow beside homes, widening into a bay in a
 *  park. Every other place leaves it as it runs. */
const WIDE_THEMES: ReadonlySet<ThemeId> = new Set<ThemeId>([
  'park', 'garden', 'lake-fountain', 'waterside-deck', 'panorama-deck', 'flower-field',
]);

function regionWater(region: RegionPlan): -1 | 0 | 1 {
  if (region.kind === 'residential' || region.kind === 'own-house') return -1;
  if (region.themeId && WIDE_THEMES.has(region.themeId)) return 1;
  return 0;
}

/** What each cell's district wants of the course: -1 narrows it, +1 opens a bay, 0 leaves it. */
function regionShape(plan: DesignPlan, W: number, H: number): Int8Array {
  const out = new Int8Array(W * H);
  for (const region of plan.regions) {
    const want = regionWater(region);
    if (want === 0) continue;
    for (const lot of region.lot) {
      for (let y = Math.max(0, lot.y); y < Math.min(H, lot.y + lot.h); y++) {
        for (let x = Math.max(0, lot.x); x < Math.min(W, lot.x + lot.w); x++) {
          out[flatIndex(x, y, W)] = want;
        }
      }
    }
  }
  return out;
}

/** The springs worth trying: a `SPRING_SIDE` pool of untouched terrace high on the island with
 *  somewhere to flow, ordered by height first and by how near the walk passes second. */
function springs(input: StoryInput, walk: Int16Array | null): { at: MacroCoord; tier: number }[] {
  const { t, grass, flat } = input;
  const found: { at: MacroCoord; tier: number; score: number; key: number }[] = [];
  const half = SPRING_SIDE >> 1;
  const inland = inlandField(t, grass);
  for (let y = 1 + half; y < t.height - 1 - half; y++) {
    for (let x = 1 + half; x < t.width - 1 - half; x++) {
      const i = flatIndex(x, y, t.width);
      const tier = t.tier[i]!;
      if (tier < 1 || !grass[i] || flat[i] || t.water[i]! >= 0) continue;
      if (!hasFallAway(t, grass, x, y, tier)) continue;
      const rect: Rect = { x: x - half, y: y - half, w: SPRING_SIDE, h: SPRING_SIDE };
      if (!atTier(t, grass, flat, rect, tier)) continue;
      if (!cellsFit(t, grass, flat, rectCells(rect), tier)) continue;
      const near = walk ? Math.min(40, walk[i]!) : 0;
      // A spring wants HEIGHT first, then the walk passing near, then room around it: one on the
      // coastal rim has the drop of the sea beside it and nowhere at all to run.
      found.push({ at: { x, y }, tier, score: tier * 40 - near + Math.min(SPRING_INLAND, inland[i]!), key: i });
    }
  }
  found.sort((a, b) => b.score - a.score || a.key - b.key);
  // Spread the tries out, so a refused spring is not followed by its own neighbour.
  const out: { at: MacroCoord; tier: number }[] = [];
  for (const s of found) {
    if (out.some((o) => Math.abs(o.at.x - s.at.x) + Math.abs(o.at.y - s.at.y) < 8)) continue;
    out.push({ at: s.at, tier: s.tier });
    if (out.length >= SPRING_TRIES) break;
  }
  return out;
}

/** Chebyshev distance from every cell to the nearest one off the buildable island: how far inland it
 *  stands. */
function inlandField(t: TerrainPlan, grass: Uint8Array): Int16Array {
  const seeds: number[] = [];
  for (let i = 0; i < grass.length; i++) if (!grass[i]) seeds.push(i);
  return distanceField(seeds, t.width, t.height, true);
}

/** Whether ISLAND ground within a short reach of (x, y) stands below `tier`: the step the course is
 *  going to look for. The sea is not one — a spring on the coastal rim would find the drop off the
 *  island's edge and have nowhere to run. */
function hasFallAway(t: TerrainPlan, grass: Uint8Array, x: number, y: number, tier: number): boolean {
  for (const d of DIRS) {
    for (let k = 2; k <= FALL_LOOKAHEAD; k++) {
      const nx = x + d[0] * k, ny = y + d[1] * k;
      if (nx < 0 || ny < 0 || nx >= t.width || ny >= t.height) break;
      if (!grass[flatIndex(nx, ny, t.width)]) break;
      if (surfaceOf(t, nx, ny) < tier) return true;
    }
  }
  return false;
}

/** The whole course from one spring, or null where it arrived nowhere. */
function runCourse(
  input: StoryInput, spring: Source, shape: Int8Array,
): WaterStory | null {
  const { t, grass, flat, richness, seed } = input;
  const budget = Math.round(lerp(COURSE_LENGTH.min, COURSE_LENGTH.max, richness));
  const half = spring.pool ? SPRING_SIDE >> 1 : 0;

  // A MOUTH IS ALREADY WATER, so its own cell is the course's first: it is counted in, which is what
  // makes the join between the stair above and the course below one body rather than two that touch.
  const pool = spring.pool
    ? rectCells({ x: spring.at.x - half, y: spring.at.y - half, w: SPRING_SIDE, h: SPRING_SIDE })
    : [spring.at];
  if (spring.pool && !cellsFit(t, grass, flat, pool, spring.tier)) return null;
  floodCells(t, pool, spring.tier);

  const cells: MacroCoord[] = [...pool];
  const spine: MacroCoord[] = [spring.at];
  const reaches: StoryReach[] = [{ tier: spring.tier, cells: [...pool] }];
  const falls: StoryFall[] = [];
  const bays: Rect[] = [];

  // A COURSE HAS A DIRECTION, and a meander is a departure from it rather than a random walk. `flow`
  // is the way the island falls away, re-read at every step down; `dir` is what the head is doing
  // now, and it returns to the flow when a bend has run its length. Without the distinction a
  // sequence of sharp bends turns the stream back uphill and the story never finds its step.
  let flow = downhill(t, grass, spring.at, spring.tier);
  let dir = flow;
  // The head starts at the pool's DOWNSTREAM edge, so its first step leaves the spring rather than
  // asking to flood a cell the spring already holds.
  let at = { x: spring.at.x + dir[0] * half, y: spring.at.y + dir[1] * half };
  let tier = spring.tier;
  let width = 2;
  // STRAIGHTNESS IS READ OFF THE SPINE, not off the heading. A bend the ground refuses leaves the
  // head running the way it already was, so a heading counter says the course turned where the
  // drawn line did not — and the bound this module declares is about the line.
  let lastStep: Vec | null = null;
  let sinceTurn = 0, sinceBay = 0, straight = 0, bayLeft = 0, bendLeft = 0, step = 0, detours = 0;

  while (step < budget) {
    if (bendLeft > 0) bendLeft--;
    else if (dir !== flow) { dir = flow; sinceTurn = 0; }
    else if (sinceTurn >= drawTurn(seed, step) || straight >= STRAIGHT_MAX - 1) {
      dir = hash01(seed ^ 0x5721, step) < 0.5 ? left(flow) : right(flow);
      bendLeft = BEND_RUN.min + Math.floor(hash01(seed ^ 0x18b3, step) * (BEND_RUN.max - BEND_RUN.min + 1));
      sinceTurn = 0;
    }

    // THE STEP DOWN IS TAKEN WHERE THE GROUND OFFERS IT, not where the reach runs out. A course that
    // only fell when it was blocked would run the contour of a terrace for as long as the terrace is
    // wide, which is a canal rather than a descent.
    // The LIP is the cell ahead and the drop is the one beyond it, which is where a reach has to
    // stop: its own cells may not come within one cell of lower ground without showing a face.
    const lip = { x: at.x + flow[0], y: at.y + flow[1] };
    const beyond = { x: lip.x + flow[0], y: lip.y + flow[1] };
    const drop = surfaceOf(t, beyond.x, beyond.y);
    const overCliff = surfaceOf(t, lip.x, lip.y) === tier && drop >= 0 && drop < tier
      && beyond.x >= 0 && beyond.y >= 0 && beyond.x < t.width && beyond.y < t.height
      && grass[flatIndex(beyond.x, beyond.y, t.width)] === 1;
    const hop = overCliff
      ? tryFall(t, grass, flat, at, flow, Math.min(width, STREAM_WIDTH.max), tier)
      : null;
    if (hop) {
      floodCells(t, hop.band, tier);
      floodCells(t, hop.landing, hop.landsAt);
      cells.push(...hop.band, ...hop.landing);
      falls.push({ rect: boundsOfCells(hop.band), tier, landsAt: hop.landsAt, main: true });
      tier = hop.landsAt;
      reaches.push({ tier, cells: [...hop.landing] });
      at = hop.at;
      flow = downhill(t, grass, at, tier, flow);
      dir = hop.dir;
      bendLeft = 0;
      width = hop.landing.length;
      // A FALL DOES NOT RESET THE RUN. It moves the head two cells the way it was already going, so
      // counting from zero after one would let the drawn line run twice the bound with a waterfall
      // in the middle of it.
      straight = lastStep && hop.dir[0] === lastStep[0] && hop.dir[1] === lastStep[1] ? straight + 2 : 2;
      lastStep = hop.dir;
      sinceTurn = 0;
      spine.push(at);
      step += 2;
      continue;
    }

    const wanted = widthWanted(shape, t.width, at, width, sinceBay, bayLeft, seed, step);
    const moved = advance({
      t, grass, flat, at, dir, flow, tier, width: wanted.width, seed, step,
      ...(straight >= STRAIGHT_MAX - 1 && lastStep ? { banned: lastStep } : {}),
    })
      // A DETOUR IS NOT A FAILURE. The reservation holds the streets, the buildings and their
      // doorsteps, so a course crossing a town meets something it may not take every few cells; a
      // head that stopped at the first of them ran a third of its length and arrived nowhere. One
      // cell wide and free to turn back, bounded so a blocked course still ends rather than
      // wandering the island.
      ?? (detours < DETOUR_MAX ? detour(t, grass, flat, at, flow, tier) : null);
    if (!moved) break;
    if (moved.width === 1 && moved.dir[0] * flow[0] + moved.dir[1] * flow[1] < 0) detours++;
    floodCells(t, moved.cells, tier);
    cells.push(...moved.cells);
    spine.push(moved.at);
    reaches[reaches.length - 1]!.cells.push(...moved.cells);
    if (wanted.bay) {
      if (bayLeft === 0) bays.push(boundsOfCells(moved.cells));
      bayLeft = wanted.bayLeft;
      sinceBay = 0;
    } else { bayLeft = 0; sinceBay++; }
    const took: Vec = [moved.at.x - at.x, moved.at.y - at.y];
    straight = lastStep && took[0] === lastStep[0] && took[1] === lastStep[1] ? straight + 1 : 1;
    lastStep = took;
    sinceTurn++;
    at = moved.at;
    dir = moved.dir;
    width = moved.width;
    step++;
  }

  if (cells.length < COURSE_MIN) return null;

  // The arrival. A course that ran out at the coast has one; every other course is given the pond it
  // was heading for, and a course that gets neither is not a story.
  const sea = touchesSea(t, grass, at, tier);
  let pond: StoryPond | null = null;
  if (!sea) {
    pond = arrive(input, spine, at, dir, tier);
    if (!pond) return null;
    cells.push(...pond.cells);
  }

  const tributary = richness >= TRIBUTARY_FROM ? cutTributary(input, spine, reaches, cells) : [];
  cells.push(...tributary);
  falls.push(...companionFalls(input, falls));

  return {
    source: { at: spring.at, tier: spring.tier },
    spine, reaches, falls, pond, ending: sea ? 'sea' : 'pond', tributary, bays, cells,
  };
}

/**
 * The direction the ISLAND falls away in: the cardinal toward the NEAREST island ground standing
 * below `tier`.
 *
 * Read as a nearest-lower search rather than as a slope. A terrace is FLAT, so every ray off it
 * scores the same for as far as the terrace is wide, and a slope reading on one answers with
 * whichever axis the tie-break happens to name — measured, a course sent that way ran the width of
 * its own plate and finished where it started. The sea is not lower ground: a cell off the buildable
 * island carries no terrain and so reads as ground, and a course sent at it has no terrace left to
 * descend.
 */
function downhill(t: TerrainPlan, grass: Uint8Array, at: MacroCoord, tier: number, prefer?: Vec): Vec {
  let best: Vec | null = null, bestAt = DOWNHILL_LOOK + 1;
  for (const d of DIRS) {
    const p = perp(d);
    for (let k = 1; k <= DOWNHILL_LOOK && k <= bestAt; k++) {
      // A CONE, not a ray: the lower ground a course is heading for is rarely straight ahead, and a
      // ray off a flat terrace answers the same for every direction until it leaves the plate.
      const spread = k >> 1;
      let found = false;
      for (let j = -spread; j <= spread && !found; j++) {
        const x = at.x + d[0] * k + p[0] * j, y = at.y + d[1] * k + p[1] * j;
        if (x < 0 || y < 0 || x >= t.width || y >= t.height) continue;
        if (!grass[flatIndex(x, y, t.width)] || surfaceOf(t, x, y) >= tier) continue;
        found = true;
      }
      if (!found) continue;
      // The heading the course already had wins a tie, so a descent does not swing across the map
      // between one step and the next.
      const better = k < bestAt || (prefer && d[0] === prefer[0] && d[1] === prefer[1]);
      if (better) { bestAt = k; best = d; }
      break;
    }
  }
  return best ?? prefer ?? DIRS[1]!;
}

interface AdvanceInput {
  t: TerrainPlan;
  grass: Uint8Array;
  flat: Uint8Array;
  at: MacroCoord;
  dir: Vec;
  /** The way the island falls away. A heading that points back up it is never offered. */
  flow: Vec;
  /** A step the course has already taken too many of in a row, and may not take again here. */
  banned?: Vec;
  tier: number;
  width: number;
  seed: number;
  step: number;
}

/**
 * One step of a reach: the cross-section moved one cell on, along the heading or turned off it.
 *
 * The heading the caller set is offered first and the two sides after it, and NO OPTION POINTS BACK
 * UP THE FLOW — a course that may turn through 180° is a random walk, and the one it produced ran
 * the length of its own terrace and finished uphill of its spring.
 *
 * The step is measured in fresh cells: where a turn's new section overlaps water the course already
 * laid, the overlap is the body, not a refusal. That is what keeps the whole course 4-CONNECTED — a
 * turn moves the section by one cell, so its own corner cells sit diagonally from the last section
 * and would otherwise read as separate bodies.
 */
function advance(
  input: AdvanceInput,
): { at: MacroCoord; dir: Vec; cells: MacroCoord[]; width: number } | null {
  const { t, grass, flat, at, dir, flow, tier, width, seed, step, banned } = input;
  const bendLeft = hash01(seed ^ 0x5721, step) < 0.5;
  const first = bendLeft ? left(dir) : right(dir);
  const second = bendLeft ? right(dir) : left(dir);
  const options = [{ dir }, { dir: first }, { dir: second }].filter((o) => o.dir[0] * flow[0] + o.dir[1] * flow[1] >= 0
    && !(banned && o.dir[0] === banned[0] && o.dir[1] === banned[1]));

  for (const option of options) {
    const next = { x: at.x + option.dir[0], y: at.y + option.dir[1] };
    for (let w = width; w >= STREAM_WIDTH.min; w--) {
      const whole = section(next, option.dir, w);
      const fresh: MacroCoord[] = [];
      let clash = false;
      for (const c of whole) {
        if (c.x < 0 || c.y < 0 || c.x >= t.width || c.y >= t.height) { clash = true; break; }
        const level = t.water[flatIndex(c.x, c.y, t.width)]!;
        if (level < 0) fresh.push(c);
        else if (level !== tier) { clash = true; break; }
      }
      if (clash || fresh.length === 0) continue;
      if (!cellsFit(t, grass, flat, fresh, tier)) continue;
      return { at: next, dir: option.dir, cells: fresh, width: w };
    }
  }
  return null;
}

/** A single cell in any direction the ground still carries, when nothing the reach wanted fits. */
function detour(
  t: TerrainPlan, grass: Uint8Array, flat: Uint8Array, at: MacroCoord, flow: Vec, tier: number,
): { at: MacroCoord; dir: Vec; cells: MacroCoord[]; width: number } | null {
  // Down the flow first, then across it, then back: a detour is still trying to get somewhere.
  const order: Vec[] = [flow, left(flow), right(flow), [-flow[0], -flow[1]]];
  for (const d of order) {
    const next = { x: at.x + d[0], y: at.y + d[1] };
    if (!freeAt(t, grass, flat, next.x, next.y, tier)) continue;
    if (!cellsFit(t, grass, flat, [next], tier)) continue;
    return { at: next, dir: d, cells: [next], width: 1 };
  }
  return null;
}

/** The width the districts under the head ask for: narrow beside a home, a BAY where a park stands
 *  and one is due, and a one-cell wander between districts — the local narrowing and widening the
 *  supplement asks for, and what the eval reads as width variance. */
function widthWanted(
  shape: Int8Array, W: number, at: MacroCoord, width: number, sinceBay: number, bayLeft: number,
  seed: number, step: number,
): { width: number; bay: boolean; bayLeft: number } {
  if (bayLeft > 0) return { width: BAY_WIDTH, bay: true, bayLeft: bayLeft - 1 };
  const want = shape[flatIndex(at.x, at.y, W)] ?? 0;
  if (want < 0) return { width: STREAM_WIDTH.min, bay: false, bayLeft: 0 };
  if (want > 0 && sinceBay >= BAY_GAP) return { width: BAY_WIDTH, bay: true, bayLeft: BAY_RUN - 1 };
  const roll = hash01(seed ^ 0x2b7d, step * 13);
  const next = roll < 0.28 ? width - 1 : roll > 0.72 ? width + 1 : width;
  return {
    width: Math.max(STREAM_WIDTH.min, Math.min(STREAM_WIDTH.max, next)), bay: false, bayLeft: 0,
  };
}

/** The cross-section of a course of `width` centred at `at`, across `dir`. */
function section(at: MacroCoord, dir: Vec, width: number): MacroCoord[] {
  const p = perp(dir);
  const lo = (width - 1) >> 1;
  const out: MacroCoord[] = [];
  for (let k = -lo; k <= width - 1 - lo; k++) out.push({ x: at.x + p[0] * k, y: at.y + p[1] * k });
  return out;
}

/** How many steps the course runs before the next sharp bend. */
function drawTurn(seed: number, step: number): number {
  return TURN_EVERY.min + Math.floor(hash01(seed ^ 0x3fc1, step) * (TURN_EVERY.max - TURN_EVERY.min + 1));
}

// --- the falls ----------------------------------------------------------------------------------

/**
 * A fall on the lip ahead of the head: the band, its landing, and where the course carries on.
 *
 * The BAND is the row of lip cells still standing at `tier`, with a cell of terrace left at each
 * perpendicular end as V-WTR-02's caps — mountain at exactly the band's own tier, which is what a
 * cap has to be; a neighbour standing a tier HIGHER is not one. The LANDING is the row it pours
 * onto, read for uniformity across the band and its caps first (V-WTR-03) and then flooded at its
 * own level, so the fall arrives in water rather than on a shelf. A landing several tiers down is a
 * plunge, and legal for the same two reasons.
 */
function tryFall(
  t: TerrainPlan, grass: Uint8Array, flat: Uint8Array, at: MacroCoord, dir: Vec, width: number,
  tier: number,
): { band: MacroCoord[]; landing: MacroCoord[]; landsAt: number; at: MacroCoord; dir: Vec } | null {
  if (tier < 1) return null;
  for (const d of [dir, left(dir), right(dir), [-dir[0], -dir[1]] as Vec]) {
    for (let w = width; w >= 1; w--) {
      const lip = { x: at.x + d[0], y: at.y + d[1] };
      const band = section(lip, d, w);
      if (!atTier(t, grass, flat, boundsOfCells(band), tier)) continue;
      const p = perp(d);
      const lo = (w - 1) >> 1;
      const caps = [
        { x: lip.x + p[0] * (-lo - 1), y: lip.y + p[1] * (-lo - 1) },
        { x: lip.x + p[0] * (w - lo), y: lip.y + p[1] * (w - lo) },
      ];
      if (!caps.every((c) => capsAt(t, grass, c, tier))) continue;
      const apron = { x: lip.x + d[0], y: lip.y + d[1] };
      const strip = boundsOfCells([
        ...section(apron, d, w),
        { x: apron.x + p[0] * (-lo - 1), y: apron.y + p[1] * (-lo - 1) },
        { x: apron.x + p[0] * (w - lo), y: apron.y + p[1] * (w - lo) },
      ]);
      if (!uniform(t, grass, strip)) continue;
      const landsAt = surfaceOf(t, apron.x, apron.y);
      if (landsAt < 0 || landsAt >= tier) continue;
      const landing = section(apron, d, w);
      if (!cellsFit(t, grass, flat, landing, landsAt)) continue;
      return { band, landing, landsAt, at: apron, dir: d };
    }
  }
  return null;
}

/** Whether a cell is standing mountain at exactly `tier`: a cap. */
function capsAt(t: TerrainPlan, grass: Uint8Array, c: MacroCoord, tier: number): boolean {
  if (c.x < 0 || c.y < 0 || c.x >= t.width || c.y >= t.height) return false;
  const i = flatIndex(c.x, c.y, t.width);
  return grass[i] === 1 && t.water[i]! < 0 && t.tier[i] === tier;
}

/**
 * The narrower fall beside the main one (一个主瀑布加一个较窄的小瀑布).
 *
 * It is cut AFTER the course, along the same lip and staggered a few cells to one side, and only
 * where it pours straight into water the course already laid — a fall onto nothing is the one thing
 * the supplement rules out. One cell wide, so it reads as the companion rather than as a second main
 * fall.
 */
function companionFalls(input: StoryInput, mains: readonly StoryFall[]): StoryFall[] {
  const { t, grass, flat, seed } = input;
  const out: StoryFall[] = [];
  for (const [k, main] of mains.entries()) {
    if (out.length >= COMPANION_MAX) break;
    const alongX = main.rect.w >= main.rect.h;
    const gap = COMPANION_GAP.min
      + Math.floor(hash01(seed ^ 0xc0a1, k) * (COMPANION_GAP.max - COMPANION_GAP.min + 1));
    for (const side of [1, -1] as const) {
      const at = alongX
        ? { x: side > 0 ? main.rect.x + main.rect.w - 1 + gap : main.rect.x - gap, y: main.rect.y }
        : { x: main.rect.x, y: side > 0 ? main.rect.y + main.rect.h - 1 + gap : main.rect.y - gap };
      const flows: Vec[] = alongX ? [[0, 1], [0, -1]] : [[1, 0], [-1, 0]];
      let cut: number | null = null;
      for (const flow of flows) {
        cut = companionAt(t, grass, flat, at, flow, main.tier);
        if (cut !== null) break;
      }
      if (cut === null) continue;
      floodCells(t, [at], main.tier);
      out.push({ rect: { x: at.x, y: at.y, w: 1, h: 1 }, tier: main.tier, landsAt: cut, main: false });
      break;
    }
  }
  return out;
}

/** The level a 1-wide companion at `at` would pour onto, or null where it would pour onto anything
 *  but the story's own water, or where its own caps and back are not standing. */
function companionAt(
  t: TerrainPlan, grass: Uint8Array, flat: Uint8Array, at: MacroCoord, flow: Vec, tier: number,
): number | null {
  if (!freeAt(t, grass, flat, at.x, at.y, tier)) return null;
  const p = perp(flow);
  const caps = [{ x: at.x + p[0], y: at.y + p[1] }, { x: at.x - p[0], y: at.y - p[1] }];
  if (!caps.every((c) => capsAt(t, grass, c, tier))) return null;
  // Behind it must stand at the band's own tier, or the companion shows a second, uncapped face.
  if (surfaceOf(t, at.x - flow[0], at.y - flow[1]) < tier) return null;
  const front = { x: at.x + flow[0], y: at.y + flow[1] };
  if (front.x < 0 || front.y < 0 || front.x >= t.width || front.y >= t.height) return null;
  const level = surfaceOf(t, front.x, front.y);
  if (level < 0 || level >= tier) return null;
  if (t.water[flatIndex(front.x, front.y, t.width)] !== level) return null;
  const strip = boundsOfCells([
    front, { x: front.x + p[0], y: front.y + p[1] }, { x: front.x - p[0], y: front.y - p[1] },
  ]);
  return uniform(t, grass, strip) ? level : null;
}

// --- the arrival --------------------------------------------------------------------------------

/** Whether the head stands at ground level against the coast: the course has arrived at the sea. */
function touchesSea(t: TerrainPlan, grass: Uint8Array, at: MacroCoord, tier: number): boolean {
  if (tier !== 0) return false;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const x = at.x + dx, y = at.y + dy;
      if (x < 0 || y < 0 || x >= t.width || y >= t.height) continue;
      if (!grass[flatIndex(x, y, t.width)]) return true;
    }
  }
  return false;
}

/**
 * The arrival, tried at the head and then BACK along the last reach.
 *
 * A pond wants a clear patch of one terrace, and the cell a course happens to stop at is the cell
 * that had none — that is why the course stopped there. Measured on real designed ground, asking only
 * at the head refused the pond on every seed, and with it the whole story. So the last reach is
 * walked backwards a cell at a time, and each position is offered the four directions: the pond only
 * has to touch the course, not lie ahead of it.
 */
function arrive(
  input: StoryInput, spine: readonly MacroCoord[], head: MacroCoord, dir: Vec, tier: number,
): StoryPond | null {
  const tries: { at: MacroCoord; dir: Vec }[] = [{ at: head, dir }];
  for (let k = spine.length - 1; k > 0 && tries.length <= POND_BACKTRACK; k--) {
    const a = spine[k - 1]!, b = spine[k]!;
    if (input.t.water[flatIndex(b.x, b.y, input.t.width)] !== tier) break;
    const step: Vec = [Math.sign(b.x - a.x), Math.sign(b.y - a.y)];
    tries.push({ at: b, dir: step[0] === 0 && step[1] === 0 ? dir : step });
  }
  for (const each of tries) {
    for (const d of [each.dir, left(each.dir), right(each.dir), [-each.dir[0], -each.dir[1]] as Vec]) {
      const pond = cutPond(input, each.at, d, tier);
      if (pond) return pond;
    }
  }
  return null;
}

/**
 * The pond the course arrives in: one of four shapes, framed by the terrace it is cut into.
 *
 * The shape is drawn as a cell set and the whole set is judged at once, so a lozenge is a lozenge or it
 * is nothing — a pond trimmed side by side comes back a rectangle. What IS negotiable is its span: the
 * box shrinks a cell at a time until the terrace carries it.
 */
function cutPond(input: StoryInput, at: MacroCoord, dir: Vec, tier: number): StoryPond | null {
  const { t, grass, flat, richness, seed } = input;
  const first = Math.floor(hash01(seed ^ 0x9d13, tier + 1) * POND_SHAPES.length);
  const span = Math.round(lerp(POND_SPAN.min, POND_SPAN.max, richness));
  for (let w = span; w >= POND_MIN; w--) {
    // EVERY SHAPE IS OFFERED AT EACH SPAN, the seed's own first. Trying one shape down to its
    // smallest span before the next would make the span, not the composition, decide what a map's
    // arrival looks like.
    for (let k = 0; k < POND_SHAPES.length; k++) {
      const shape = POND_SHAPES[(first + k) % POND_SHAPES.length]!;
      const h = Math.max(POND_MIN, Math.round(w * (shape === 'diamond' ? 1 : 0.7)));
      // The box opens AHEAD of the head and centred across the flow, so the course runs into it.
      const rect: Rect = dir[0] !== 0
        ? { x: dir[0] > 0 ? at.x + 1 : at.x - w, y: at.y - ((h - 1) >> 1), w, h }
        : { x: at.x - ((w - 1) >> 1), y: dir[1] > 0 ? at.y + 1 : at.y - h, w, h };
      const cells = pondCells(shape, rect);
      if (cells.length < POND_MIN * 2) continue;
      if (!cellsFit(t, grass, flat, cells, tier)) continue;
      if (!cells.some((c) => touchesCourse(t, c, tier))) continue;
      floodCells(t, cells, tier);
      return { shape, rect: boundsOfCells(cells), tier, cells };
    }
  }
  return null;
}

const POND_SHAPES: readonly PondShape[] = ['lozenge', 'u-moat', 'islet', 'diamond'];

/** Whether a candidate pond cell is 4-adjacent to water the course already laid, so the pond and the
 *  stream come out as ONE body rather than as a pond beside a stream. */
function touchesCourse(t: TerrainPlan, c: MacroCoord, tier: number): boolean {
  for (const d of DIRS) {
    const x = c.x + d[0], y = c.y + d[1];
    if (x < 0 || y < 0 || x >= t.width || y >= t.height) continue;
    if (t.water[flatIndex(x, y, t.width)] === tier) return true;
  }
  return false;
}

/** The four pond shapes, as cell sets inside a box. Every one is symmetric about the box's own axes,
 *  which is what makes a pond read as composed rather than as a blob. */
export function pondCells(shape: PondShape, rect: Rect): MacroCoord[] {
  const out: MacroCoord[] = [];
  const cx = (rect.w - 1) / 2, cy = (rect.h - 1) / 2;
  for (let y = 0; y < rect.h; y++) {
    for (let x = 0; x < rect.w; x++) {
      const nx = Math.abs(x - cx) / Math.max(0.5, cx), ny = Math.abs(y - cy) / Math.max(0.5, cy);
      let take: boolean;
      switch (shape) {
        case 'diamond':
        case 'lozenge':
          take = nx + ny <= 1.05;
          break;
        case 'islet':
          // A lozenge with a dry islet standing in the middle of it.
          take = nx + ny <= 1.15 && nx + ny >= 0.45;
          break;
        default:
          // The U-moat: water down two sides and across one end, holding a dry island.
          take = x === 0 || x === rect.w - 1 || y === rect.h - 1;
          break;
      }
      if (take) out.push({ x: rect.x + x, y: rect.y + y });
    }
  }
  return out;
}

// --- the tributary ------------------------------------------------------------------------------

/**
 * A short branch that leaves the course and rejoins it (一条主河可以分出短小支流，再汇回去).
 *
 * It is 1 wide and it is kept only where it REJOINS: a branch that wanders off and stops is a second
 * body dressed as a story. So the cells are gathered first and flooded only once the join is found.
 */
function cutTributary(
  input: StoryInput, spine: readonly MacroCoord[], reaches: readonly StoryReach[],
  laid: readonly MacroCoord[],
): MacroCoord[] {
  const { t, grass, flat, seed } = input;
  if (spine.length < 8) return [];
  const own = new Set(laid.map((c) => flatIndex(c.x, c.y, t.width)));
  const start = spine[Math.max(1, Math.floor(spine.length * 0.35))]!;
  const tier = reaches.find((r) => r.cells.some((c) => c.x === start.x && c.y === start.y))?.tier
    ?? reaches[0]!.tier;
  for (const firstDir of DIRS) {
    let at = { x: start.x + firstDir[0], y: start.y + firstDir[1] };
    let dir = firstDir;
    const branch: MacroCoord[] = [];
    for (let k = 0; k < TRIBUTARY_LENGTH; k++) {
      const i = flatIndex(at.x, at.y, t.width);
      if (k > 2 && own.has(i) && branch.length >= 4) {
        floodCells(t, branch, tier);
        return branch;
      }
      if (!freeAt(t, grass, flat, at.x, at.y, tier)) break;
      const probe = [...branch, at];
      if (!fitsBeside(t, grass, flat, probe, own, tier)) break;
      branch.push(at);
      dir = hash01(seed ^ 0x77b1, k) < 0.35 ? (k % 2 === 0 ? left(dir) : right(dir)) : dir;
      at = { x: at.x + dir[0], y: at.y + dir[1] };
    }
  }
  return [];
}

/** `cellsFit` for a branch: the course's own water counts as ground at the branch's level, since it
 *  stands at exactly that level and is what the branch is going to rejoin. */
function fitsBeside(
  t: TerrainPlan, grass: Uint8Array, flat: Uint8Array, cells: readonly MacroCoord[],
  own: ReadonlySet<number>, tier: number,
): boolean {
  const mine = new Set(cells.map((c) => flatIndex(c.x, c.y, t.width)));
  for (const c of cells) {
    if (!freeAt(t, grass, flat, c.x, c.y, tier)) return false;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = c.x + dx, ny = c.y + dy;
        if (nx < 0 || ny < 0 || nx >= t.width || ny >= t.height) return false;
        const i = flatIndex(nx, ny, t.width);
        if (mine.has(i) || own.has(i)) continue;
        if (surfaceOf(t, nx, ny) < tier) return false;
      }
    }
  }
  return true;
}

// --- small helpers ------------------------------------------------------------------------------

function rectCells(rect: Rect): MacroCoord[] {
  const out: MacroCoord[] = [];
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    for (let x = rect.x; x < rect.x + rect.w; x++) out.push({ x, y });
  }
  return out;
}

/** A stable value in [0,1) per (seed, index). */
function hash01(seed: number, i: number): number {
  let h = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ (i + 0x165667b1), 0xc2b2ae35);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

const lerp = (a: number, b: number, v: number): number => a + (b - a) * (v < 0 ? 0 : v > 1 ? 1 : v);
