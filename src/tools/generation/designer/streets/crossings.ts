/**
 * Plans the channels the walk steps over: a gap cut across a street where both banks stay joined to
 * the hub without it.
 */
import { flatIndex, inflateRect, rectContains, rectsOverlap, type Rect } from '../../../../core/grid/rect';
import { TRUNK_W } from '../types';
import { type Board, acrossOf, alongRect, firstPaved, lastPaved, restamp } from './board';
import type { LineCrossing, RampFlight, StreetRun } from './model';
import { reachable } from './reach';
import { prune } from './settle';

/** Open water a crossing spans, in macro cells: inside the 3 to 6 the catalog's bridges carry. */
const CROSSING_SPAN = 4;
/** Cells of the trunk a crossing takes: the water, plus the one cell of dry margin the coating's own
 *  window forbids pavement on. */
const CROSSING_GAP = CROSSING_SPAN + 1;
/** How far from a street's ends a crossing may sit. A channel cut at the very end of a trunk leaves a
 *  stub on the far bank rather than a way onward. */
const CROSSING_INSET = 8;
/** How far apart two crossings stand. Two channels within sight of each other read as one river the
 *  map could not decide the shape of. */
const CROSSING_APART = 20;

/**
 * Where the movement line steps over water.
 *
 * The site is read off the settled pavement, and the test is the one that keeps the map safe: cut the
 * gap, and both banks must still be pavement the plaza reaches without it. So a deck that fails to
 * land — the traits resolve a bridge themselves, and a span is refused where the banks are not level
 * — costs the map a crossing and never a network. What the deck buys is the crossing a walker wants at
 * the point they want it.
 *
 * Only ground-level stretches are offered: a bridge's two ends must be flat and equal, and the deck
 * scan in the pipeline reads water at elevation 0.
 */
export function planCrossings(
  board: Board, streets: readonly StreetRun[], flights: readonly RampFlight[], budget: number,
): LineCrossing[] {
  const out: LineCrossing[] = [];
  if (budget <= 0) return out;
  const order = streets
    .map((run, index) => ({ run, index }))
    .filter(({ run }) => run.primary || run.rank === 'trunk')
    .sort((a, b) => Number(!!b.run.primary) - Number(!!a.run.primary)
      || (b.run.to - b.run.from) - (a.run.to - a.run.from) || a.index - b.index);
  for (const { run } of order) {
    if (out.length >= budget) break;
    const site = crossingSite(board, streets, flights, run, out);
    if (site) out.push(site);
  }
  return out;
}

/** The middle-most stretch of one run that may be given over to water, or null. */
function crossingSite(
  board: Board, streets: readonly StreetRun[], flights: readonly RampFlight[], run: StreetRun,
  taken: readonly LineCrossing[],
): LineCrossing | null {
  const lo = firstPaved(run) + CROSSING_INSET;
  const hi = lastPaved(run) - CROSSING_INSET - CROSSING_GAP;
  const mid = (lo + hi) / 2;
  const offsets: number[] = [];
  for (let t = lo; t <= hi; t++) offsets.push(t);
  offsets.sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid) || a - b);
  for (const at of offsets) {
    const gap = alongRect(run.axis, acrossOf(run), run.width, at, at + CROSSING_GAP - 1);
    if (taken.some((c) => rectsTouch(c.gap, gap, CROSSING_APART))) continue;
    const tier = crossingGround(board, gap);
    if (tier < 0) continue;
    if (!cuttable(board, streets, flights, gap, run)) continue;
    const open = run.axis === 'y'
      ? { x: gap.x, y: gap.y + 1, w: gap.w, h: CROSSING_SPAN }
      : { x: gap.x + 1, y: gap.y, w: CROSSING_SPAN, h: gap.h };
    return {
      kind: tier === 0 ? 'water' : 'gorge', gap, open, tier, axis: run.axis, span: CROSSING_SPAN,
    };
  }
  return null;
}

/** The tier a would-be crossing stands at, or -1 where the ground will not take one: the run's own
 *  pavement, all of it and its surrounding ring at one tier so both banks come out level, and a cell
 *  of land either side of the gap for the deck's ends to rest on. */
function crossingGround(board: Board, gap: Rect): number {
  let tier = -1;
  for (let y = gap.y - 1; y <= gap.y + gap.h; y++) {
    for (let x = gap.x - 1; x <= gap.x + gap.w; x++) {
      if (x < 1 || y < 1 || x >= board.W - 1 || y >= board.H - 1) return -1;
      const i = flatIndex(x, y, board.W);
      if (!board.land[i] || board.reserved[i]) return -1;
      if (rectContains(board.hubArea, x, y)) return -1;
      if (tier < 0) tier = board.tier[i]!;
      else if (board.tier[i] !== tier) return -1;
    }
  }
  for (let y = gap.y; y < gap.y + gap.h; y++) {
    for (let x = gap.x; x < gap.x + gap.w; x++) if (!board.paved[flatIndex(x, y, board.W)]) return -1;
  }
  return tier;
}

/**
 * Whether the gap may be taken out of the pavement: with it gone, both banks are still street the
 * plaza reaches.
 *
 * The board is written and put back, which is what makes this a question rather than a decision — a
 * site that fails leaves the pavement exactly as it was.
 */
function cuttable(
  board: Board, streets: readonly StreetRun[], flights: readonly RampFlight[], gap: Rect, run: StreetRun,
): boolean {
  const cells: number[] = [];
  for (let y = gap.y; y < gap.y + gap.h; y++) {
    for (let x = gap.x; x < gap.x + gap.w; x++) cells.push(flatIndex(x, y, board.W));
  }
  const before = reachable(board, flights);
  for (const i of cells) { board.reserved[i] = 1; board.stopAt[i] = 1; }
  restamp(board, streets);
  const reach = reachable(board, flights);
  const along = run.axis === 'y' ? gap.y : gap.x;
  let ok = [along - 1, along + CROSSING_GAP].every((t) => bankReached(board, run, t, reach));
  if (ok) {
    // And on the network the settling will leave: it takes back every stamp the gap touches, which is
    // more than the gap, and at a junction beside the gap that can be the only link between two halves.
    restamp(board, prune(board, streets, flights));
    const settled = reachable(board, flights);
    const near = { x: gap.x - TRUNK_W, y: gap.y - TRUNK_W, w: gap.w + 2 * TRUNK_W, h: gap.h + 2 * TRUNK_W };
    for (let i = 0; i < before.length && ok; i++) {
      if (before[i] && !settled[i] && !rectContains(near, i % board.W, (i / board.W) | 0)) ok = false;
    }
  }
  if (!ok) for (const i of cells) { board.reserved[i] = 0; board.stopAt[i] = 0; }
  restamp(board, streets);
  return ok;
}

/** Whether the run's pavement at `t` along is street the plaza reaches. */
function bankReached(board: Board, run: StreetRun, t: number, reach: Uint8Array): boolean {
  const across = acrossOf(run);
  for (let k = 0; k < run.width; k++) {
    const x = run.axis === 'y' ? across + k : t;
    const y = run.axis === 'y' ? t : across + k;
    if (x < 0 || y < 0 || x >= board.W || y >= board.H) return false;
    if (reach[flatIndex(x, y, board.W)]) return true;
  }
  return false;
}

const rectsTouch = (a: Rect, b: Rect, pad: number): boolean => rectsOverlap(inflateRect(a, pad), b);
