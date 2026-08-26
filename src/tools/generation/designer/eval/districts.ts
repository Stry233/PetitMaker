/**
 * DO THE BLOCKS READ AS BLOCKS: the size, the shape and the frontage of the pieces the streets and
 * the terraces cut the island into. The failure these readings exist to catch is a map whose regions
 * do not read as regions at all.
 *
 * Both readings are taken over `segmentRegions`, so "a district" means here exactly what it means
 * to the scorecard's own region table.
 */
import type { GridState } from '../../../../core/model/types';
import { NB4, readGrid, segmentRegions, type EvalGrid } from './grid';
import { bandScore } from './reference';

/** The two references' own segmentation, read by `segmentRegions`: 69 districts of median 48 cells
 *  on the terraced island (cut by its terraces), 23 of median 260 on the garden town (cut by its
 *  streets). Read with the plaza handled differently the same two maps give 69/48 and 19/240, so the
 *  numbers are definition-sensitive. The band spans BOTH, because either partition is a legible map. */
export const DISTRICT_COUNT_BAND = [23, 69] as const;

export const DISTRICT_MEDIAN_BAND = [48, 260] as const;

export interface DistrictLegibility {
  count: number;
  median: number;
  mean: number;
  p25: number;
  p75: number;
  /** Cell-weighted mean of a district's own area over its bounding box: 1 is a rectangle, and the
   *  references read 0.44 (terraced island) and 0.53 (garden town). */
  rectangularity: number;
  score: number;
}

/**
 * The size distribution against both references' segmentation tables, plus how rectangular the
 * districts are — the references' blocks are outlined by straight streets and straight terrace
 * steps, so their pieces fill their own bounding boxes. Scored, not gated: a size histogram alone
 * cannot tell a block from a leftover of the same area, which is what the rectangularity is here
 * to start saying.
 */
export function districtLegibility(state: GridState): DistrictLegibility {
  const g = readGrid(state);
  const regions = segmentRegions(g);
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

/** How far a cell may stand from pavement and still be part of a fronted block. Ten cells is one
 *  composed place's own depth (the references' places run 7x7 to 10x10), so a block every cell of
 *  which is within it is a block a walker meets the street from. */
export const FRONTAGE_REACH = 10;

/** The shortest stretch of street along a boundary that reads as FRONTAGE rather than as a corner
 *  the pavement happens to touch. Six cells is the shortest street this generator lays. */
const FRONTAGE_RUN_MIN = 6;

/** The share of a block's cells that must stand within reach before the block counts as fronted. */
const FRONTAGE_COVER = 0.9;

/**
 * What the reading separates: the terraced island reads 0.50 and the garden town 0.67, while a network
 * routed per lot reads 0.08 at richness 0.2 and 0.20 to 0.26 at richness 1. The threshold sits between
 * the two populations rather than at either's edge.
 *
 * IT IS A BATCH READING, NOT A PER-MAP GATE. A seed whose composition leaves one huge terrace has a
 * block no street layer can subdivide on its own, and it scores below this while being exactly the
 * map the composition asked for. Judge a batch mean against it; a hard per-map check here would fail
 * honest maps and pass nothing the other readings do not already catch.
 */
export const FRONTED_SHARE_MIN = 0.35;

export interface DistrictFrontage {
  districts: number;
  /** Area share of districts that a street both OUTLINES and reaches: a straight run of pavement
   *  along the boundary, and every corner of the block within `FRONTAGE_REACH` of pavement. */
  frontedShare: number;
  /** Area share of districts a straight street run outlines, however deep they are. */
  outlinedShare: number;
  /** Share of open land within `FRONTAGE_REACH` of pavement: the access reading, block-blind. */
  accessShare: number;
  /**
   * Area share standing in districts NO STREET SERVES: fewer than half their cells within
   * `FRONTAGE_REACH` of pavement.
   *
   * The access reading above is block-blind, so a map whose shortfall is spread thinly over every
   * block reads the same as one carrying two enormous fields nothing goes near — and it is the second
   * that a thin seed produces: large fields with no street near them. This is that failure as a
   * number: the references read 1% and 0%.
   */
  unservedShare: number;
  score: number;
}

/**
 * DO THE DISTRICTS FRONT ONTO STREETS?
 *
 * The size and rectangularity of the blocks cannot answer that on their own — a map of few enormous
 * blocks scores BETTER than the terraced reference on boundary straightness, since a blob bounded by a
 * long coast and a long terrace step is straight-edged and still reads as leftover ground. What
 * separates the references from such a map is the pair of facts a town block has and a leftover does
 * not: a street runs ALONG it, and no part of it is far from that street.
 *
 * Both parts are needed and neither is sufficient. A map of few enormous blocks, each touching some
 * road somewhere, outlines 77% of its area by the first test alone and 8% by both together.
 */
export function districtFrontage(state: GridState): DistrictFrontage {
  const g = readGrid(state);
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
      for (const [dx, dy] of NB4) {
        const nx = x + dx, ny = y + dy;
        const j = ny * W + nx;
        const off = nx < 0 || ny < 0 || nx >= W || ny >= H;
        if (!off && set.has(j)) continue;
        const key = `${dx},${dy}|${dy !== 0 ? y : x}`;
        let line = lines.get(key);
        if (!line) { line = new Map(); lines.set(key, line); }
        line.set(dy !== 0 ? x : y, !off && (g.paved[j] === 1 || g.crossing[j] === 1 || g.plaza[j] === 1));
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
    for (const i of region.cells) if (dist[i]! >= 0 && dist[i]! <= FRONTAGE_REACH) near++;
    cells += region.cells.length;
    if (near * 2 < region.cells.length) unserved += region.cells.length;
    if (run > 0) {
      outlined += region.cells.length;
      if (near / region.cells.length >= FRONTAGE_COVER) fronted += region.cells.length;
    }
  }
  let open = 0, access = 0;
  for (let i = 0; i < W * H; i++) {
    if (!g.land[i] || g.paved[i] || g.plaza[i] || g.water[i]) continue;
    open++;
    if (dist[i]! >= 0 && dist[i]! <= FRONTAGE_REACH) access++;
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

/** Cells by their walking distance to the nearest paved cell, crossing, or the plaza; -1 where the
 *  map holds no pavement at all. Terrain is not an obstacle here: the reading is how far a block
 *  stands from its street, not whether a walker could climb there. */
function pavementDistance(g: EvalGrid): Int32Array {
  const N = g.W * g.H;
  const dist = new Int32Array(N).fill(-1);
  const queue: number[] = [];
  for (let i = 0; i < N; i++) if (g.paved[i] || g.crossing[i] || g.plaza[i]) { dist[i] = 0; queue.push(i); }
  for (let head = 0; head < queue.length; head++) {
    const p = queue[head]!;
    const x = p % g.W, y = (p / g.W) | 0;
    for (const [dx, dy] of NB4) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= g.W || ny >= g.H) continue;
      const j = ny * g.W + nx;
      if (dist[j]! >= 0) continue;
      dist[j] = dist[p]! + 1;
      queue.push(j);
    }
  }
  return dist;
}
