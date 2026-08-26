/**
 * THE GRID AS THE EVALUATOR READS IT, and the two decompositions every reading is built on.
 *
 * One pass over a finished `GridState` turns it into parallel masks (`readGrid`), and everything
 * else in `eval/` reads those rather than the map: a reading that walked the cells itself would
 * answer a slightly different question about what land, pavement or a plant IS.
 *
 * DEFINITIONS follow the ones the decoded expert maps were measured by, so a score can be compared
 * against them directly: land = Grass zone cells; surface elevation is
 * the cell's own `terrain.elevation` (0 where null); paved = a road-category coating; a region is a
 * 4-connected run of open land cut by pavement, water AND terrace step; symmetry is a same-species
 * mirror match over a region's plants.
 *
 * BOTH ROAD-WIDTH MEASURES LIVE HERE, and they answer different questions. The RUN measure is the one
 * the reference tables use (min of the horizontal and vertical paved run through a cell), which is what
 * makes the width mix comparable to them. The hard rule is judged on the OPENING measure instead — the
 * largest all-paved SQUARE a cell sits in — because that is the width a walker sees: a paved square
 * reads its whole extent under both, but a 1-cell staircase running diagonally reads 2 under the run
 * measure (two cells across in each axis) and 1 under the opening, which is what it draws as.
 */
import { ItemCategory, CellZone, TerrainType, type GridState } from '../../../../core/model/types';
import { categoryOf } from '../../../../state/catalog';
import { objectRect } from '../../../../state/object-geometry';

/** The reference's symmetry-and-unity reading: regions of >= 20 cells holding >= 8 decor objects,
 *  mirror match >= 0.6 counts as symmetric, dominant colour family >= 60% counts as unified. */
export const REGION_MIN_CELLS = 20;

export const REGION_MIN_DECOR = 8;

export const SYMMETRY_MATCH_MIN = 0.6;

export const UNITY_SHARE_MIN = 0.6;

export const NB4 = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;

export interface EvalGrid {
  W: number; H: number;
  /** Grass-zone cells: the buildable island, the denominator of every share. */
  land: Uint8Array;
  elev: Int8Array;
  mountain: Uint8Array;
  water: Uint8Array;
  paved: Uint8Array;
  /** Bridge and ramp footprints — the links that join two paved levels into one network. */
  crossing: Uint8Array;
  /** Building and facility footprints: a place a street can ARRIVE at. */
  structure: Uint8Array;
  plaza: Uint8Array;
  /** Any object footprint (object cover). */
  covered: Uint8Array;
  /** catalogId of the tree/flora standing on the cell, first placement wins. */
  plantAt: (string | undefined)[];
  landCells: number;
}

export function readGrid(state: GridState): EvalGrid {
  const W = state.template.width, H = state.template.height, N = W * H;
  const g: EvalGrid = {
    W, H,
    land: new Uint8Array(N), elev: new Int8Array(N), mountain: new Uint8Array(N),
    water: new Uint8Array(N), paved: new Uint8Array(N), crossing: new Uint8Array(N),
    structure: new Uint8Array(N), plaza: new Uint8Array(N), covered: new Uint8Array(N),
    plantAt: new Array<string | undefined>(N).fill(undefined), landCells: 0,
  };
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const cell = state.cells[y]![x]!;
      const i = y * W + x;
      if (cell.zone === CellZone.Grass) { g.land[i] = 1; g.landCells++; }
      const t = cell.terrain;
      if (!t) continue;
      g.elev[i] = t.elevation;
      if (t.type === TerrainType.Mountain) g.mountain[i] = 1;
      else if (t.type === TerrainType.Water) g.water[i] = 1;
    }
  }
  for (const o of state.objects.values()) {
    const cat = categoryOf(o);
    const r = objectRect(o);
    const plant = cat === ItemCategory.Tree || cat === ItemCategory.Flora;
    for (let y = Math.floor(r.y); y < Math.ceil(r.y + r.h); y++) {
      for (let x = Math.floor(r.x); x < Math.ceil(r.x + r.w); x++) {
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        const i = y * W + x;
        g.covered[i] = 1;
        if (o.locked) g.plaza[i] = 1;
        if (cat === ItemCategory.Road) g.paved[i] = 1;
        else if (cat === ItemCategory.Bridge || cat === ItemCategory.Ramp) g.crossing[i] = 1;
        else if (plant && g.plantAt[i] === undefined) g.plantAt[i] = o.catalogId;
        else if (cat === ItemCategory.Building || cat === ItemCategory.Facility) g.structure[i] = 1;
      }
    }
  }
  return g;
}

/** Per-cell corridor width by the RUN definition: min(horizontal run, vertical run). 0 off the
 *  pavement. A wide street and a small square both read their extent under it. */
export function runWidths(paved: Uint8Array, W: number, H: number): Uint8Array {
  const out = new Uint8Array(W * H);
  const run = (x: number, y: number, horiz: boolean): number => {
    let n = 1;
    for (let k = 1; ; k++) {
      const nx = horiz ? x + k : x, ny = horiz ? y : y + k;
      if (nx >= W || ny >= H || !paved[ny * W + nx]) break;
      n++;
    }
    for (let k = 1; ; k++) {
      const nx = horiz ? x - k : x, ny = horiz ? y : y - k;
      if (nx < 0 || ny < 0 || !paved[ny * W + nx]) break;
      n++;
    }
    return n;
  };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (paved[i]) out[i] = Math.min(run(x, y, true), run(x, y, false));
  }
  return out;
}

/** Per-cell width by morphological OPENING: the largest k for which the cell lies inside some
 *  all-paved k x k square. Parity-safe (a 2-wide street reads 2, unlike a distance transform) and
 *  strictly stricter than the run measure — every run-1 cell is opening-1, plus the diagonal
 *  staircases a run measure calls 2-wide. This is what the no-1-wide hard rule reads. */
export function openingWidths(paved: Uint8Array, W: number, H: number, maxK = 12): Uint8Array {
  const out = new Uint8Array(W * H);
  // Integral image of the paved mask: rect sums in O(1).
  const sum = new Int32Array((W + 1) * (H + 1));
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    sum[(y + 1) * (W + 1) + (x + 1)] =
      (paved[y * W + x] ? 1 : 0) + sum[y * (W + 1) + (x + 1)]! + sum[(y + 1) * (W + 1) + x]! - sum[y * (W + 1) + x]!;
  }
  const rect = (x: number, y: number, w: number, h: number): number =>
    sum[(y + h) * (W + 1) + (x + w)]! - sum[y * (W + 1) + (x + w)]! - sum[(y + h) * (W + 1) + x]! + sum[y * (W + 1) + x]!;
  for (let k = 1; k <= Math.min(maxK, W, H); k++) {
    // Corners of every all-paved k x k square, then a second integral image so "is any such corner
    // inside the k x k window ending at this cell" is O(1) too.
    const corner = new Int32Array((W + 1) * (H + 1));
    let any = false;
    for (let y = 0; y + k <= H; y++) for (let x = 0; x + k <= W; x++) {
      if (rect(x, y, k, k) === k * k) { corner[(y + 1) * (W + 1) + (x + 1)] = 1; any = true; }
    }
    if (!any) break;
    for (let y = 1; y <= H; y++) for (let x = 1; x <= W; x++) {
      corner[y * (W + 1) + x] = corner[y * (W + 1) + x]! + corner[(y - 1) * (W + 1) + x]! + corner[y * (W + 1) + (x - 1)]! - corner[(y - 1) * (W + 1) + (x - 1)]!;
    }
    const cSum = (x: number, y: number, w: number, h: number): number =>
      corner[(y + h) * (W + 1) + (x + w)]! - corner[y * (W + 1) + (x + w)]! - corner[(y + h) * (W + 1) + x]! + corner[y * (W + 1) + x]!;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (!paved[i]) continue;
      const x0 = Math.max(0, x - k + 1), y0 = Math.max(0, y - k + 1);
      if (cSum(x0, y0, x - x0 + 1, y - y0 + 1) > 0) out[i] = k;
    }
  }
  return out;
}

export interface Region { cells: number[]; elevation: number }

/** 4-connected components of open land (not paved, not water, not under the
 *  plaza), cut wherever the surface elevation changes. Terraces are what separate one composed
 *  place from the next; a segmentation that ignores them returns one island-sized blob. */
export function segmentRegions(g: EvalGrid, minCells = REGION_MIN_CELLS): Region[] {
  const { W, H } = g;
  const open = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) if (g.land[i] && !g.paved[i] && !g.water[i] && !g.plaza[i]) open[i] = 1;
  const seen = new Uint8Array(W * H);
  const out: Region[] = [];
  for (let s = 0; s < W * H; s++) {
    if (!open[s] || seen[s]) continue;
    const stack = [s]; seen[s] = 1;
    const cells: number[] = [];
    while (stack.length) {
      const p = stack.pop()!;
      cells.push(p);
      const x = p % W, y = (p / W) | 0;
      for (const [dx, dy] of NB4) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const j = ny * W + nx;
        if (!open[j] || seen[j] || g.elev[j] !== g.elev[p]) continue;
        seen[j] = 1; stack.push(j);
      }
    }
    if (cells.length >= minCells) out.push({ cells, elevation: g.elev[s]! });
  }
  out.sort((a, b) => b.cells.length - a.cells.length);
  return out;
}

export interface RegionDecor { x: number; y: number; id: string }

export function regionDecor(g: EvalGrid, region: Region): RegionDecor[] {
  const out: RegionDecor[] = [];
  for (const i of region.cells) {
    const id = g.plantAt[i];
    if (id !== undefined) out.push({ x: i % g.W, y: (i / g.W) | 0, id });
  }
  return out;
}

/** Best mirror-match score over the vertical and horizontal axes. The axis is scanned in half-cell
 *  steps but held to the middle third of the decor cloud, and a plant matches only the SAME
 *  catalogId at the mirrored cell, which is the definition the reference was read by. */
export function mirrorScore(decor: RegionDecor[]): { v: number; h: number } {
  const at = new Map<string, string>();
  for (const d of decor) at.set(`${d.x},${d.y}`, d.id);
  const best = (axis: 'v' | 'h'): number => {
    const vals = decor.map((d) => (axis === 'v' ? d.x : d.y));
    const lo = Math.min(...vals), hi = Math.max(...vals);
    let score = 0;
    for (let twice = 2 * lo; twice <= 2 * hi; twice++) {
      if (Math.abs(twice - (lo + hi)) > (hi - lo) * 0.34) continue;
      let match = 0;
      for (const d of decor) {
        const v = axis === 'v' ? d.x : d.y;
        const key = axis === 'v' ? `${twice - v},${d.y}` : `${d.x},${twice - v}`;
        if (at.get(key) === d.id) match++;
      }
      score = Math.max(score, match / decor.length);
    }
    return score;
  };
  return { v: best('v'), h: best('h') };
}
