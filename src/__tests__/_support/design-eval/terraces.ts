/**
 * The shape of the ground, read off the finished map: is a terrace a landform or a block of tofu?
 *
 * Seam length does not discriminate, though it is the obvious reading to reach for: over ten
 * full-richness seeds of both templates the longest straight tier-edge run is 55 to 89 cells against
 * the terraced reference's 126, and corners per hundred segments 13.9 to 15.4 against its 14.8 — by
 * that reading a generated map is already less ruled than the map it is measured against.
 *
 * What does discriminate is the box: with the terrace edges left unbitten the median component fills
 * its own bounding box exactly (1.00, with 26 to 47 of a map's components at 0.90 or above) against
 * 0.58 on the terraced reference and 9 of its 38. A tofu block is a component that is its bounding
 * box, and that is what this reading counts.
 *
 * A terrace component is a 4-connected run of land at one surface level, water included at its own
 * surface, which is the definition the references' own terrace tables are read by, so the numbers here
 * can be compared against them directly.
 */
import type { GridState } from '../../../core/model/types';
import { labelComponents } from '../../../core/grid/cell-sets';
import { readMap } from '../../../tools/reading';

/** The smallest component this reading counts. The references' own terraces are read at 30 cells and
 *  up; below that a component is a fillet or a step, not a surface. */
export const TERRACE_MIN_CELLS = 30;

/** The box fill at which a component is its bounding box. Read on the two references this counts 9 of
 *  the terraced planet's 38 components and all 5 of the garden town's. */
export const BOXY_FILL = 0.9;

/**
 * The most of its own bounding box the median terrace component may fill.
 *
 * A measured floor, not a target: the references read 0.58 (terraced) and 1.00 (the flat garden town,
 * whose five components are the plain it is). A generated map reads 0.81 to 0.89 with its terrace edges
 * bitten into and exactly 1.00 without, so the bar sits above the worst of those and below the box.
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
  /** The longest straight run of tier edge, in cells, and how often an edge turns: corners per 100
   *  edge segments. Reported rather than gated — see the header. */
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
 * The tier edges as unit segments on the dual lattice: how long the longest straight run of one is,
 * and how often two of them meet at a right angle.
 *
 * A vertical segment at (x, y) separates the cells (x-1, y) and (x, y); a horizontal one at (x, y)
 * separates (x, y-1) and (x, y). Only edges between two land cells count — the coastline is the
 * template's shape and not the generator's.
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
