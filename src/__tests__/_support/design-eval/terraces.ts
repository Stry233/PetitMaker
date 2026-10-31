/**
 * The shape of the ground, read off the finished map: is a terrace a landform or a block of tofu?
 *
 * Seam length does not discriminate: over ten full-richness seeds the longest straight tier edge is
 * 55 to 89 cells against the terraced reference's 126, and corners per hundred segments 13.9 to 15.4
 * against its 14.8. Box fill does: with unbitten edges the median component fills its bounding box
 * exactly (1.00) against the terraced reference's 0.58.
 *
 * A terrace component is a 4-connected run of land at one surface level, water included, as the
 * references' terrace tables count it, so the numbers compare directly.
 */
import type { GridState } from '../../../core/model/types';
import { labelComponents } from '../../../core/grid/cell-sets';
import { readMap } from '../../../tools/reading';

/** The smallest component counted, as in the references' tables; below it a component is a fillet or
 *  a step, not a surface. */
export const TERRACE_MIN_CELLS = 30;

/** The box fill at which a component is its bounding box: 9 of the terraced reference's 38 components
 *  and all 5 of the garden town's. */
export const BOXY_FILL = 0.9;

/**
 * The most of its own bounding box the median terrace component may fill. The references read 0.58
 * (terraced) and 1.00 (the flat garden town); a generated map reads 0.81 to 0.89 with bitten terrace
 * edges and 1.00 without, so the cap sits above the first and below the box.
 */
export const TERRACE_FILL_MAX = 0.94;

export interface TerraceShape {
  /** Components of `TERRACE_MIN_CELLS` or more. */
  components: number;
  /** Cells of the largest, as a share of the planet's land. */
  largestShare: number;
  /** Median box fill over those components: the tofu reading. */
  medianFill: number;
  /** Components whose fill is `BOXY_FILL` or above, and their share of the count. */
  boxy: number;
  boxyShare: number;
  /** The longest straight tier edge in cells, and corners per 100 edge segments. Reported, not gated. */
  longestSeam: number;
  cornersPer100: number;
}

export function terraceShape(state: GridState, g = readMap(state)): TerraceShape {
  const { W, H } = g;
  const surface = new Int8Array(W * H).fill(-1);
  let land = 0;
  for (let i = 0; i < W * H; i++) {
    if (!g.land[i]) continue;
    land++;
    surface[i] = g.elev[i]!;
  }

  // One level's flat: 4-connected cells of the same surface, its box read as labels come in.
  const open = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) if (surface[i]! >= 0) open[i] = 1;
  const { labels, sizes } = labelComponents(open, W, H, false, (i, j) => surface[i] === surface[j]);
  const boxes = sizes.map(() => ({ x0: W, y0: H, x1: 0, y1: 0 }));
  for (let i = 0; i < W * H; i++) {
    const box = boxes[labels[i]!];
    if (!labels[i] || !box) continue;
    const x = i % W, y = (i / W) | 0;
    if (x < box.x0) box.x0 = x;
    if (x > box.x1) box.x1 = x;
    if (y < box.y0) box.y0 = y;
    if (y > box.y1) box.y1 = y;
  }
  const fills: number[] = [];
  let components = 0, largest = 0;
  for (let id = 1; id < sizes.length; id++) {
    const n = sizes[id]!, box = boxes[id]!;
    if (n > largest) largest = n;
    if (n < TERRACE_MIN_CELLS) continue;
    components++;
    fills.push(n / ((box.x1 - box.x0 + 1) * (box.y1 - box.y0 + 1)));
  }
  fills.sort((a, b) => a - b);
  const boxy = fills.filter((v) => v >= BOXY_FILL).length;

  const seam = seamShape(surface, W, H);
  return {
    components,
    largestShare: land ? largest / land : 0,
    medianFill: fills.length ? fills[fills.length >> 1]! : 0,
    boxy,
    boxyShare: components ? boxy / components : 0,
    longestSeam: seam.longest,
    cornersPer100: seam.segments ? 100 * seam.corners / seam.segments : 0,
  };
}

/**
 * Tier edges as unit segments on the dual lattice: the longest straight run and the right-angle corners.
 * A vertical segment at (x, y) separates (x-1, y) and (x, y); a horizontal one separates (x, y-1) and
 * (x, y). Only edges between two land cells count; the coastline is the template's, not the generator's.
 */
function seamShape(
  surface: Int8Array, W: number, H: number,
): { segments: number; longest: number; corners: number } {
  const stride = W + 1;
  const vert = new Uint8Array(stride * (H + 1));
  const horz = new Uint8Array(stride * (H + 1));
  let segments = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const here = surface[y * W + x]!;
      if (here < 0) continue;
      const west = x > 0 ? surface[y * W + x - 1]! : -1;
      const north = y > 0 ? surface[(y - 1) * W + x]! : -1;
      if (west >= 0 && west !== here) { vert[y * stride + x] = 1; segments++; }
      if (north >= 0 && north !== here) { horz[y * stride + x] = 1; segments++; }
    }
  }
  let longest = 0;
  for (let x = 0; x <= W; x++) {
    let run = 0;
    for (let y = 0; y <= H; y++) {
      run = vert[y * stride + x] ? run + 1 : 0;
      if (run > longest) longest = run;
    }
  }
  for (let y = 0; y <= H; y++) {
    let run = 0;
    for (let x = 0; x <= W; x++) {
      run = horz[y * stride + x] ? run + 1 : 0;
      if (run > longest) longest = run;
    }
  }
  let corners = 0;
  for (let y = 0; y <= H; y++) {
    for (let x = 0; x <= W; x++) {
      const v = vert[y * stride + x] || (y > 0 ? vert[(y - 1) * stride + x] : 0);
      const h = horz[y * stride + x] || (x > 0 ? horz[y * stride + x - 1] : 0);
      if (v && h) corners++;
    }
  }
  return { segments, longest, corners };
}
