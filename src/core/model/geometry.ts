// Measuring a SET OF CELLS, in the flat-index convention `grid-model.ts` establishes: a cell is
// `y * width + x`, and a set is a plain list of those. Nothing here reads a grid, a catalog or a
// store — the caller has already decided which cells it means.
import type { MacroCoord } from './types';

/** The rounded centroid of a flat-index cell list on a `width`-wide grid. Callers guarantee a non-empty
 *  list (the zone-assembly path, which can see an empty zone, keeps its own `Math.max(1, …)` guard). */
export function centroid(cells: number[], width: number): MacroCoord {
  let sx = 0, sy = 0;
  for (const i of cells) { sx += i % width; sy += (i / width) | 0; }
  return { x: Math.round(sx / cells.length), y: Math.round(sy / cells.length) };
}

/** The cell of `cells` nearest to `p` (pulls a centroid that landed outside an irregular region in —
 *  the centroid of a ring-shaped region sits in the hole, which belongs to no region or to another). */
export function nearestRegionCell(p: MacroCoord, cells: number[], width: number): MacroCoord {
  let best = cells[0]!, bd = Infinity;
  for (const i of cells) {
    const x = i % width, y = (i / width) | 0, d = (x - p.x) * (x - p.x) + (y - p.y) * (y - p.y);
    if (d < bd) { bd = d; best = i; }
  }
  return { x: best % width, y: (best / width) | 0 };
}

/** Largest 4-connected component of a cell set. Neighbours are the ±1/±W INDEX deltas, so a set
 *  spanning a whole row joins (W-1, y) to (0, y+1); every caller today passes a local patch. */
export function largestComponent(cells: number[], W: number): number[] {
  const set = new Set(cells);
  const seen = new Set<number>();
  let best: number[] = [];
  for (const s of cells) {
    if (seen.has(s)) continue;
    const comp: number[] = [], q = [s];
    seen.add(s);
    while (q.length) {
      const i = q.pop()!;
      comp.push(i);
      for (const d of [1, -1, W, -W]) {
        const n = i + d;
        if (set.has(n) && !seen.has(n)) { seen.add(n); q.push(n); }
      }
    }
    if (comp.length > best.length) best = comp;
  }
  return best;
}

/** Comparator sorting catalog-like items LARGEST footprint (w×h) first — the "grandest" pick. */
export function bySizeDesc(p: { width: number; height: number }, q: { width: number; height: number }): number {
  return q.width * q.height - p.width * p.height;
}
