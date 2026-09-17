/**
 * THE SHAPE OF THE GROUND, read off the finished map: is a terrace a landform or a block of tofu?
 *
 * SEAM LENGTH DOES NOT DISCRIMINATE, though it is the obvious reading to reach for: over ten
 * full-richness seeds of both templates the longest straight tier-edge run is 55 to 89 cells against
 * the terraced reference's 126, and corners per hundred segments 13.9 to 15.4 against its 14.8 — by
 * that reading a generated map is already less ruled than the map it is measured against.
 *
 * What does discriminate is the BOX: with the terrace edges left unbitten the median component fills
 * its own bounding box exactly (1.00, with 26 to 47 of a map's components at 0.90 or above) against
 * 0.58 on the terraced reference and 9 of its 38. A tofu block is a component that IS its bounding
 * box, and that is what this reading counts.
 *
 * A TERRACE COMPONENT is a 4-connected run of land at one surface level, water included at its own
 * surface, which is the definition the references' own terrace tables are read by, so the numbers here
 * can be compared against them directly.
 */
import type { GridState } from '../../../../core/model/types';
import { NB4, readGrid } from './grid';

/** The smallest component this reading counts. The references' own terraces are read at 30 cells and
 *  up; below that a component is a fillet or a step, not a surface. */
export const TERRACE_MIN_CELLS = 30;

/** The box fill at which a component IS its bounding box. Read on the two references this counts 9 of
 *  the terraced planet's 38 components and all 5 of the garden town's. */
export const BOXY_FILL = 0.9;

/**
 * The most of its own bounding box the MEDIAN terrace component may fill.
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

export function terraceShape(state: GridState, g = readGrid(state)): TerraceShape {
  const { W, H } = g;
  const surface = new Int8Array(W * H).fill(-1);
  let land = 0;
  for (let i = 0; i < W * H; i++) {
    if (!g.land[i]) continue;
    land++;
    surface[i] = g.elev[i]!;
  }

  const seen = new Uint8Array(W * H);
  const fills: number[] = [];
  let components = 0, largest = 0;
  for (let start = 0; start < W * H; start++) {
    if (seen[start] || surface[start]! < 0) continue;
    const cells: number[] = [];
    const stack = [start];
    seen[start] = 1;
    let x0 = W, y0 = H, x1 = 0, y1 = 0;
    while (stack.length) {
      const p = stack.pop()!;
      cells.push(p);
      const x = p % W, y = (p / W) | 0;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      for (const [dx, dy] of NB4) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const j = ny * W + nx;
        if (seen[j] || surface[j] !== surface[p]) continue;
        seen[j] = 1;
        stack.push(j);
      }
    }
    if (cells.length > largest) largest = cells.length;
    if (cells.length < TERRACE_MIN_CELLS) continue;
    components++;
    fills.push(cells.length / ((x1 - x0 + 1) * (y1 - y0 + 1)));
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
 * separates (x, y-1) and (x, y). Only edges between two LAND cells count — the coastline is the
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
