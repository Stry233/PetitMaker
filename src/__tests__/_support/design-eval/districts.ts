/**
 * Whether the blocks read as blocks: the size, shape and frontage of the regions `segmentRegions` cuts
 * the planet into. The legibility reading counts a region as a district only where the smallest house
 * fits inside it whole.
 */
import type { GridState } from '../../../core/model/types';
import { bandScore } from './reference';
import { NEIGHBORS4 } from '../../../core/grid/directions';
import { stepDistance } from '../../../core/grid/cell-sets';
import { readMap, segmentRegions, type MapMasks, type Region } from '../../../tools/reading';
import { getPlaceableByRole } from '../../../state/catalog';
import { CLEARANCE } from '../../../core/game/profile';
import { rectSum, summedArea } from '../../../tools/generation/designer/summed-area';

/** The references' districts by `districtLegibility`: 36 of median 134 cells on the terraced planet,
 *  18 of median 260 on the garden town. The band spans both; the numbers depend on the district
 *  definition (counting every region of 20 cells gives 70 of 54 and 20 of 256). */
export const DISTRICT_COUNT_BAND = [18, 36] as const;

export const DISTRICT_MEDIAN_BAND = [134, 260] as const;

export interface DistrictLegibility {
  count: number;
  median: number;
  mean: number;
  p25: number;
  p75: number;
  /** Cell-weighted mean of a district's own area over its bounding box: 1 is a rectangle, and the
   *  references read 0.44 (terraced planet) and 0.53 (garden town). */
  rectangularity: number;
  score: number;
}

/**
 * District count and median size against the references, plus rectangularity, since a size histogram
 * alone cannot tell a block from a leftover of the same area. Scored, not gated.
 */
export function districtLegibility(state: GridState, g = readMap(state)): DistrictLegibility {
  const house = smallestHouse();
  const regions = segmentRegions(g).filter((r) => holdsFootprint(r, g.W, house));
  const sizes = regions.map((r) => r.cells.length).sort((a, b) => a - b);
  const at = (p: number): number => (sizes.length ? sizes[Math.min(sizes.length - 1, Math.floor(p * sizes.length))]! : 0);
  let cells = 0, fill = 0;
  for (const region of regions) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const i of region.cells) {
      const x = i % g.W, y = (i / g.W) | 0;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
    const box = (x1 - x0 + 1) * (y1 - y0 + 1);
    cells += region.cells.length;
    fill += region.cells.length * (region.cells.length / box);
  }
  const median = at(0.5);
  return {
    count: regions.length, median,
    mean: sizes.length ? sizes.reduce((a, b) => a + b, 0) / sizes.length : 0,
    p25: at(0.25), p75: at(0.75),
    rectangularity: cells ? fill / cells : 0,
    score: 0.5 * (
      bandScore(regions.length, DISTRICT_COUNT_BAND[0], DISTRICT_COUNT_BAND[1], 25)
      + bandScore(median, DISTRICT_MEDIAN_BAND[0], DISTRICT_MEDIAN_BAND[1], 60)),
  };
}

/** The smallest house's footprint: the least footprint among the homes large enough to have a gate,
 *  since a smaller home is street furniture (`CLEARANCE.gateMinArea`). */
function smallestHouse(): { w: number; h: number } {
  let best: { w: number; h: number } | null = null;
  for (const item of getPlaceableByRole('home')) {
    if (item.width * item.height < CLEARANCE.gateMinArea) continue;
    if (!best || item.width * item.height < best.w * best.h) best = { w: item.width, h: item.height };
  }
  if (!best) throw new Error('design-eval: the catalog has no house');
  return best;
}

/** Whether a `w` by `h` footprint, either way round, stands whole on the region's cells. */
function holdsFootprint(region: Region, W: number, { w, h }: { w: number; h: number }): boolean {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const i of region.cells) {
    const x = i % W, y = (i / W) | 0;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
  const mask = new Uint8Array(bw * bh);
  for (const i of region.cells) mask[(((i / W) | 0) - y0) * bw + (i % W) - x0] = 1;
  const sat = summedArea(mask, bw, bh);
  for (const [fw, fh] of [[w, h], [h, w]] as const) {
    for (let y = 0; y + fh <= bh; y++) for (let x = 0; x + fw <= bw; x++) {
      if (rectSum(sat, bw, { x, y, w: fw, h: fh }) === fw * fh) return true;
    }
  }
  return false;
}

/** How far a cell may stand from pavement and still be part of a fronted block: one composed place's
 *  depth (the references' places run 7x7 to 10x10). */
export const FRONTAGE_REACH = 10;

/** The shortest street run along a boundary that counts as frontage rather than a touching corner:
 *  the shortest street the generator lays. */
const FRONTAGE_RUN_MIN = 6;

/** The share of a block's cells that must stand within reach before the block counts as fronted. */
const FRONTAGE_COVER = 0.9;

/**
 * Sits between the references (terraced planet 0.50, garden town 0.67) and a network routed per lot
 * (0.08 at richness 0.2, 0.20 to 0.26 at richness 1). Judge a batch mean against it, not each map: a
 * composition that leaves one huge terrace legitimately scores below it.
 */
export const FRONTED_SHARE_MIN = 0.35;

export interface DistrictFrontage {
  districts: number;
  /** Area share of districts a street both outlines and reaches: a straight pavement run along the
   *  boundary, and at least `FRONTAGE_COVER` of the cells within `FRONTAGE_REACH` of pavement. */
  frontedShare: number;
  /** Area share of districts a straight street run outlines, however deep they are. */
  outlinedShare: number;
  /** Share of open land within `FRONTAGE_REACH` of pavement: the access reading, block-blind. */
  accessShare: number;
  /**
   * Area share in districts no street serves (fewer than half their cells within `FRONTAGE_REACH`):
   * the large unreached fields a thin seed produces, which the block-blind access share cannot tell
   * from a thinly spread shortfall. The references read 1% and 0%.
   */
  unservedShare: number;
  score: number;
}

/**
 * Whether the districts front onto streets: a street runs along the block and little of it is far from
 * that street. Both tests are needed; a map of few enormous blocks each touching some road outlines 77%
 * of its area by the first alone and 8% by both.
 */
export function districtFrontage(state: GridState, g = readMap(state)): DistrictFrontage {
  const { W, H } = g;
  const dist = pavementDistance(g);
  const regions = segmentRegions(g);
  let cells = 0, fronted = 0, outlined = 0, unserved = 0;
  for (const region of regions) {
    const set = new Set(region.cells);
    // Boundary edges, grouped by the line they lie on, so a straight run along one side is a run of
    // consecutive keys carrying the same answer.
    const lines = new Map<string, Map<number, boolean>>();
    for (const i of region.cells) {
      const x = i % W, y = (i / W) | 0;
      for (const [dx, dy] of NEIGHBORS4) {
        const nx = x + dx, ny = y + dy;
        const j = ny * W + nx;
        const off = nx < 0 || ny < 0 || nx >= W || ny >= H;
        if (!off && set.has(j)) continue;
        const key = `${dx},${dy}|${dy !== 0 ? y : x}`;
        let line = lines.get(key);
        if (!line) { line = new Map(); lines.set(key, line); }
        line.set(dy !== 0 ? x : y, !off && (g.paved[j] === 1 || g.crossing[j] === 1 || g.anchor[j] === 1));
      }
    }
    let run = 0;
    for (const line of lines.values()) {
      const keys = [...line.keys()].sort((a, b) => a - b);
      let start = 0;
      for (let n = 0; n <= keys.length; n++) {
        const brk = n === keys.length || keys[n]! !== keys[n - 1]! + 1
          || line.get(keys[n]!) !== line.get(keys[start]!);
        if (!brk) continue;
        if (n - start >= FRONTAGE_RUN_MIN && line.get(keys[start]!)) run += n - start;
        start = n;
      }
    }
    let near = 0;
    for (const i of region.cells) if (dist[i]! <= FRONTAGE_REACH) near++;
    cells += region.cells.length;
    if (near * 2 < region.cells.length) unserved += region.cells.length;
    if (run > 0) {
      outlined += region.cells.length;
      if (near / region.cells.length >= FRONTAGE_COVER) fronted += region.cells.length;
    }
  }
  let open = 0, access = 0;
  for (let i = 0; i < W * H; i++) {
    if (!g.land[i] || g.paved[i] || g.anchor[i] || g.water[i]) continue;
    open++;
    if (dist[i]! <= FRONTAGE_REACH) access++;
  }
  const frontedShare = cells ? fronted / cells : 0;
  return {
    districts: regions.length,
    frontedShare,
    outlinedShare: cells ? outlined / cells : 0,
    accessShare: open ? access / open : 0,
    unservedShare: cells ? unserved / cells : 0,
    score: Math.min(1, frontedShare / FRONTED_SHARE_MIN),
  };
}

/** Step distance from each cell to the nearest paved cell, crossing or plaza, ignoring terrain. */
function pavementDistance(g: MapMasks): Int16Array {
  const seeds: number[] = [];
  for (let i = 0; i < g.W * g.H; i++) if (g.paved[i] || g.crossing[i] || g.anchor[i]) seeds.push(i);
  return stepDistance(seeds, g.W, g.H);
}
