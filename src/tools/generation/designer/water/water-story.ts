/**
 * Plans one connected watercourse from a high-ground spring to a pond or coast. Reaches stay within
 * a uniform tier; falls use supported lips and uniform landing rows. Failed courses restore every
 * touched cell, and tributaries commit only when they rejoin. Richness changes length and feature
 * count. The result is pure and deterministic for its terrain, masks, and seed.
 */
import { stepDistance } from '../../../../core/grid/cell-sets';
import { flatIndex, type Rect } from '../../../../core/grid/rect';
import { NEIGHBORS4_ESWN } from '../../../../core/grid/directions';
import { getFootprint } from '../../../../core/grid/footprint';
import type { MacroCoord } from '../../../../core/model/types';
import type { TerrainPlan } from '../../terrain-plan/types';
import type { DesignPlan, RegionPlan } from '../types';
import { ANCHOR_KINDS, STREAM_BAY_THEMES } from '../themes';
import { atTier, boundsOfCells, cellsFit, floodCells, freeAt, surfaceOf, type WaterGround } from './water-cut';
import { seedHash01 } from '../../../../core/base/hash';
import { lerpClamped } from '../../../../core/base/math';
import { companionFalls, cutTributary, tryFall } from './story-falls';
import { type StoryFall, type StoryInput, type StoryPond, type StoryReach, type Vec, type WaterStory, left, perp, right, section } from './story-model';
import { arrive, touchesSea } from './story-pond';

// --- tunables -----------------------------------------------------------------------------------

/** How many steps the course runs at richness 0 and 1. A water spine, a banded ladder, runs 24 rows
 *  and a cascade stair 21; a course that crosses the planet is the two of them joined. */
const COURSE_LENGTH = { min: 26, max: 120 } as const;
/** The stream's width, and the width a bay widens to where it passes a park. A trough reads 2 to 4
 *  cells across and a water spine 1. */
const STREAM_WIDTH = { min: 1, max: 3 } as const;
const BAY_WIDTH = 5;
/** How many steps a bay stays open, and the fewest steps of course between two of them. */
const BAY_RUN = 5;
const BAY_GAP = 16;
/** How often the course turns: a sharp bend every `TURN_EVERY` steps or so, a gentle drift between.
 *  A long straight run is ruled out: no stretch of the finished course runs straight past
 *  `STRAIGHT_MAX`. */
const TURN_EVERY = { min: 5, max: 12 } as const;
/** How far a bend runs before the head returns to the flow: the amplitude of the meander. */
const BEND_RUN = { min: 3, max: 7 } as const;
const STRAIGHT_MAX = 14;
/** The side of the spring pool the course leaves from. */
const SPRING_SIDE = 3;
/** The fewest cells a course must lay before it is a story rather than a puddle. */
const COURSE_MIN = 12;
/** How many springs are tried before the planet is left dry. The first course that arrives is kept,
 *  so the later tries only run on a planet whose highest springs all fail. */
const SPRING_TRIES = 16;
/** How far a spring looks for the step it is going to fall down, and how much of its distance from
 *  the coast counts in its favour. */
const FALL_LOOKAHEAD = 14;
const SPRING_INLAND = 16;
/** How far the head looks for lower ground when it asks which way the planet falls away. */
const DOWNHILL_LOOK = 40;
/** How many times a blocked head may step aside before the course gives up. */
const DETOUR_MAX = 24;
/** Below this richness the course carries no tributary. */
const TRIBUTARY_FROM = 0.4;

// --- the course ---------------------------------------------------------------------------------

/**
 * Cut the planet's water story, or leave it dry.
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

/** Where a course may start: a spring, which cuts its own pool, or a mouth, which is water that is
 *  already standing and only has to be flowed on from. */
interface Source { at: MacroCoord; tier: number; pool: boolean }

/** Chebyshev distance from every cell to the walk's own trace, or null where no walk was planned.
 *  The source is drawn toward it: a story a visitor never passes is one nobody sees. */
function walkField(input: StoryInput): Int16Array | null {
  const trace = input.line?.trace ?? [];
  if (trace.length === 0) return null;
  const W = input.t.width, H = input.t.height;
  return stepDistance(trace.map((c) => flatIndex(c.x, c.y, W)), W, H, true);
}

/** A stream's width rule: narrow beside homes, widening into a bay in a park. Every other place leaves it as it runs. */
function regionWater(region: RegionPlan): -1 | 0 | 1 {
  if (region.kind === 'theme') return STREAM_BAY_THEMES.has(region.themeId) ? 1 : 0;
  return ANCHOR_KINDS[region.kind].narrowsStream ? -1 : 0;
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

/** The springs worth trying: a `SPRING_SIDE` pool of untouched terrace high on the planet with
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
      if (!cellsFit(t, grass, flat, getFootprint(rect.x, rect.y, rect.w, rect.h), tier)) continue;
      const near = walk ? Math.min(40, walk[i]!) : 0;
      // A spring wants height first, then the walk passing near, then room around it: one on the
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

/** Chebyshev distance from every cell to the nearest one off the buildable planet: how far inland it
 *  stands. */
function inlandField(t: TerrainPlan, grass: Uint8Array): Int16Array {
  const seeds: number[] = [];
  for (let i = 0; i < grass.length; i++) if (!grass[i]) seeds.push(i);
  return stepDistance(seeds, t.width, t.height, true);
}

/** Whether planet ground within a short reach of (x, y) stands below `tier`: the step the course is
 *  going to look for. The sea is not one — a spring on the coastal rim would find the drop off the
 *  map edge and have nowhere to run. */
function hasFallAway(t: TerrainPlan, grass: Uint8Array, x: number, y: number, tier: number): boolean {
  for (const d of NEIGHBORS4_ESWN) {
    for (let k = 2; k <= FALL_LOOKAHEAD; k++) {
      const nx = x + d[0] * k, ny = y + d[1] * k;
      if (nx < 0 || ny < 0 || nx >= t.width || ny >= t.height) break;
      if (!grass[flatIndex(nx, ny, t.width)]) break;
      if (surfaceOf(t, nx, ny) < tier) return true;
    }
  }
  return false;
}

/** The course at the moment it fell from a reach: the lengths of everything it had laid, and where
 *  its head stood. */
interface ReachEnd {
  journal: number; cells: number; spine: number; reaches: number; reachCells: number;
  falls: number; bays: number; at: MacroCoord; dir: Vec; tier: number; width: number;
}

/** The whole course from one spring, or null where it arrived nowhere. */
function runCourse(
  input: StoryInput, spring: Source, shape: Int8Array,
): WaterStory | null {
  const { t, grass, flat, richness, seed } = input;
  const budget = Math.round(lerpClamped(COURSE_LENGTH.min, COURSE_LENGTH.max, richness));
  const half = spring.pool ? SPRING_SIDE >> 1 : 0;

  // A mouth is already water, so its own cell is the course's first: it is counted in, which is what
  // makes the join between the stair above and the course below one body rather than two that touch.
  const pool = spring.pool
    ? getFootprint(spring.at.x - half, spring.at.y - half, SPRING_SIDE, SPRING_SIDE)
    : [spring.at];
  if (spring.pool && !cellsFit(t, grass, flat, pool, spring.tier)) return null;
  // What every flood overwrote, so the course can be cut back to the end of an earlier reach.
  const journal: number[] = [];
  const flood = (list: readonly MacroCoord[], level: number): void => {
    for (const c of list) {
      if (c.x < 0 || c.y < 0 || c.x >= t.width || c.y >= t.height) continue;
      const i = flatIndex(c.x, c.y, t.width);
      journal.push(i, t.tier[i]!, t.water[i]!);
    }
    floodCells(t, list, level);
  };
  flood(pool, spring.tier);

  const cells: MacroCoord[] = [...pool];
  const spine: MacroCoord[] = [spring.at];
  const reaches: StoryReach[] = [{ tier: spring.tier, cells: [...pool] }];
  const falls: StoryFall[] = [];
  const bays: Rect[] = [];

  // A course has a direction, and a meander is a departure from it rather than a random walk. `flow`
  // is the way the planet falls away, re-read at every step down; `dir` is what the head is doing
  // now, and it returns to the flow when a bend has run its length. Without the distinction a
  // sequence of sharp bends turns the stream back uphill and the story never finds its step.
  let flow = downhill(t, grass, spring.at, spring.tier);
  let dir = flow;
  // The head starts at the pool's downstream edge, so its first step leaves the spring rather than
  // asking to flood a cell the spring already holds.
  let at = { x: spring.at.x + dir[0] * half, y: spring.at.y + dir[1] * half };
  let tier = spring.tier;
  let width = 2;
  // Straightness is read off the spine, not off the heading. A bend the ground refuses leaves the
  // head running the way it already was, so a heading counter says the course turned where the
  // drawn line did not — and the bound this module declares is about the line.
  let lastStep: Vec | null = null;
  let sinceTurn = 0, sinceBay = 0, straight = 0, bayLeft = 0, bendLeft = 0, step = 0, detours = 0;
  // The course as it stood at the end of each reach it fell from.
  const reachEnds: ReachEnd[] = [];

  while (step < budget) {
    if (bendLeft > 0) bendLeft--;
    else if (dir !== flow) { dir = flow; sinceTurn = 0; }
    else if (sinceTurn >= drawTurn(seed, step) || straight >= STRAIGHT_MAX - 1) {
      dir = seedHash01(seed ^ 0x5721, step) < 0.5 ? left(flow) : right(flow);
      bendLeft = BEND_RUN.min + Math.floor(seedHash01(seed ^ 0x18b3, step) * (BEND_RUN.max - BEND_RUN.min + 1));
      sinceTurn = 0;
    }

    // The step down is taken where the ground offers it, not where the reach runs out. A course that
    // only fell when it was blocked would run the contour of a terrace for as long as the terrace is
    // wide, which is a canal rather than a descent.
    // The lip is the cell ahead and the drop is the one beyond it, which is where a reach has to
    // stop: its own cells may not come within one cell of lower ground without showing a face.
    const lip = { x: at.x + flow[0], y: at.y + flow[1] };
    const beyond = { x: lip.x + flow[0], y: lip.y + flow[1] };
    const drop = surfaceOf(t, beyond.x, beyond.y);
    const overCliff = surfaceOf(t, lip.x, lip.y) === tier && drop >= 0 && drop < tier
      && beyond.x >= 0 && beyond.y >= 0 && beyond.x < t.width && beyond.y < t.height
      && grass[flatIndex(beyond.x, beyond.y, t.width)] === 1;
    const hop = overCliff
      ? tryFall({ t, grass, flat }, at, flow, Math.min(width, STREAM_WIDTH.max), tier)
      : null;
    if (hop) {
      reachEnds.push({
        journal: journal.length, cells: cells.length, spine: spine.length, reaches: reaches.length,
        reachCells: reaches[reaches.length - 1]!.cells.length, falls: falls.length, bays: bays.length,
        at, dir, tier, width,
      });
      flood(hop.band, tier);
      flood(hop.landing, hop.landsAt);
      cells.push(...hop.band, ...hop.landing);
      falls.push({ rect: boundsOfCells(hop.band), tier, landsAt: hop.landsAt, main: true });
      tier = hop.landsAt;
      reaches.push({ tier, cells: [...hop.landing] });
      at = hop.at;
      flow = downhill(t, grass, at, tier, flow);
      dir = hop.dir;
      bendLeft = 0;
      width = hop.landing.length;
      // A fall does not reset the run. It moves the head two cells the way it was already going, so
      // counting from zero after one would let the drawn line run twice the bound with a waterfall
      // in the middle of it.
      straight = lastStep && hop.dir[0] === lastStep[0] && hop.dir[1] === lastStep[1] ? straight + 2 : 2;
      lastStep = hop.dir;
      sinceTurn = 0;
      spine.push(at);
      step += 2;
      continue;
    }

    const wanted = widthWanted(shape, t.width, at, { width, sinceBay, bayLeft, seed, step });
    const moved = advance({
      t, grass, flat, at, dir, flow, tier, width: wanted.width, seed, step,
      ...(straight >= STRAIGHT_MAX - 1 && lastStep ? { banned: lastStep } : {}),
    })
      // A detour is not a failure. The reservation holds the streets, the buildings and their
      // doorsteps, so a course crossing a town meets something it may not take every few cells; a
      // head that stopped at the first of them ran a third of its length and arrived nowhere. One
      // cell wide and free to turn back, bounded so a blocked course still ends rather than
      // wandering the planet.
      ?? (detours < DETOUR_MAX ? detour({ t, grass, flat }, at, flow, tier) : null);
    if (!moved) break;
    if (moved.width === 1 && moved.dir[0] * flow[0] + moved.dir[1] * flow[1] < 0) detours++;
    flood(moved.cells, tier);
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

  // The arrival. A course that ran out at the coast has one; every other course is given the pond it
  // was heading for. Where its last reach has no room for one (a ledge between a step and a street),
  // the course is cut back to the end of the reach before it and arrives there instead; a course that
  // arrives nowhere is not a story.
  const sea = touchesSea(t, grass, at, tier);
  let pond: StoryPond | null = null;
  for (;;) {
    // A wide spring can meet the area floor before the course has travelled beyond its own banks.
    if (cells.length < COURSE_MIN || (falls.length === 0 && spine.length <= width * 2)) return null;
    if (sea) break;
    pond = arrive(input, spine, at, dir, tier);
    if (pond) break;
    const end = reachEnds.pop();
    if (!end) return null;
    for (let k = journal.length - 3; k >= end.journal; k -= 3) {
      const i = journal[k]!;
      t.tier[i] = journal[k + 1]!;
      t.water[i] = journal[k + 2]!;
    }
    journal.length = end.journal;
    cells.length = end.cells; spine.length = end.spine; reaches.length = end.reaches;
    reaches[reaches.length - 1]!.cells.length = end.reachCells;
    falls.length = end.falls; bays.length = end.bays;
    at = end.at; dir = end.dir; tier = end.tier; width = end.width;
  }
  if (pond) cells.push(...pond.cells);

  const tributary = richness >= TRIBUTARY_FROM ? cutTributary(input, spine, reaches, cells) : [];
  cells.push(...tributary);
  falls.push(...companionFalls(input, falls));

  return {
    source: { at: spring.at, tier: spring.tier },
    spine, reaches, falls, pond, ending: sea ? 'sea' : 'pond', tributary, bays, cells,
  };
}

/**
 * The direction the planet falls away in: the cardinal toward the nearest planet ground standing
 * below `tier`.
 *
 * Read as a nearest-lower search rather than as a slope. A terrace is flat, so every ray off it
 * scores the same for as far as the terrace is wide, and a slope reading on one answers with
 * whichever axis the tie-break happens to name, so a course can run the width of its own plate and
 * finish where it started. The sea is not lower ground: a cell off the buildable
 * planet carries no terrain and so reads as ground, and a course sent at it has no terrace left to
 * descend.
 */
function downhill(t: TerrainPlan, grass: Uint8Array, at: MacroCoord, tier: number, prefer?: Vec): Vec {
  let best: Vec | null = null, bestAt = DOWNHILL_LOOK + 1;
  for (const d of NEIGHBORS4_ESWN) {
    const p = perp(d);
    for (let k = 1; k <= DOWNHILL_LOOK && k <= bestAt; k++) {
      // A cone, not a ray: the lower ground a course is heading for is rarely straight ahead, and a
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
  return best ?? prefer ?? NEIGHBORS4_ESWN[1]!;
}

interface AdvanceInput {
  t: TerrainPlan;
  grass: Uint8Array;
  flat: Uint8Array;
  at: MacroCoord;
  dir: Vec;
  /** The way the planet falls away. A heading that points back up it is never offered. */
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
 * The heading the caller set is offered first and the two sides after it, and no option points back
 * up the flow — a course that may turn through 180° is a random walk, and the one it produced ran
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
  const bendLeft = seedHash01(seed ^ 0x5721, step) < 0.5;
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
  ground: WaterGround, at: MacroCoord, flow: Vec, tier: number,
): { at: MacroCoord; dir: Vec; cells: MacroCoord[]; width: number } | null {
  const { t, grass, flat } = ground;
  // Down the flow first, then across it, then back: a detour is still trying to get somewhere.
  const order: Vec[] = [flow, left(flow), right(flow), [-flow[0], -flow[1]]];
  for (const d of order) {
    const next = { x: at.x + d[0], y: at.y + d[1] };
    if (!freeAt({ t, grass, flat }, next.x, next.y, tier)) continue;
    if (!cellsFit(t, grass, flat, [next], tier)) continue;
    return { at: next, dir: d, cells: [next], width: 1 };
  }
  return null;
}

/** The width the districts under the head ask for: narrow beside a home, a bay where a park stands
 *  and one is due, and a one-cell wander between districts: the local narrowing and widening that
 *  keeps a stream from reading as a canal. */
function widthWanted(
  shape: Int8Array, W: number, at: MacroCoord,
  { width, sinceBay, bayLeft, seed, step }: { width: number; sinceBay: number; bayLeft: number; seed: number; step: number },
): { width: number; bay: boolean; bayLeft: number } {
  if (bayLeft > 0) return { width: BAY_WIDTH, bay: true, bayLeft: bayLeft - 1 };
  const want = shape[flatIndex(at.x, at.y, W)] ?? 0;
  if (want < 0) return { width: STREAM_WIDTH.min, bay: false, bayLeft: 0 };
  if (want > 0 && sinceBay >= BAY_GAP) return { width: BAY_WIDTH, bay: true, bayLeft: BAY_RUN - 1 };
  const roll = seedHash01(seed ^ 0x2b7d, step * 13);
  const next = roll < 0.28 ? width - 1 : roll > 0.72 ? width + 1 : width;
  return {
    width: Math.max(STREAM_WIDTH.min, Math.min(STREAM_WIDTH.max, next)), bay: false, bayLeft: 0,
  };
}

/** How many steps the course runs before the next sharp bend. */
function drawTurn(seed: number, step: number): number {
  return TURN_EVERY.min + Math.floor(seedHash01(seed ^ 0x3fc1, step) * (TURN_EVERY.max - TURN_EVERY.min + 1));
}
