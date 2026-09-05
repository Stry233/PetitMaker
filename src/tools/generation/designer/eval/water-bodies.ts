/**
 * THE MAP'S WATER, DECOMPOSED — and the shape questions every water reading asks of one body.
 *
 * A body is read the way the references were: 4-connected and elevation-blind. The
 * predicates beside it (does it mirror, does it band, is it long and thin, is it framed by
 * mountain, does a crossing stand at it) are the vocabulary the ledger, the fountain reading, the
 * stream reading and the composition table all argue in, so they cannot disagree about what they
 * are looking at.
 */
import { detectWaterfalls } from '../../../../core/model/waterfall-geometry';
import type { GridState } from '../../../../core/model/types';
import { NB4, type EvalGrid } from './grid';

/** The largest body that counts as a named ACCENT rather than a feature. The style target carries 32
 *  bodies of six cells or fewer holding 2.6% of its water: a landscape pool beside a path, not
 *  something the map has to account for. */
export const WATER_ACCENT_MAX = 6;

/** Share of a side that has to be mountain for the side to read as framed. */
const FRAME_SHARE = 0.6;

/** Band flips on one axis that make a body a COMB, the threshold the references were read at. */
export const COMB_FLIPS_MIN = 4;

/** One body of water: 4-connected, elevation-blind. */
export interface WaterBody {
  cells: number[];
  x0: number; y0: number; x1: number; y1: number;
  tiers: Set<number>;
  /** Enclosed dry ground inside the bounding box that cannot reach its border through non-body
   *  cells: an island, a platform, a glyph stroke. */
  holes: number;
  faced: boolean;
  fill: number;
}

/** Memo per grid: the ledger, the fountain reading, the stream reading and the figure all decompose
 *  the same finished map in one evaluation pass. Callers share the bodies, so a WaterBody coming out
 *  of here is read, never mutated (a merge clones its host first). */
const bodiesMemo = new WeakMap<EvalGrid, WaterBody[]>();

/** Every body on the map, largest first. The state is read too, because whether a body presents a
 *  CAPPED waterfall face is the shared reader's answer and not a shape question. */
export function waterBodies(g: EvalGrid, state: GridState): WaterBody[] {
  const hit = bodiesMemo.get(g);
  if (hit) return hit;
  const out = waterBodiesUncached(g, state);
  bodiesMemo.set(g, out);
  return out;
}

function waterBodiesUncached(g: EvalGrid, state: GridState): WaterBody[] {
  const { W, H } = g;
  const facedCells = new Set<number>();
  for (const fall of detectWaterfalls(state)) {
    for (const c of fall.cells) facedCells.add(c.y * W + c.x);
  }
  const seen = new Uint8Array(W * H);
  const out: WaterBody[] = [];
  for (let s = 0; s < W * H; s++) {
    if (!g.water[s] || seen[s]) continue;
    const cells: number[] = [];
    const stack = [s]; seen[s] = 1;
    while (stack.length) {
      const p = stack.pop()!;
      cells.push(p);
      const x = p % W, y = (p / W) | 0;
      for (const [dx, dy] of NB4) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const j = ny * W + nx;
        if (!g.water[j] || seen[j]) continue;
        seen[j] = 1; stack.push(j);
      }
    }
    let x0 = W, y0 = H, x1 = -1, y1 = -1;
    const tiers = new Set<number>();
    for (const i of cells) {
      const x = i % W, y = (i / W) | 0;
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      tiers.add(g.elev[i]!);
    }
    const box = (x1 - x0 + 1) * (y1 - y0 + 1);
    out.push({
      cells, x0, y0, x1, y1, tiers,
      holes: holesOf(g, cells, x0, y0, x1, y1),
      faced: cells.some((i) => facedCells.has(i)),
      fill: cells.length / box,
    });
  }
  return out.sort((a, b) => b.cells.length - a.cells.length);
}

/** Enclosed dry components inside a body's bounding box. */
function holesOf(g: EvalGrid, cells: number[], x0: number, y0: number, x1: number, y1: number): number {
  const { W } = g;
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
  const inBody = new Set(cells);
  const out = new Uint8Array(bw * bh);
  const queue: number[] = [];
  const push = (x: number, y: number): void => {
    const i = y * bw + x;
    if (out[i] || inBody.has((y + y0) * W + x + x0)) return;
    out[i] = 1; queue.push(i);
  };
  for (let x = 0; x < bw; x++) { push(x, 0); push(x, bh - 1); }
  for (let y = 0; y < bh; y++) { push(0, y); push(bw - 1, y); }
  for (let head = 0; head < queue.length; head++) {
    const p = queue[head]!;
    const x = p % bw, y = (p / bw) | 0;
    for (const [dx, dy] of NB4) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= bw || ny >= bh) continue;
      push(nx, ny);
    }
  }
  let holes = 0;
  const seen = new Uint8Array(bw * bh);
  for (let i = 0; i < out.length; i++) {
    const x = i % bw, y = (i / bw) | 0;
    if (out[i] || seen[i] || inBody.has((y + y0) * W + x + x0)) continue;
    holes++;
    const stack = [i]; seen[i] = 1;
    while (stack.length) {
      const p = stack.pop()!;
      const px = p % bw, py = (p / bw) | 0;
      for (const [dx, dy] of NB4) {
        const nx = px + dx, ny = py + dy;
        if (nx < 0 || ny < 0 || nx >= bw || ny >= bh) continue;
        const j = ny * bw + nx;
        if (seen[j] || out[j] || inBody.has((ny + y0) * W + nx + x0)) continue;
        seen[j] = 1; stack.push(j);
      }
    }
  }
  return holes;
}

/**
 * How many times a body's bounding box flips between mostly-wet and mostly-dry bands, on its better
 * axis, where a band counts as water at 50% or more: the comb reading.
 */
export function bandFlips(g: EvalGrid, body: WaterBody): number {
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
export function spannedByCrossing(g: EvalGrid, body: WaterBody): boolean {
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
export function bodiesTouch(g: EvalGrid, a: WaterBody, b: WaterBody): boolean {
  if (a.x0 > b.x1 + 2 || b.x0 > a.x1 + 2 || a.y0 > b.y1 + 2 || b.y0 > a.y1 + 2) return false;
  const { W } = g;
  const cells = new Set(b.cells);
  for (const i of a.cells) {
    const x = i % W, y = (i / W) | 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) if (cells.has((y + dy) * W + x + dx)) return true;
    }
  }
  return false;
}

/**
 * How well a body mirrors about the BETTER axis of its own box, 0 to 1: the reading that separates a
 * composed court from a blob that happens to hold an island.
 *
 * ONE AXIS, not both. Requiring both fails a figure drawn as a single symmetric shape: a heart standing
 * in a flooded panel mirrors left to right and not top to bottom, so the banner carrying it reads as
 * unexplained water on the map's highest terrace. Only bodies that already hold an enclosed island are
 * asked this question, so a plain rectangle — which mirrors perfectly on both axes — is not accounted
 * by it.
 */
export function mirrors(g: EvalGrid, body: WaterBody): number {
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

/** How many of a body's four sides are framed by MOUNTAIN: the border that makes a pool read as a
 *  box cut into the hill. */
export function mountainFrame(g: EvalGrid, body: WaterBody): number {
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

/** The longest side of a body's bounding box: how far it reaches, which is what a course is. */
export const extentOf = (b: WaterBody): number => Math.max(b.x1 - b.x0, b.y1 - b.y0) + 1;

/** Whether the body reaches ground that is not the buildable island: the sea. */
export function touchesOffLand(g: EvalGrid, body: WaterBody): boolean {
  const { W, H } = g;
  for (const i of body.cells) {
    const x = i % W, y = (i / W) | 0;
    for (const [dx, dy] of NB4) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) return true;
      if (!g.land[ny * W + nx]) return true;
    }
  }
  return false;
}
