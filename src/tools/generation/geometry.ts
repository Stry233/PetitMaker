import type { MacroCoord } from '../../core/model/types';

/** The rounded centroid of a flat-index cell list on a `width`-wide grid. Callers guarantee a non-empty
 *  list (the zone-assembly path, which can see an empty zone, keeps its own `Math.max(1, …)` guard). */
export function centroid(cells: number[], width: number): MacroCoord {
  let sx = 0, sy = 0;
  for (const i of cells) { sx += i % width; sy += (i / width) | 0; }
  return { x: Math.round(sx / cells.length), y: Math.round(sy / cells.length) };
}

/** Comparator sorting catalog-like items LARGEST footprint (w×h) first — the "grandest" pick. */
export function bySizeDesc(p: { width: number; height: number }, q: { width: number; height: number }): number {
  return q.width * q.height - p.width * p.height;
}
