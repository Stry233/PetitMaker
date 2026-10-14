// Measuring a set of cells, in the flat-index convention of `rect.ts:flatIndex`: a cell is
// `y * width + x`, and a set is a plain list of those. Nothing here reads a grid, a catalog or a
// store — the caller has already decided which cells it means.
import type { MacroCoord } from '../base/coords';
import { NEIGHBORS4, NEIGHBORS8 } from './directions';
import { flatIndex } from './rect';

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

/** Largest 4-connected component of a cell set on a `W`-wide grid. A row's last cell and the next
 *  row's first are not neighbours. */
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
      const x = i % W;
      for (const n of [x < W - 1 ? i + 1 : -1, x > 0 ? i - 1 : -1, i + W, i - W]) {
        if (n >= 0 && set.has(n) && !seen.has(n)) { seen.add(n); q.push(n); }
      }
    }
    if (comp.length > best.length) best = comp;
  }
  return best;
}

/** Comparator sorting catalog-like items largest footprint (w×h) first — the "grandest" pick. */
export function bySizeDesc(p: { width: number; height: number }, q: { width: number; height: number }): number {
  return q.width * q.height - p.width * p.height;
}

/** Multi-source BFS distance (in cells) from `seeds` over a width×height grid. Deterministic.
 *  Shared by elevation (ridge crest falloff), hydrology (shores), and the placement analysis.
 *  `diag` picks the metric: false = Manhattan (4-neighbour; erosion by its diamond ball chamfers
 *  rectangle corners at 45°), true = Chebyshev (8-neighbour; erosion keeps rectangles rectangular
 *  — the generator's rectilinear style relies on this). */
const DIST_FAR = 30000;

export function stepDistance(seeds: number[], width: number, height: number, diag = false): Int16Array {
  const dist = new Int16Array(width * height).fill(DIST_FAR);
  const frontier: number[] = [];
  for (const s of seeds) if (s >= 0 && s < dist.length && dist[s] === DIST_FAR) { dist[s] = 0; frontier.push(s); }
  relaxFrontier(dist, frontier, width, height, diag);
  return dist;
}

/** The BFS relaxation kernel of stepDistance: propagate
 *  dist+1 improvements outward from `frontier` until no cell improves. */
function relaxFrontier(dist: Int16Array, frontier: number[], width: number, height: number, diag: boolean): void {
  const neighbors = diag ? NEIGHBORS8 : NEIGHBORS4;
  while (frontier.length) {
    const next: number[] = [];
    for (const i of frontier) {
      const x = i % width, y = (i / width) | 0;
      for (const [dx, dy] of neighbors) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const j = flatIndex(nx, ny, width);
        if (dist[j]! > dist[i]! + 1) { dist[j] = (dist[i]! + 1) as number; next.push(j); }
      }
    }
    frontier = next;
  }
}

/** What a 4-connected walk from `seeds` reaches, over whatever the caller counts as passable. */
export function floodFrom(
  seeds: Iterable<number>, passable: (i: number) => boolean, W: number, H: number,
): Uint8Array {
  const reach = new Uint8Array(W * H);
  const queue: number[] = [];
  for (const i of seeds) if (i >= 0 && i < reach.length && !reach[i]) { reach[i] = 1; queue.push(i); }
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q]!;
    const x = i % W, y = (i / W) | 0;
    for (const [dx, dy] of NEIGHBORS4) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const ni = ny * W + nx;
      if (reach[ni] || !passable(ni)) continue;
      reach[ni] = 1; queue.push(ni);
    }
  }
  return reach;
}

/** The 4-connected piece each cell of `cells` belongs to. */
export function components(cells: ReadonlySet<number>, W: number, H: number): Map<number, number> {
  const comp = new Map<number, number>();
  let next = 0;
  for (const seed of cells) {
    if (comp.has(seed)) continue;
    const id = next++;
    comp.set(seed, id);
    const queue = [seed];
    for (let q = 0; q < queue.length; q++) {
      const i = queue[q]!, x = i % W, y = (i / W) | 0;
      for (const [dx, dy] of NEIGHBORS4) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const ni = ny * W + nx;
        if (cells.has(ni) && !comp.has(ni)) { comp.set(ni, id); queue.push(ni); }
      }
    }
  }
  return comp;
}

/** Connected components of the set cells: labels from 1 (0 for clear cells) and each size. Labels
 *  follow the raster order of each component's first cell. `joins(i, j)`, when given, must also
 *  admit the step between two set neighbours; it is expected to be an equivalence such as equal
 *  height, so a component does not depend on where its walk started. */
export function labelComponents(
  mask: Uint8Array, w: number, h: number, eight = false, joins?: (i: number, j: number) => boolean,
): { labels: Int32Array; sizes: number[] } {
  const labels = new Int32Array(w * h);
  const sizes = [0];
  const stack = new Int32Array(w * h);
  for (let s = 0; s < w * h; s++) {
    if (!mask[s] || labels[s]) continue;
    const id = sizes.length;
    let top = 0;
    let size = 0;
    stack[top++] = s;
    labels[s] = id;
    while (top > 0) {
      const i = stack[--top]!;
      size++;
      const x = i % w;
      const y = (i - x) / w;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          if ((dx === 0 && dy === 0) || (!eight && dx !== 0 && dy !== 0)) continue;
          const nx = x + dx;
          if (nx < 0 || nx >= w) continue;
          const j = ny * w + nx;
          if (mask[j] && !labels[j] && (!joins || joins(i, j))) {
            labels[j] = id;
            stack[top++] = j;
          }
        }
      }
    }
    sizes.push(size);
  }
  return { labels, sizes };
}

/** How many 4-connected pieces of the clear cells cannot reach the grid's border without crossing a
 *  set cell of `mask`: the holes a figure encloses within its box. */
export function enclosedPieces(mask: Uint8Array, w: number, h: number): number {
  const clear = (i: number): boolean => !mask[i];
  const border: number[] = [];
  for (let x = 0; x < w; x++) border.push(x, (h - 1) * w + x);
  for (let y = 0; y < h; y++) border.push(y * w, y * w + w - 1);
  const outside = floodFrom(border.filter(clear), clear, w, h);
  const enclosed = new Uint8Array(w * h);
  for (let i = 0; i < enclosed.length; i++) enclosed[i] = !outside[i] && clear(i) ? 1 : 0;
  return labelComponents(enclosed, w, h).sizes.length - 1;
}

/** The cells of each `labelComponents` component in raster order: entry `k` holds label `k + 1`. */
export function componentCells(labels: Int32Array, count: number): number[][] {
  const out = Array.from({ length: count }, () => [] as number[]);
  for (let i = 0; i < labels.length; i++) if (labels[i]) out[labels[i]! - 1]!.push(i);
  return out;
}
