/**
 * `stream`: a course of water walked downhill from the aim point until it reaches open water.
 *
 * GROUNDED OR NOTHING. A course that stalls on a terrace, or that never finds the sea, is reverted
 * whole and reports nothing — the generator's own rule for its terraced river, and the right one
 * here: a run of water that ends dry is a puddle on a hillside, and half a stream left behind would
 * be the thing the next apply stacks on.
 *
 * Every step is TRANSACTIONAL against the live post-stroke rules. A waterfall unit is a run of water
 * at tier E flanked by mountain caps at exactly E, dropping onto a downstream row levelled to one
 * height (V-WTR-02 containment plus V-WTR-03 uniformity); the unit's commands go in, the whole map
 * is validated, and anything short of clean rolls the attempt back before the next candidate is
 * tried. So the macro can fail to build a stream, but it cannot leave illegal water on the map.
 *
 * The body runs INSIDE the caller's stroke group and pushes no provenance of its own (see patch.ts).
 */
import { NEIGHBORS4, NEIGHBORS8, cellKey, getCell, isBuildableZone } from '../../core/model/grid-model';
import { makeRng, type Rng } from '../../core/model/rng';
import { CellZone, TerrainType, type GridState, type MacroCoord } from '../../core/model/types';
import type { MacroContext } from './context';
import { cellsChanged } from './measure';
import {
  WATER_CEILING, canBuildAt, isClean, isInterior, isWaterAt, paint, setMountain, surfaceAt,
} from './terrain';

/** A course of more hops than this has walked further than a point macro should. */
const MAX_FALLS = 6;
/** Cells of dial per hop of course. The dial is the stream's LENGTH, so it buys hops. */
const CELLS_PER_HOP = 2;
/** Widest fall the run picks, in cells across the lip. */
const RUN_MAX = 3;
/** Lips tried per hop. Each one that passes the geometry costs a whole-map validation, so the
 *  search is shallow: a hop that needs the seventh-nearest lip is not a stream the
 *  user aimed at. */
const DROP_TRIES = 6;
/** How far a channel may look for a cell it can start from when the course's foot itself cannot
 *  hold water. */
const ORIGIN_REACH = 3;
/** The tier from which a mountain owes V-MTN-03 a 3x3 base. */
const TALL_MOUNTAIN = 4;

export interface StreamInput {
  at: MacroCoord;
  radius: number;
  seed: number;
}

/** Carves the course and returns how many cells it changed. Zero means nothing was kept. */
export function carveStream(ctx: MacroContext, input: StreamInput): number {
  const laid = cellsChanged(ctx.state);
  const mark = ctx.executor.getUndoStackSize();
  if (!runCourse(ctx, input)) {
    ctx.executor.rollbackTo(mark);
    return 0;
  }
  return laid();
}

function runCourse(ctx: MacroContext, input: StreamInput): boolean {
  const start = findStart(ctx.state, input.at, input.radius);
  if (!start) return false;
  const rng = makeRng((input.seed ^ 0x51ea) >>> 0);
  let foot = start.at, tier = start.tier, falls = 0;

  // THE DIAL IS THE COURSE'S LENGTH, and this is where it is spent: a budget of hops. A course with
  // more drop to cover than hops left plunges to the valley floor instead of terracing down it, so
  // the same hillside gives one tall fall on a short setting and a staircase on a long one. It is
  // never the reason a course fails, and it does not reach the walk to open water at the bottom: a
  // stream that has come all the way down has earned the walk to the sea.
  const budget = Math.max(1, Math.min(MAX_FALLS, Math.round(input.radius / CELLS_PER_HOP)));

  while (tier >= 1 && falls < MAX_FALLS) {
    const terrace = budget - falls >= tier;
    // Whichever of the two the budget did not ask for is still the fallback, since the terrace below
    // may be too narrow to hold a landing row and a plunge needs somewhere at ground level to land.
    const hopped = hop(ctx, rng, foot, tier, terrace ? tier - 1 : 0, input.radius)
      ?? (tier >= 2 ? hop(ctx, rng, foot, tier, terrace ? 0 : tier - 1, input.radius) : null);
    if (!hopped) break;
    foot = hopped.foot;
    tier = hopped.landTier;
    falls++;
  }
  if (tier > 0) return false;
  return reachOpenWater(ctx, foot);
}

/** Where the course begins: the aim point, or the highest cell near it that can hold water at all,
 *  when the user aimed at a summit. A peak is out of reach twice over — above the ceiling, and
 *  inside its own skirt. */
function findStart(state: GridState, at: MacroCoord, radius: number): { at: MacroCoord; tier: number } | null {
  if (!usable(state, at)) return null;
  const aimed = surfaceAt(state, at.x, at.y);
  if (aimed <= WATER_CEILING && holdsWater(state, at)) return { at, tier: aimed };
  for (let tier = Math.min(aimed, WATER_CEILING); tier >= 0; tier--) {
    const c = nearest(state, at, radius, (x, y) => surfaceAt(state, x, y) === tier && holdsWater(state, { x, y }));
    if (c) return { at: c, tier };
  }
  return null;
}

interface Hop { foot: MacroCoord; landTier: number }

function hop(
  ctx: MacroContext, rng: Rng, from: MacroCoord, tier: number, landTier: number, radius: number,
): Hop | null {
  const len = 1 + rng.int(RUN_MAX);
  for (const drop of findDrops(ctx.state, from, tier, landTier, radius)) {
    const mark = ctx.executor.getUndoStackSize();
    const unit = carveUnit(ctx, drop.at, tier, drop.dir, len, landTier)
      ?? (len > 1 ? carveUnit(ctx, drop.at, tier, drop.dir, 1, landTier) : null);
    if (unit) {
      const reached = carveChannel(ctx, from, (c) => c.x === drop.at.x && c.y === drop.at.y, tier, radius, unit.caps);
      // The cell the fall lands in. Carrying on from the row BEHIND it would leave a dry cell
      // between the fall and the water below it, which reads as two streams rather than one.
      if (reached) return { foot: { x: drop.at.x + drop.dir[0], y: drop.at.y + drop.dir[1] }, landTier };
    }
    ctx.executor.rollbackTo(mark);
  }
  return null;
}

interface Drop { at: MacroCoord; dir: readonly [number, number] }

/** Dry cells at `tier` with a cardinal neighbour at `landTier` — the lips a fall can be built on —
 *  nearest first, ties broken by position so the search is deterministic. */
function findDrops(
  state: GridState, from: MacroCoord, tier: number, landTier: number, radius: number,
): Drop[] {
  const found: { drop: Drop; d: number; key: number }[] = [];
  const W = state.template.width;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const x = from.x + dx, y = from.y + dy;
      if (!usable(state, { x, y }) || surfaceAt(state, x, y) !== tier || isWaterAt(state, x, y)) continue;
      if (!holdsWater(state, { x, y })) continue;
      for (const [fx, fy] of NEIGHBORS4) {
        if (surfaceAt(state, x + fx, y + fy) !== landTier) continue;
        found.push({ drop: { at: { x, y }, dir: [fx, fy] }, d: Math.abs(dx) + Math.abs(dy), key: y * W + x });
        break;
      }
    }
  }
  found.sort((a, b) => a.d - b.d || a.key - b.key);
  return found.slice(0, DROP_TRIES).map((f) => f.drop);
}

/**
 * One waterfall unit at `at`: `len` water cells across the lip, a mountain cap at exactly `tier` at
 * either end, and the row they all pour onto levelled to `landTier`. Commits only if the whole map
 * validates; returns the caps, which the channel that feeds the unit must not route through.
 */
function carveUnit(
  ctx: MacroContext, at: MacroCoord, tier: number, dir: readonly [number, number], len: number, landTier: number,
): { caps: MacroCoord[] } | null {
  const { state, executor } = ctx;
  if (tier < 1 || tier > WATER_CEILING || landTier < 0 || landTier >= tier) return null;
  const [fx, fy] = dir;
  const px = fy, py = fx;

  const run: MacroCoord[] = [];
  for (let k = 0; k < len; k++) {
    const c = { x: at.x + px * k, y: at.y + py * k };
    if (!usable(state, c) || surfaceAt(state, c.x, c.y) !== tier || isWaterAt(state, c.x, c.y)) return null;
    if (!holdsWater(state, c)) return null;
    // The cell the run pours onto must already sit at the landing height; only the CAPS' own
    // downstream cells are levelled below, and levelling one under the water would move the drop.
    if (surfaceAt(state, c.x + fx, c.y + fy) !== landTier) return null;
    run.push(c);
  }
  const last = run[run.length - 1]!;
  const caps = [{ x: at.x - px, y: at.y - py }, { x: last.x + px, y: last.y + py }];
  if (!caps.every((c) => usable(state, c))) return null;

  const mark = executor.getUndoStackSize();
  const built = caps.every((c) => setMountain(ctx, c, tier))
    && run.every((c) => paint(ctx, [c], TerrainType.Water, tier))
    && caps.every((c) => setLanding(ctx, { x: c.x + fx, y: c.y + fy }, landTier));
  if (!built || !isClean(ctx)) {
    executor.rollbackTo(mark);
    return null;
  }
  return { caps };
}

/** Bring one downstream cell to exactly `landTier`. Water already at that height stays: that is the
 *  fall pouring into the body below, which is the legal way to join two water levels. */
function setLanding(ctx: MacroContext, c: MacroCoord, landTier: number): boolean {
  const { state } = ctx;
  if (!canBuildAt(state, c.x, c.y)) return surfaceAt(state, c.x, c.y) === landTier;
  if (isWaterAt(state, c.x, c.y, landTier)) return true;
  return setMountain(ctx, c, landTier);
}

/** The course's foot ties into whatever the map already calls water: a ground-level body, or the
 *  coast. Unbounded reach, unlike a terrace channel: the sea is wherever the planet ends, and a
 *  course that has come all the way down has earned the walk to it. */
function reachOpenWater(ctx: MacroContext, foot: MacroCoord): boolean {
  return carveChannel(ctx, foot, (c) => atMouth(ctx.state, c), 0, Infinity, []);
}

/** The course has arrived: from here nothing but the water already on the map lies between it and
 *  the sea. The second clause is the north and west coasts, where a painted block's up-left render
 *  shift makes V-ZONE-01 reserve the last strip of grass — no brush reaches it, so a river that
 *  ends beside it has gone as far as the map allows. */
function atMouth(state: GridState, c: MacroCoord): boolean {
  if (isWaterAt(state, c.x, c.y, 0)) return true;
  for (const [dx, dy] of NEIGHBORS4) {
    const n = { x: c.x + dx, y: c.y + dy };
    if (isCoast(state, n)) return true;
    if (!paintable(state, n) && NEIGHBORS4.some(([ex, ey]) => isCoast(state, { x: n.x + ex, y: n.y + ey }))) return true;
  }
  return false;
}

function isCoast(state: GridState, c: MacroCoord): boolean {
  const zone = getCell(state.cells, c.x, c.y)?.zone;
  return zone === CellZone.Void || zone === CellZone.Beach || zone === CellZone.Boundary;
}

/**
 * Dig water at `level` from `from` to the first cell `isTarget` accepts, over ground that is already
 * at that height. Water at the level is passed through unpainted, so a channel joining an existing
 * run reads as one body.
 */
function carveChannel(
  ctx: MacroContext, from: MacroCoord, isTarget: (c: MacroCoord) => boolean, level: number,
  radius: number, blocked: readonly MacroCoord[],
): boolean {
  const { state, executor } = ctx;
  const origin = channelOrigin(state, from, level);
  if (!origin) return false;
  const path = shortestPath(state, origin, isTarget, level, radius, new Set(blocked.map((c) => cellKey(c.x, c.y))));
  if (!path) return false;

  const mark = executor.getUndoStackSize();
  let painted = 0;
  for (const c of path) {
    if (isWaterAt(state, c.x, c.y, level)) continue;
    if (!paint(ctx, [c], TerrainType.Water, level)) {
      executor.rollbackTo(mark);
      return false;
    }
    painted++;
  }
  if (painted === 0) return true;
  if (!isClean(ctx)) {
    executor.rollbackTo(mark);
    return false;
  }
  return true;
}

/** Where a channel can actually start: `from` itself, or the closest cell beside it at the right
 *  height — a fall's foot can land inside a summit's skirt, or on a cell the next terrace's own
 *  surface does not reach. */
function channelOrigin(state: GridState, from: MacroCoord, level: number): MacroCoord | null {
  if (channelPassable(state, from, level)) return from;
  return nearest(state, from, ORIGIN_REACH, (x, y) => channelPassable(state, { x, y }, level));
}

function channelPassable(state: GridState, c: MacroCoord, level: number): boolean {
  return usable(state, c) && surfaceAt(state, c.x, c.y) === level && holdsWater(state, c);
}

/**
 * Whether this cell could hold water without pulling a summit down with it.
 *
 * Water is not structural support, so a cell inside the 3x3 base a mountain at tier 4 or more owes
 * V-MTN-03 can never be water: flooding it takes that base away and the peak reverts. It is a hard
 * geometric fact about where a stream can run, not a heuristic — which is why the search obeys it
 * up front rather than discovering it one rolled-back candidate at a time.
 */
function holdsWater(state: GridState, c: MacroCoord): boolean {
  for (const [dx, dy] of NEIGHBORS8) {
    const t = getCell(state.cells, c.x + dx, c.y + dy)?.terrain;
    if (t && t.type === TerrainType.Mountain && surfaceAt(state, c.x + dx, c.y + dy) >= TALL_MOUNTAIN) return false;
  }
  return true;
}

/** Breadth-first over passable cells, so a channel bends around what stands in its way instead of
 *  failing the way a fixed dogleg would. Neighbour order is fixed, so the path is deterministic. */
function shortestPath(
  state: GridState, origin: MacroCoord, isTarget: (c: MacroCoord) => boolean, level: number,
  radius: number, blocked: ReadonlySet<string>,
): MacroCoord[] | null {
  const W = state.template.width;
  const cameFrom = new Map<number, number>();
  const seen = new Set<number>([origin.y * W + origin.x]);
  let frontier: MacroCoord[] = [origin];
  if (isTarget(origin)) return [origin];

  while (frontier.length > 0) {
    const next: MacroCoord[] = [];
    for (const c of frontier) {
      for (const [dx, dy] of NEIGHBORS4) {
        const x = c.x + dx, y = c.y + dy, i = y * W + x;
        if (seen.has(i)) continue;
        if (Math.abs(x - origin.x) > radius || Math.abs(y - origin.y) > radius) continue;
        if (blocked.has(cellKey(x, y)) || !channelPassable(state, { x, y }, level)) continue;
        seen.add(i);
        cameFrom.set(i, c.y * W + c.x);
        if (isTarget({ x, y })) return trace(cameFrom, origin, { x, y }, W);
        next.push({ x, y });
      }
    }
    frontier = next;
  }
  return null;
}

function trace(cameFrom: Map<number, number>, origin: MacroCoord, end: MacroCoord, W: number): MacroCoord[] {
  const path: MacroCoord[] = [];
  let i = end.y * W + end.x;
  const start = origin.y * W + origin.x;
  while (i !== start) {
    path.push({ x: i % W, y: (i / W) | 0 });
    i = cameFrom.get(i)!;
  }
  path.push(origin);
  return path.reverse();
}

/** Nearest cell to `at` within `radius` satisfying `ok`, ties broken by position. */
function nearest(
  state: GridState, at: MacroCoord, radius: number, ok: (x: number, y: number) => boolean,
): MacroCoord | null {
  const W = state.template.width;
  let best: MacroCoord | null = null, bd = Infinity, bk = Infinity;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const x = at.x + dx, y = at.y + dy;
      if (!usable(state, { x, y }) || !ok(x, y)) continue;
      const d = Math.abs(dx) + Math.abs(dy), key = y * W + x;
      if (d < bd || (d === bd && key < bk)) { best = { x, y }; bd = d; bk = key; }
    }
  }
  return best;
}

/** A cell the course may build on: paintable, and off the outermost ring, where a water cell would
 *  face the void and could never be capped. */
function usable(state: GridState, c: MacroCoord): boolean {
  return paintable(state, c) && isInterior(state, c.x, c.y);
}

/** Whether a brush can reach this cell at all. A painted block renders half a tile up and left, so
 *  V-ZONE-01 refuses a cell whose up, left or up-left neighbour is not buildable — the strip of
 *  grass along a north or west coast is unpaintable, and a course that plans through it would be
 *  refused a cell at a time with nothing to show for it. */
function paintable(state: GridState, c: MacroCoord): boolean {
  if (!canBuildAt(state, c.x, c.y)) return false;
  for (const [dx, dy] of [[0, -1], [-1, 0], [-1, -1]] as const) {
    const cell = getCell(state.cells, c.x + dx, c.y + dy);
    if (cell && !isBuildableZone(cell.zone)) return false;
  }
  return true;
}
