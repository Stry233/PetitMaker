/**
 * Cuts the planet's land into terrace plates: seeded slabs split along the potential field, merged
 * into plates, small fragments folded into their neighbours, and the plate graph's adjacency.
 */
import { floodFrom } from '../../../../core/grid/cell-sets';
import { rectSum, summedArea } from '../summed-area';
import { flatIndex, indexBounds, type Rect } from '../../../../core/grid/rect';
import { NEIGHBORS4, NEIGHBORS8 } from '../../../../core/grid/directions';
import { type Rng, mix, hash01 } from '../../../../core/base/rng';
import { lerpClamped } from '../../../../core/base/math';

/** One continuous terrace surface: a 4-connected run of buildable cells standing at one tier. */
export interface Plate {
  id: number;
  /** Bounding box of `cells`, in macro cells. */
  rect: Rect;
  /** Flat cell indices (`y * width + x`), ascending. */
  cells: number[];
  tier: number;
  /** Mean archetype potential over the plate, 0..1: what the tier was rounded from before the
   *  step and headroom caps were applied. */
  relief: number;
}

/** How many plates a map is cut into, at richness 0 and 1, before disconnected fragments are folded
 *  into their neighbours. A planet's coarse partition runs 17-24 blocks; a plate is one step
 *  coarser than a block, because the streets of stage B cut plates into blocks. */
const PLATE_COUNT = { low: 9, high: 24 } as const;
/** Plates a map may hold whatever the seed drew: the count band the tests hold this planner to. */
export const PLATE_COUNT_BAND = { min: 8, max: 29 } as const;
/** The shortest side a plate may be cut to. A composed place is 7x7 to 10x10 and a street runs
 *  beside it, so a narrower plate could hold neither. */
const PLATE_MIN_SIDE = 12;
/**
 * The same two numbers for a plate on the mass, where a plate is a terrace rather than a block.
 *
 * The mass is a staircase: a terraced planet's terraces run a few cells deep, and cutting
 * them at a town block's scale is what spread the wedding cake over a whole planet. Seven cells is
 * what a terrace has to hold to be walked on at all — a two-wide street with the dual-grid margin
 * either side of it, or the run of one ramp.
 */
const TERRACE_MIN_SIDE = 7;
const TERRACE_MIN_CELLS = 60;
/** Where the mass begins, as a share of the archetype's own top potential, and how much harder a
 *  slab standing there is cut. */
const MASSIF_FROM = 0.45;
const MASSIF_PULL = 2;
/** The fewest cells a plate may hold. Below this a fragment is folded into the neighbour it shares
 *  the most boundary with: a terrace nobody can stand a place on is a seam, not a surface. */
const PLATE_MIN_CELLS = 110;
/** How far a cut may sit from the middle of the slab it divides. Straight down the middle every time
 *  reads as a chequerboard; past this the two halves stop being comparable places. */
const SPLIT_JITTER = 0.3;

// --- the plates ----------------------------------------------------------------------------------

export function plateTarget(rng: Rng, richness: number): number {
  const base = Math.round(lerpClamped(PLATE_COUNT.low, PLATE_COUNT.high, richness));
  return clampInt(base + rng.int(4) - 1, PLATE_COUNT_BAND.min, PLATE_COUNT_BAND.max);
}

interface Slab { rect: Rect; land: number }

/**
 * Cuts the buildable planet into plates: a rectilinear subdivision of the land's bounding box, each
 * slab's land taken as a plate.
 *
 * The cut is rectilinear because the tier step drawn along it is what a district's boundary looks
 * like on the finished map, and a district's boundaries are straight. Where a cut falls is read
 * off the seed and the slab's own coordinates rather than off the rng stream, so a slab lands in the
 * same place however many slabs were considered before it. Where a slab's land falls
 * into more than one piece (a bay between two headlands), each piece is its own plate — a plate is a
 * surface, and two pieces that do not touch are two surfaces — and a piece too small to compose on
 * is folded into the neighbour it shares the most boundary with.
 */
export interface PlateCut {
  /** The land's bounding box, and roughly how many plates it is cut into. */
  box: Rect;
  target: number;
  salt: number;
  /** The archetype's potential, which the massif's finer cut reads. */
  field: Float32Array;
  massifPlates: number;
}

export function cutPlates(land: Uint8Array, W: number, H: number, cut: PlateCut): Plate[] {
  const { box, target, salt, field, massifPlates } = cut;
  const sum = summedArea(land, W, H);
  const lift = potentialSum(field, land, W, H);
  const slabs: Slab[] = [{ rect: box, land: rectSum(sum, W, box) }];
  const stuck = new Set<number>();
  // A slab's want is its land weighted by how high the composition wants it. The town is cut into
  // blocks and the mass into terraces, and a terrace is the narrower thing: the massif of a map
  // asked for eight tiers is a staircase of surfaces, so cutting it at a town block's scale spreads
  // the wedding cake over the whole planet and leaves
  // the walk one step per quarter of the map.
  const pull = massifPlates > 0 ? MASSIF_PULL : 0;
  const want = (slab: Slab): number =>
    slab.land * (1 + pull * meanIn(lift, W, slab.rect));
  for (;;) {
    let pick = -1;
    for (let k = 0; k < slabs.length; k++) {
      if (stuck.has(k)) continue;
      if (pick < 0 || want(slabs[k]!) > want(slabs[pick]!)) pick = k;
    }
    if (pick < 0) break;
    const slab = slabs[pick]!;
    const mass = meanIn(lift, W, slab.rect) >= MASSIF_FROM;
    if (slabs.length >= (mass ? target + massifPlates : target)) break;
    const split = splitSlab(slab, sum, W, mix(salt, slabs.length), mass);
    if (!split) { stuck.add(pick); continue; }
    slabs[pick] = split[0];
    slabs.push(split[1]);
    stuck.clear();
  }
  return platesFromSlabs(slabs, land, W, H, field);
}

/** Divides a slab across its longer side, at a seeded offset from the middle. Returns null when
 *  neither axis can be cut into two halves that still hold a plate's worth of land. A slab on the
 *  Mass is cut to a terrace's scale rather than a block's. */
function splitSlab(
  slab: Slab, sum: Int32Array, W: number, salt: number, mass: boolean,
): [Slab, Slab] | null {
  const side = mass ? TERRACE_MIN_SIDE : PLATE_MIN_SIDE;
  const least = mass ? TERRACE_MIN_CELLS : PLATE_MIN_CELLS;
  const order: ('x' | 'y')[] = slab.rect.w >= slab.rect.h ? ['x', 'y'] : ['y', 'x'];
  for (const axis of order) {
    const span = axis === 'x' ? slab.rect.w : slab.rect.h;
    if (span < 2 * side) continue;
    const lo = side, hi = span - side;
    const t = 0.5 + (hash01(salt, axis === 'x' ? slab.rect.x : slab.rect.y) - 0.5) * SPLIT_JITTER;
    const cut = clampInt(Math.round(span * t), lo, hi);
    const a: Rect = axis === 'x'
      ? { x: slab.rect.x, y: slab.rect.y, w: cut, h: slab.rect.h }
      : { x: slab.rect.x, y: slab.rect.y, w: slab.rect.w, h: cut };
    const b: Rect = axis === 'x'
      ? { x: slab.rect.x + cut, y: slab.rect.y, w: slab.rect.w - cut, h: slab.rect.h }
      : { x: slab.rect.x, y: slab.rect.y + cut, w: slab.rect.w, h: slab.rect.h - cut };
    const landA = rectSum(sum, W, a), landB = rectSum(sum, W, b);
    if (landA < least || landB < least) continue;
    return [{ rect: a, land: landA }, { rect: b, land: landB }];
  }
  return null;
}

/** Mean of a per-cell field over a rect, off its own integral image. */
function meanIn(sum: Float64Array, W: number, r: Rect): number {
  const stride = W + 1;
  const x0 = r.x, y0 = r.y, x1 = r.x + r.w, y1 = r.y + r.h;
  const total = sum[y1 * stride + x1]! - sum[y0 * stride + x1]! - sum[y1 * stride + x0]! + sum[y0 * stride + x0]!;
  const area = Math.max(1, r.w * r.h);
  return total / area;
}

/** Integral image of the potential over the planet, zero off it. */
function potentialSum(field: Float32Array, land: Uint8Array, W: number, H: number): Float64Array {
  const stride = W + 1;
  const sum = new Float64Array(stride * (H + 1));
  for (let y = 0; y < H; y++) {
    let row = 0;
    for (let x = 0; x < W; x++) {
      const i = flatIndex(x, y, W);
      row += land[i] ? field[i]! : 0;
      sum[(y + 1) * stride + x + 1] = sum[y * stride + x + 1]! + row;
    }
  }
  return sum;
}

/** The slabs' land as plates: one plate per connected piece, fragments folded into the neighbour
 *  they share the most boundary with, ids renumbered in raster order. */
function platesFromSlabs(
  slabs: readonly Slab[], land: Uint8Array, W: number, H: number, field: Float32Array,
): Plate[] {
  const owner = new Int16Array(W * H).fill(-1);
  const groups: number[][] = [];
  for (const slab of slabs) {
    const { x, y, w, h } = slab.rect;
    for (let cy = y; cy < y + h; cy++) {
      for (let cx = x; cx < x + w; cx++) {
        const i = flatIndex(cx, cy, W);
        if (!land[i] || owner[i]! >= 0) continue;
        // One connected piece of this slab's land.
        const id = groups.length;
        const reach = floodFrom([i], (j) => {
          const jx = j % W, jy = (j / W) | 0;
          return jx >= x && jy >= y && jx < x + w && jy < y + h && !!land[j] && owner[j]! < 0;
        }, W, H);
        const cells: number[] = [];
        for (let ry = y; ry < y + h; ry++) {
          for (let rx = x; rx < x + w; rx++) {
            const k = flatIndex(rx, ry, W);
            if (reach[k]) { owner[k] = id; cells.push(k); }
          }
        }
        groups.push(cells);
      }
    }
  }
  foldFragments(groups, owner, W, H, field);
  const kept = groups.filter((cells) => cells.length > 0);
  kept.sort((a, b) => a[0]! - b[0]!);
  return kept.map((cells, id) => ({ id, rect: indexBounds(cells, W), cells, tier: 0, relief: 0 }));
}

/** Folds every piece under `PLATE_MIN_CELLS` into the neighbouring piece it shares the most boundary
 *  with, smallest first, until no fragment has a neighbour left to join. A piece with no neighbour
 *  at all is an islet: it keeps its cells and stands as a plate of its own, since dropping it would
 *  leave buildable ground on no plate. */
function foldFragments(
  groups: number[][], owner: Int16Array, W: number, H: number, field: Float32Array,
): void {
  // A terrace is smaller than a block, so what counts as a fragment depends on where the piece
  // stands: on the mass a 60-cell surface is a step of the staircase, in the town it is a seam.
  const least = (cells: readonly number[]): number => {
    let sum = 0;
    for (const i of cells) sum += field[i]!;
    return cells.length && sum / cells.length >= MASSIF_FROM ? TERRACE_MIN_CELLS : PLATE_MIN_CELLS;
  };
  const islets = new Set<number>();
  for (;;) {
    let pick = -1;
    for (let id = 0; id < groups.length; id++) {
      const n = groups[id]!.length;
      if (n === 0 || n >= least(groups[id]!) || islets.has(id)) continue;
      if (pick < 0 || n < groups[pick]!.length) pick = id;
    }
    if (pick < 0) return;
    const shared = new Map<number, number>();
    for (const i of groups[pick]!) {
      const x = i % W, y = (i / W) | 0;
      for (const [dx, dy] of NEIGHBORS4) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const other = owner[flatIndex(nx, ny, W)]!;
        if (other < 0 || other === pick) continue;
        shared.set(other, (shared.get(other) ?? 0) + 1);
      }
    }
    if (shared.size === 0) { islets.add(pick); continue; }
    let best = -1, bestCount = -1;
    for (const [id, count] of [...shared.entries()].sort((a, b) => a[0] - b[0])) {
      if (count > bestCount) { best = id; bestCount = count; }
    }
    for (const i of groups[pick]!) owner[i] = best;
    groups[best] = [...groups[best]!, ...groups[pick]!].sort((a, b) => a - b);
    groups[pick] = [];
  }
}

/**
 * Every pair of plates that touch, each pair once, in id order.
 *
 * Touching includes a diagonal touch, and it has to: V-MTN-03 reads the whole 3x3 around a cell, so
 * a plate whose corner cell meets another plate's corner cell has that cell's tier inside the window
 * it must be supported by. Two independent cuts can land on one coordinate and produce a `+`
 * junction where four plates meet at a point, and edge-only adjacency would bound those diagonal
 * pairs at twice the step, through the two plates between them, rather than at the step.
 */
export function plateAdjacency(plates: readonly Plate[], plateOf: Int16Array, W: number, H: number): [number, number][] {
  const seen = new Set<number>();
  const out: [number, number][] = [];
  for (const plate of plates) {
    for (const i of plate.cells) {
      const x = i % W, y = (i / W) | 0;
      for (const [dx, dy] of NEIGHBORS8) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const other = plateOf[flatIndex(nx, ny, W)]!;
        if (other < 0 || other === plate.id) continue;
        const lo = Math.min(plate.id, other), hi = Math.max(plate.id, other);
        const key = lo * plates.length + hi;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push([lo, hi]);
      }
    }
  }
  out.sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]));
  return out;
}

/** The plate holding the buildable cell nearest the plaza's centre. */
export function nearestPlateTo(plates: readonly Plate[], plateOf: Int16Array, W: number, H: number, hub: { x: number; y: number }): number {
  let best = plates.length ? plates[0]!.id : -1, bestD = Infinity;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const id = plateOf[flatIndex(x, y, W)]!;
      if (id < 0) continue;
      const d = Math.hypot(x - hub.x, y - hub.y);
      if (d < bestD) { bestD = d; best = id; }
    }
  }
  return best;
}

// --- arithmetic ----------------------------------------------------------------------------------

export const clampInt = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, Math.round(v)));
