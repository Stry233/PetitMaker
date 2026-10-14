/**
 * The map's water, decomposed into bodies. A body is 4-connected and elevation-blind, as the game's
 * built-in planets read.
 */
import { detectWaterfalls } from '../../core/domain/terrain/waterfall-geometry';
import type { GridState } from '../../core/model/types';
import type { MapMasks } from './masks';
import { componentCells, enclosedPieces, labelComponents } from '../../core/grid/cell-sets';

/** One body of water: 4-connected, elevation-blind. */
export interface WaterBody {
  cells: number[];
  x0: number; y0: number; x1: number; y1: number;
  tiers: Set<number>;
  /** Enclosed dry ground inside the bounding box that cannot reach its border through non-body
   *  cells: an islet, a platform, a glyph stroke. */
  holes: number;
  faced: boolean;
  fill: number;
}

/** Memo per mask set and state: the ledger, the fountain reading, the stream reading and the figure
 *  all decompose the same finished map in one evaluation pass. `faced` depends on the state, so a
 *  hit needs both. Callers share the bodies, so a WaterBody coming out of here is read, never mutated
 *  (a merge clones its host first). */
const bodiesMemo = new WeakMap<MapMasks, { state: GridState; bodies: WaterBody[] }>();

/** Every body on the map, largest first. The state is read too, because whether a body presents a
 *  capped waterfall face is the shared reader's answer and not a shape question. */
export function waterBodies(g: MapMasks, state: GridState): WaterBody[] {
  const hit = bodiesMemo.get(g);
  if (hit && hit.state === state) return hit.bodies;
  const bodies = waterBodiesUncached(g, state);
  bodiesMemo.set(g, { state, bodies });
  return bodies;
}

function waterBodiesUncached(g: MapMasks, state: GridState): WaterBody[] {
  const { W, H } = g;
  const facedCells = new Set<number>();
  for (const fall of detectWaterfalls(state)) {
    for (const c of fall.cells) facedCells.add(c.y * W + c.x);
  }
  const out: WaterBody[] = [];
  const { labels, sizes } = labelComponents(g.water, W, H);
  for (const cells of componentCells(labels, sizes.length - 1)) {
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
      holes: holesOf(g, { cells, x0, y0, x1, y1 }),
      faced: cells.some((i) => facedCells.has(i)),
      fill: cells.length / box,
    });
  }
  return out.sort((a, b) => b.cells.length - a.cells.length);
}

/** Enclosed dry components inside a body's bounding box. */
function holesOf(g: MapMasks, { cells, x0, y0, x1, y1 }: { cells: number[]; x0: number; y0: number; x1: number; y1: number }): number {
  const { W } = g;
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
  const body = new Uint8Array(bw * bh);
  for (const i of cells) body[(((i / W) | 0) - y0) * bw + (i % W) - x0] = 1;
  return enclosedPieces(body, bw, bh);
}
