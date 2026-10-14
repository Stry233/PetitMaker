/**
 * The road widths and the region symmetry the evaluation reads over the map's masks
 * (`tools/reading`). Symmetry is a same-species mirror match over a region's plants, the definition
 * the decoded expert maps were measured by.
 *
 * Both road-width measures live here, and they answer different questions. The run measure is the one
 * the reference tables use (min of the horizontal and vertical paved run through a cell), which is what
 * makes the width mix comparable to them. The hard rule is judged on the opening measure instead — the
 * largest all-paved square a cell sits in — because that is the width a walker sees: a paved square
 * reads its whole extent under both, but a 1-cell staircase running diagonally reads 2 under the run
 * measure (two cells across in each axis) and 1 under the opening, which is what it draws as.
 */
import type { MapMasks, Region } from '../../../tools/reading';
import { cellKey } from '../../../core/grid/rect';

/** The reference's symmetry-and-unity reading: regions of >= `REGION_MIN_CELLS` cells
 *  (`tools/reading/regions.ts`) holding >= 8 decor objects, mirror match >= 0.6 counts as symmetric,
 *  dominant colour family >= 60% counts as unified. */
export const REGION_MIN_DECOR = 8;

export const SYMMETRY_MATCH_MIN = 0.6;

export const UNITY_SHARE_MIN = 0.6;

/** Per-cell corridor width by the run definition: min(horizontal run, vertical run). 0 off the
 *  pavement. A wide street and a small square both read their extent under it. */
export function runWidths(paved: Uint8Array, W: number, H: number): Uint8Array {
  const out = new Uint8Array(W * H);
  const run = (x: number, y: number, horiz: boolean): number => {
    let n = 1;
    for (let k = 1; ; k++) {
      const nx = horiz ? x + k : x, ny = horiz ? y : y + k;
      if (nx >= W || ny >= H || !paved[ny * W + nx]) break;
      n++;
    }
    for (let k = 1; ; k++) {
      const nx = horiz ? x - k : x, ny = horiz ? y : y - k;
      if (nx < 0 || ny < 0 || !paved[ny * W + nx]) break;
      n++;
    }
    return n;
  };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (paved[i]) out[i] = Math.min(run(x, y, true), run(x, y, false));
  }
  return out;
}

/** Per-cell width by morphological opening: the largest k for which the cell lies inside some
 *  all-paved k x k square. Parity-safe (a 2-wide street reads 2, unlike a distance transform) and
 *  strictly stricter than the run measure — every run-1 cell is opening-1, plus the diagonal
 *  staircases a run measure calls 2-wide. This is what the no-1-wide hard rule reads. */
export function openingWidths(paved: Uint8Array, W: number, H: number, maxK = 12): Uint8Array {
  const out = new Uint8Array(W * H);
  // Integral image of the paved mask: rect sums in O(1).
  const sum = new Int32Array((W + 1) * (H + 1));
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    sum[(y + 1) * (W + 1) + (x + 1)] =
      (paved[y * W + x] ? 1 : 0) + sum[y * (W + 1) + (x + 1)]! + sum[(y + 1) * (W + 1) + x]! - sum[y * (W + 1) + x]!;
  }
  const rect = (x: number, y: number, w: number, h: number): number =>
    sum[(y + h) * (W + 1) + (x + w)]! - sum[y * (W + 1) + (x + w)]! - sum[(y + h) * (W + 1) + x]! + sum[y * (W + 1) + x]!;
  for (let k = 1; k <= Math.min(maxK, W, H); k++) {
    // Corners of every all-paved k x k square, then a second integral image so "is any such corner
    // inside the k x k window ending at this cell" is O(1) too.
    const corner = new Int32Array((W + 1) * (H + 1));
    let any = false;
    for (let y = 0; y + k <= H; y++) for (let x = 0; x + k <= W; x++) {
      if (rect(x, y, k, k) === k * k) { corner[(y + 1) * (W + 1) + (x + 1)] = 1; any = true; }
    }
    if (!any) break;
    for (let y = 1; y <= H; y++) for (let x = 1; x <= W; x++) {
      const i = y * (W + 1) + x, up = i - (W + 1);
      corner[i] = corner[i]! + corner[up]! + corner[i - 1]! - corner[up - 1]!;
    }
    const cSum = (x: number, y: number, w: number, h: number): number =>
      corner[(y + h) * (W + 1) + (x + w)]! - corner[y * (W + 1) + (x + w)]! - corner[(y + h) * (W + 1) + x]! + corner[y * (W + 1) + x]!;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (!paved[i]) continue;
      const x0 = Math.max(0, x - k + 1), y0 = Math.max(0, y - k + 1);
      if (cSum(x0, y0, x - x0 + 1, y - y0 + 1) > 0) out[i] = k;
    }
  }
  return out;
}

export interface RegionDecor { x: number; y: number; id: string }

export function regionDecor(g: MapMasks, region: Region): RegionDecor[] {
  const out: RegionDecor[] = [];
  for (const i of region.cells) {
    const id = g.plantAt[i];
    if (id !== undefined) out.push({ x: i % g.W, y: (i / g.W) | 0, id });
  }
  return out;
}

/** Best mirror-match score over the vertical and horizontal axes. The axis is scanned in half-cell
 *  steps but held to the middle third of the decor cloud, and a plant matches only the same
 *  catalogId at the mirrored cell, which is the definition the reference was read by. */
export function mirrorScore(decor: RegionDecor[]): { v: number; h: number } {
  const at = new Map<string, string>();
  for (const d of decor) at.set(cellKey(d.x, d.y), d.id);
  const best = (axis: 'v' | 'h'): number => {
    const vals = decor.map((d) => (axis === 'v' ? d.x : d.y));
    const lo = Math.min(...vals), hi = Math.max(...vals);
    let score = 0;
    for (let twice = 2 * lo; twice <= 2 * hi; twice++) {
      if (Math.abs(twice - (lo + hi)) > (hi - lo) * 0.34) continue;
      let match = 0;
      for (const d of decor) {
        const v = axis === 'v' ? d.x : d.y;
        const key = axis === 'v' ? cellKey(twice - v, d.y) : cellKey(d.x, twice - v);
        if (at.get(key) === d.id) match++;
      }
      score = Math.max(score, match / decor.length);
    }
    return score;
  };
  return { v: best('v'), h: best('h') };
}

/** Clusters of the set cells where any two within `gap` cells on both axes (Chebyshev) join, as
 *  flat-index lists. Clusters follow the raster order of their first cell; a cluster's cells follow
 *  its stack walk, which scans each cell's window row by row. */
export function gapClusters(mask: Uint8Array, W: number, H: number, gap: number): number[][] {
  const seen = new Uint8Array(W * H);
  const out: number[][] = [];
  for (let start = 0; start < W * H; start++) {
    if (!mask[start] || seen[start]) continue;
    const piece: number[] = [];
    const stack = [start];
    seen[start] = 1;
    while (stack.length) {
      const p = stack.pop()!;
      piece.push(p);
      const x = p % W, y = (p / W) | 0;
      for (let dy = -gap; dy <= gap; dy++) {
        for (let dx = -gap; dx <= gap; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const j = ny * W + nx;
          if (seen[j] || !mask[j]) continue;
          seen[j] = 1;
          stack.push(j);
        }
      }
    }
    out.push(piece);
  }
  return out;
}
