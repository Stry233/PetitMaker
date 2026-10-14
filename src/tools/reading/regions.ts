/**
 * The map's open ground, cut into the runs a composed place is made of: a region is a 4-connected run
 * of open land cut by pavement, water and terrace step.
 */
import { componentCells, labelComponents } from '../../core/grid/cell-sets';
import type { MapMasks } from './masks';

/** The symmetry-and-unity reading counts regions of at least this many cells. */
const REGION_MIN_CELLS = 20;

export interface Region { cells: number[]; elevation: number }

/** Memo per mask set: several readings segment the same finished map in one evaluation pass, and the
 *  flood fill is pure in `g`. Callers share the arrays, so a Region is read, never mutated. */
const regionsMemo = new WeakMap<MapMasks, Map<number, Region[]>>();

/** 4-connected components of open land (not paved, not water, not under the
 *  anchor landmark), cut wherever the surface elevation changes. Terraces are what separate one composed
 *  place from the next; a segmentation that ignores them returns one planet-sized blob. */
export function segmentRegions(g: MapMasks, minCells = REGION_MIN_CELLS): Region[] {
  let byMin = regionsMemo.get(g);
  if (!byMin) regionsMemo.set(g, byMin = new Map());
  const hit = byMin.get(minCells);
  if (hit) return hit;
  const out = segmentRegionsUncached(g, minCells);
  byMin.set(minCells, out);
  return out;
}

function segmentRegionsUncached(g: MapMasks, minCells: number): Region[] {
  const { W, H } = g;
  const open = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) if (g.land[i] && !g.paved[i] && !g.water[i] && !g.anchor[i]) open[i] = 1;
  const { labels, sizes } = labelComponents(open, W, H, false, (i, j) => g.elev[i] === g.elev[j]);
  const out: Region[] = [];
  for (const cells of componentCells(labels, sizes.length - 1)) {
    if (cells.length >= minCells) out.push({ cells, elevation: g.elev[cells[0]!]! });
  }
  out.sort((a, b) => b.cells.length - a.cells.length);
  return out;
}
