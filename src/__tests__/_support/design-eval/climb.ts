/**
 * The walk must climb, and the planet must be visible from it: both principles read over the
 * pavement, where a visitor stands, and `walkRhythm` reads the same sight casting along one route.
 *
 * The reference measures 2.65 bits of pavement elevation entropy over six levels of 5% or more, 47.1%
 * of the pavement at level 4 or above, 2.85 level changes per 100 pavement cells, and a clear sight
 * of mass at level 5 or above from 70.8% of it.
 */
import type { GridState } from '../../../core/model/types';
import { getCatalogItem } from '../../../state/catalog';
import { FIGURE_MIN } from '../../../tools/generation/designer/water/water-forms';
import { isCrossing } from '../../../core/model/traits';
import { readMap, waterBodies, type MapMasks } from '../../../tools/reading';
import { ItemCategory } from '../../../config/catalog/categories';

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
  /** Ramps and bridges per 100 pavement cells over the whole map, not along the primary walk. */
  eventsPer100: number;
  /** Share of the pavement with a clear line of sight to mass at `FORM_MASS_LEVEL` or above. */
  seesMass: number;
  /**
   * Compression and release, reported but never gated: the entropy of how far a visitor can see, in
   * bits. The reference reads 1.98 against generated maps' 0.64 to 1.71.
   */
  viewEntropy: number;
  /** The map's tallest built elevation. */
  peak: number;
}

/** A level carrying less than this share of the pavement is not a storey the walk uses. */
const LEVEL_SHARE_MIN = 0.05;

/** Where the map's upper half begins, read off the reference's pavement. */
export const ABOVE_MID_LEVEL = 4;

/** The mass a visitor should be able to see: the reference's dominant form stands at this level. */
export const FORM_MASS_LEVEL = 5;

/** How far a view is cast, in macro cells: about a quarter of the planet, what the game camera shows. */
export const FORM_SIGHT_REACH = 40;

/** Eight directions, so a mass standing off the axes is still seen. */
const SIGHT_RAYS = [
  [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1],
] as const;

/** The climb and form readings of a finished map. */
export function climbReading(state: GridState, g = readMap(state)): ClimbReading {
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
    if (isCrossing(getCatalogItem(o.catalogId))) events++;
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

/** View lengths are binned four cells to a bin over `FORM_SIGHT_REACH`, so `viewEntropy` tops out at
 *  `log2(10)` bits and a pinch and an open court fall in different bins. */
const VIEW_BIN = 4;

const VIEW_BINS = Math.ceil(FORM_SIGHT_REACH / VIEW_BIN);

/** The longest of the eight views from a cell, in macro cells. */
function longestView(g: MapMasks, blocks: Uint8Array, x: number, y: number): number {
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

/** What stops a view: a structure or a tree. Water, flora and pavement do not; ground blocks by height
 *  in the casts themselves. The reference numbers were measured with this model. */
function sightBlockers(g: MapMasks): Uint8Array {
  const out = new Uint8Array(g.structure);
  for (let i = 0; i < out.length; i++) {
    const plant = g.plantAt[i];
    if (plant && getCatalogItem(plant)?.category === ItemCategory.Tree) out[i] = 1;
  }
  return out;
}

/** Whether mass at `FORM_MASS_LEVEL` or above stands in clear view of (x, y), from the height that
 *  cell itself stands at. A ray stops at a blocker or at ground higher than the viewer. */
function seesMassFrom(g: MapMasks, blocks: Uint8Array, x: number, y: number): boolean {
  const { W, H } = g;
  const eye = g.elev[y * W + x]!;
  for (const [dx, dy] of SIGHT_RAYS) {
    for (let k = 1; k <= FORM_SIGHT_REACH; k++) {
      const cx = x + dx * k, cy = y + dy * k;
      if (cx < 0 || cy < 0 || cx >= W || cy >= H) break;
      const j = cy * W + cx;
      if (g.mountain[j] && g.elev[j]! >= FORM_MASS_LEVEL) return true;
      if (blocks[j]) break;
      // Ground above the viewer closes the view; lower ground and water at any level do not.
      if (!g.water[j] && g.elev[j]! > eye) break;
    }
  }
  return false;
}

/** How near the walk passes a feature to be threading it, in cells. */
const WALK_NEAR = 3;

/** A view shorter than this, in cells, is a pinch. */
const WALK_TIGHT = 15;

/** A view this long or longer, in cells, is open. */
const WALK_OPEN = 30;

/**
 * Compression and release along the primary walk: does the route pass a composed feature, and does it
 * both pinch and open? The reference is mostly open, with 4.5% of its pavement under a 15-cell view.
 * The caller supplies the trace, since a finished map does not record where the walk ran.
 */
export interface WalkRhythm {
  cells: number;
  /** Share of trace cells within `WALK_NEAR` of a feature body. */
  nearFeature: number;
  /** Distinct feature bodies the walk passes. */
  features: number;
  pinched: number;
  open: number;
  /** The walk passes a feature and both pinches and opens along the way. */
  threads: boolean;
}

export function walkRhythm(
  state: GridState, trace: readonly { x: number; y: number }[], g = readMap(state),
): WalkRhythm {
  const empty: WalkRhythm = {
    cells: 0, nearFeature: 0, features: 0, pinched: 0, open: 0, threads: false,
  };
  if (trace.length === 0) return empty;
  const { W, H } = g;
  // Shares `FIGURE_MIN` with the figure pass, so a pool the pass calls an accent is no feature here.
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
