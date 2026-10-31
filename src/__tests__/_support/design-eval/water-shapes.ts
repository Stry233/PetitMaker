/**
 * The shape questions the water evaluation asks of one body (does it mirror, band, run long and thin,
 * sit framed by mountain, meet a crossing), shared by every water reading so they agree on a shape.
 */
import { NEIGHBORS4 } from '../../../core/grid/directions';
import type { MapMasks, WaterBody } from '../../../tools/reading';

/** The largest body that counts as an accent (a landscape pool beside a path) rather than a feature. */
export const WATER_ACCENT_MAX = 6;

/** Share of a side that has to be mountain for the side to read as framed. */
const FRAME_SHARE = 0.6;

/** Band flips on one axis that make a body a comb. */
export const COMB_FLIPS_MIN = 4;

/** How many times a body's box flips between wet and dry bands on its better axis (a band is wet at
 *  50% or more): the comb reading. */
export function bandFlips(g: MapMasks, body: WaterBody): number {
  const { W } = g;
  const cells = new Set(body.cells);
  const bw = body.x1 - body.x0 + 1, bh = body.y1 - body.y0 + 1;
  const count = (along: number, across: number, wet: (a: number, b: number) => boolean): number => {
    let last: boolean | null = null, flips = 0;
    for (let a = 0; a < along; a++) {
      let n = 0;
      for (let b = 0; b < across; b++) if (wet(a, b)) n++;
      const isWet = n * 2 >= across;
      if (last !== null && isWet !== last) flips++;
      last = isWet;
    }
    return flips;
  };
  return Math.max(
    count(bh, bw, (a, b) => cells.has((a + body.y0) * W + b + body.x0)),
    count(bw, bh, (a, b) => cells.has((b + body.y0) * W + a + body.x0)),
  );
}

/** A long thin body: the shape a stream draws, and never the shape a dropped bed does. */
export function streamLike(body: WaterBody): boolean {
  const long = Math.max(body.x1 - body.x0, body.y1 - body.y0) + 1;
  return long >= 10 && body.cells.length / long <= 3.5;
}

/** Whether a bridge or a ramp stands on or beside the body: the walk steps over this water. */
export function spannedByCrossing(g: MapMasks, body: WaterBody): boolean {
  const { W, H } = g;
  for (const i of body.cells) {
    const x = i % W, y = (i / W) | 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        if (g.crossing[ny * W + nx]) return true;
      }
    }
  }
  return false;
}

/** Whether two bodies stand within a cell of each other. */
export function bodiesTouch(g: MapMasks, a: WaterBody, b: WaterBody): boolean {
  if (a.x0 > b.x1 + 2 || b.x0 > a.x1 + 2 || a.y0 > b.y1 + 2 || b.y0 > a.y1 + 2) return false;
  const { W } = g;
  const cells = new Set(b.cells);
  for (const i of a.cells) {
    const x = i % W, y = (i / W) | 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (x + dx >= 0 && x + dx < W && cells.has((y + dy) * W + x + dx)) return true;
      }
    }
  }
  return false;
}

/**
 * How well a body mirrors about the better axis of its own box, 0 to 1: it separates a composed court
 * from a blob that happens to hold an islet. One axis suffices because a single symmetric figure, such
 * as a heart, mirrors left to right but not top to bottom.
 */
export function mirrors(g: MapMasks, body: WaterBody): number {
  const { W } = g;
  const cells = new Set(body.cells);
  let acrossX = 0, acrossY = 0;
  for (const i of body.cells) {
    const x = i % W, y = (i / W) | 0;
    if (cells.has(y * W + (body.x0 + body.x1 - x))) acrossX++;
    if (cells.has((body.y0 + body.y1 - y) * W + x)) acrossY++;
  }
  return body.cells.length ? Math.max(acrossX, acrossY) / body.cells.length : 0;
}

/** How many of a body's four sides are framed by mountain: the border that makes a pool read as a
 *  box cut into the hill. */
export function mountainFrame(g: MapMasks, body: WaterBody): number {
  const { W, H } = g;
  const side = (cells: [number, number][]): boolean => {
    let seen = 0, mountain = 0;
    for (const [x, y] of cells) {
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      seen++;
      if (g.mountain[y * W + x]) mountain++;
    }
    return seen > 0 && mountain / seen >= FRAME_SHARE;
  };
  const top: [number, number][] = [], bottom: [number, number][] = [];
  for (let x = body.x0; x <= body.x1; x++) { top.push([x, body.y0 - 1]); bottom.push([x, body.y1 + 1]); }
  const west: [number, number][] = [], east: [number, number][] = [];
  for (let y = body.y0; y <= body.y1; y++) { west.push([body.x0 - 1, y]); east.push([body.x1 + 1, y]); }
  return [top, bottom, west, east].filter(side).length;
}

/** The longest side of a body's bounding box. */
export const extentOf = (b: WaterBody): number => Math.max(b.x1 - b.x0, b.y1 - b.y0) + 1;

/** Whether the body reaches the sea: a 4-neighbour off the grid or off the land mask. */
export function touchesOffLand(g: MapMasks, body: WaterBody): boolean {
  const { W, H } = g;
  for (const i of body.cells) {
    const x = i % W, y = (i / W) | 0;
    for (const [dx, dy] of NEIGHBORS4) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) return true;
      if (!g.land[ny * W + nx]) return true;
    }
  }
  return false;
}
