/**
 * THE WALK MUST CLIMB, AND THE ISLAND MUST BE VISIBLE FROM IT.
 *
 * The first two design principles read as numbers, and both are facts about where a VISITOR stands
 * rather than about what the map contains. Every reading below is taken over the pavement, because
 * that is where a visitor is; `walkRhythm` is the same family taken along one traced route instead,
 * which is why the sight casting the two share lives here.
 *
 * The reference's own numbers, measured on the decoded fixture: 2.65 bits of pavement elevation
 * entropy over six levels each carrying 5% or more, 47.1% of the pavement standing at level 4 or
 * above, 2.85 level-change events per 100 pavement cells, and a clear line of sight to mass at level
 * 5 or above from 70.8% of it. The floors beside each field sit under those numbers rather than at
 * them.
 */
import { ItemCategory, type GridState } from '../../../../core/model/types';
import { categoryOf, getCatalogItem } from '../../../../state/catalog';
import { FIGURE_MIN } from '../water/water-forms';
import { readGrid, type EvalGrid } from './grid';
import { waterBodies } from './water-bodies';

/** Where a visitor stands and what they can see from there, all of it read over the pavement. */
export interface ClimbReading {
  /** Pavement cells the reading was taken over. */
  paved: number;
  /** Elevation entropy of the pavement, in bits. */
  entropy: number;
  /** Levels each carrying `LEVEL_SHARE_MIN` or more of the pavement. */
  levels: number;
  /** Share of the pavement standing at `ABOVE_MID_LEVEL` or above. */
  aboveMid: number;
  /** The largest share any one level holds: a single-storey walk reads near 1. */
  topLevelShare: number;
  /** Ramps and bridges per 100 pavement cells over the WHOLE map: how much of the map's circulation
   *  is a level change at all. Not a reading of the primary walk — a walk of its own would have to be
   *  handed the plan's line, and this is a fact about the finished map. */
  eventsPer100: number;
  /** Share of the pavement with a clear line of sight to mass at `FORM_MASS_LEVEL` or above. */
  seesMass: number;
  /**
   * COMPRESSION AND RELEASE, REPORTED AND NOT GATED: the entropy of how far a visitor can see, in bits.
   *
   * The principle is a rhythm of pinch and opening rather than any one state: the reference reads 1.98
   * bits of view-length entropy against a generated map's 0.64 to 1.71. It VERIFIES the climb and the
   * planting rather than being a thing to build, so it is printed beside them and nothing is held to it.
   */
  viewEntropy: number;
  /** The map's tallest built elevation. */
  peak: number;
}

/** A level carrying less than this share of the pavement is not a storey the walk uses. */
const LEVEL_SHARE_MIN = 0.05;

/** Where the map's upper half begins, and the mass a visitor is meant to be able to see. Both are read
 *  off the reference: its pavement stands above level 4 and its dominant form at 5. */
export const ABOVE_MID_LEVEL = 4;

export const FORM_MASS_LEVEL = 5;

/** How far a view is cast, in macro cells. Casting to the map edge is the coarser convention; this
 *  stops at a distance a player's camera actually shows, about a quarter of the island. */
export const FORM_SIGHT_REACH = 40;

/**
 * The eight directions a view is cast along.
 *
 * Eight rather than four because a mass standing off the axes is a mass a visitor sees, and the
 * diagonals are what a four-ray cast misses. The conventional model is 4-direction or 36-ray flat
 * casting, and either is a coarse stand-in for a camera.
 */
const SIGHT_RAYS = [
  [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1],
] as const;

/** The climb and form readings of a finished map. */
export function climbReading(state: GridState, g = readGrid(state)): ClimbReading {
  const { W } = g;
  const blocks = sightBlockers(g);
  const cells: number[] = [];
  let peak = 0;
  for (let i = 0; i < g.land.length; i++) {
    if (g.land[i] && g.mountain[i]) peak = Math.max(peak, g.elev[i]!);
    if (g.paved[i]) cells.push(i);
  }
  const byLevel = new Map<number, number>();
  for (const i of cells) byLevel.set(g.elev[i]!, (byLevel.get(g.elev[i]!) ?? 0) + 1);
  const total = cells.length;
  let entropy = 0, top = 0, levels = 0, aboveMid = 0;
  for (const [level, n] of byLevel) {
    const p = n / Math.max(1, total);
    entropy -= p > 0 ? p * Math.log2(p) : 0;
    top = Math.max(top, p);
    if (p >= LEVEL_SHARE_MIN) levels++;
    if (level >= ABOVE_MID_LEVEL) aboveMid += n;
  }
  let events = 0;
  for (const o of state.objects.values()) {
    const cat = categoryOf(o);
    if (cat === ItemCategory.Bridge || cat === ItemCategory.Ramp) events++;
  }
  let sees = 0;
  const byView = new Map<number, number>();
  for (const i of cells) {
    if (seesMassFrom(g, blocks, i % W, (i / W) | 0)) sees++;
    const reach = longestView(g, blocks, i % W, (i / W) | 0);
    const bin = Math.min(VIEW_BINS - 1, (reach / VIEW_BIN) | 0);
    byView.set(bin, (byView.get(bin) ?? 0) + 1);
  }
  let viewEntropy = 0;
  for (const n of byView.values()) {
    const p = n / Math.max(1, total);
    viewEntropy -= p > 0 ? p * Math.log2(p) : 0;
  }
  return {
    paved: total,
    entropy,
    levels,
    aboveMid: total ? aboveMid / total : 0,
    topLevelShare: total ? top : 0,
    eventsPer100: total ? (100 * events) / total : 0,
    seesMass: total ? sees / total : 0,
    viewEntropy: total ? viewEntropy : 0,
    peak,
  };
}

/** How far the longest of the eight views from a cell reaches, in macro cells, and how those lengths
 *  are binned for the entropy above. Four cells to a bin over the same `FORM_SIGHT_REACH` the form
 *  probe casts to, so the reading tops out at `log2(10)` bits and a pinch and an open court fall in
 *  different bins. A cast to the map edge yields bits on another scale, not comparable with these. */
const VIEW_BIN = 4;

const VIEW_BINS = Math.ceil(FORM_SIGHT_REACH / VIEW_BIN);

function longestView(g: EvalGrid, blocks: Uint8Array, x: number, y: number): number {
  const { W, H } = g;
  const eye = g.elev[y * W + x]!;
  let best = 0;
  for (const [dx, dy] of SIGHT_RAYS) {
    let k = 1;
    for (; k <= FORM_SIGHT_REACH; k++) {
      const cx = x + dx * k, cy = y + dy * k;
      if (cx < 0 || cy < 0 || cx >= W || cy >= H) break;
      const j = cy * W + cx;
      if (blocks[j]) break;
      if (!g.water[j] && g.elev[j]! > eye) break;
    }
    best = Math.max(best, k - 1);
  }
  return best;
}

/** What stops a view: a building, a facility or a tree. Water, flora and pavement do not, and ground
 *  is read by its own height rather than as a blocker, which is the model the reference numbers above
 *  were read with. */
function sightBlockers(g: EvalGrid): Uint8Array {
  const out = new Uint8Array(g.structure);
  for (let i = 0; i < out.length; i++) {
    const plant = g.plantAt[i];
    if (plant && getCatalogItem(plant)?.category === ItemCategory.Tree) out[i] = 1;
  }
  return out;
}

/** Whether mass at `FORM_MASS_LEVEL` or above stands in clear view of (x, y), from the height that
 *  cell itself stands at. A ray stops at a blocker or at ground higher than the viewer. */
function seesMassFrom(g: EvalGrid, blocks: Uint8Array, x: number, y: number): boolean {
  const { W, H } = g;
  const eye = g.elev[y * W + x]!;
  for (const [dx, dy] of SIGHT_RAYS) {
    for (let k = 1; k <= FORM_SIGHT_REACH; k++) {
      const cx = x + dx * k, cy = y + dy * k;
      if (cx < 0 || cy < 0 || cx >= W || cy >= H) break;
      const j = cy * W + cx;
      if (g.mountain[j] && g.elev[j]! >= FORM_MASS_LEVEL) return true;
      if (blocks[j]) break;
      // Ground standing above the viewer closes the view; ground at their own level or below, and
      // water at any level, does not.
      if (!g.water[j] && g.elev[j]! > eye) break;
    }
  }
  return false;
}

/** How near the walk has to pass a feature to be threading it, in cells, and how long a view has to be
 *  to read as OPEN. A pinch reads at under 15 cells, and the reference's median longest view is 64. */
const WALK_NEAR = 3;

const WALK_TIGHT = 15;

const WALK_OPEN = 30;

/**
 * THE WALK'S OWN RHYTHM: does the route thread a composed feature, and does it pinch and then open
 * while it does?
 *
 * Compression and release VERIFIES the climb and the planting rather than being a feature to build, and
 * this is that reading taken along the primary WALK instead of over all pavement: 4.5% of the
 * reference's pavement has a longest view under 15 cells while its median is 64, so the reference is
 * mostly open with real pinch points punctuating it. A route that never comes near a composed body has
 * nothing to be punctuated BY, which is the half a generator can build.
 *
 * The trace is the caller's, because the walk is a plan and a finished map does not say where it ran.
 */
export interface WalkRhythm {
  cells: number;
  /** Trace cells standing within `WALK_NEAR` of a feature body. */
  nearFeature: number;
  /** Distinct feature bodies the walk passes. */
  features: number;
  pinched: number;
  open: number;
  /** The walk passes a feature and both pinches and opens along the way. */
  threads: boolean;
}

export function walkRhythm(
  state: GridState, trace: readonly { x: number; y: number }[], g = readGrid(state),
): WalkRhythm {
  const empty: WalkRhythm = {
    cells: 0, nearFeature: 0, features: 0, pinched: 0, open: 0, threads: false,
  };
  if (trace.length === 0) return empty;
  const { W, H } = g;
  // A FEATURE is a body the figure pass would have drawn: the reading and the pass share `FIGURE_MIN`,
  // so a map cannot be credited with threading a pool the pass would have called an accent.
  const features = waterBodies(g, state).filter((b) => b.cells.length >= FIGURE_MIN);
  const owner = new Int32Array(W * H).fill(-1);
  for (const [k, body] of features.entries()) for (const i of body.cells) owner[i] = k;
  const blocks = sightBlockers(g);
  const met = new Set<number>();
  let near = 0, pinched = 0, open = 0, on = 0;
  for (const c of trace) {
    if (c.x < 0 || c.y < 0 || c.x >= W || c.y >= H) continue;
    on++;
    let found = false;
    for (let dy = -WALK_NEAR; dy <= WALK_NEAR; dy++) {
      for (let dx = -WALK_NEAR; dx <= WALK_NEAR; dx++) {
        const nx = c.x + dx, ny = c.y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const k = owner[ny * W + nx]!;
        if (k < 0) continue;
        met.add(k);
        found = true;
      }
    }
    if (found) near++;
    const view = longestView(g, blocks, c.x, c.y);
    if (view < WALK_TIGHT) pinched++;
    else if (view >= WALK_OPEN) open++;
  }
  if (on === 0) return empty;
  return {
    cells: on, nearFeature: near / on, features: met.size,
    pinched: pinched / on, open: open / on,
    threads: met.size >= 1 && pinched > 0 && open > 0,
  };
}
