import { LANDMARKS, type LandmarkSpec } from '../../../core/game/profile';
import type { GroundReading } from './classify';
import { median } from '../../../core/base/math';
import { GRASS, labDistance, SEA } from './color';
import type { CellEvidence } from './evidence';
import { chessboardDistance } from './raster';
import { SCAN_PROFILE } from '../profile';

// The landmarks of a scan, read from its evidence alone in two steps. First the footprint is found
// by contrast: the vote is the colour's share at the evidence's sample points that is neither the
// ground the cell reads nor sea (any colour but grass and sea on cells read as grass, for the
// plaza; any but sea on cells read as sea, for the station). Paving, roads, paths and roofs that do
// not read as grass all vote alike, so this finds where the landmark is but not exactly where its
// footprint lies. The footprint is weighed at every half-cell position by how far the vote inside
// it exceeds the vote in a ring round it. Then the footprint is laid on the landmark's own outline
// near that fit, from the colour steps at the sample points (`outlinePlacement`). Neither step
// anchors on what the paving covers or what stands at its back, which vary between planets.

const L = SCAN_PROFILE.landmarkSearch;

/** Contrasts closer than this are alike; it only absorbs rounding. */
const TIE = 1e-9;

/** A footprint position in cells and whether a placement there suits the ground. */
interface Fit {
  readonly x: number;
  readonly y: number;
  readonly fits: (x: number, y: number) => boolean;
}

/** Where a landmark stands, in grid cells: its unturned footprint's top-left corner (half cells
 *  allowed), and its contrast, the mean vote inside the contrast fit's footprint less the ring's. The reading has
 *  no turn: the evidence cannot tell a square paving's front, and the game lays landmarks unturned. */
export interface LandmarkDetection {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly confidence: number;
  /** What set the place: `structure`, the outline and the landmark's recorded structure
   *  (`LandmarkSpec.structure`); `outline`, the outline with the south inset taken from the sides'
   *  (the structure is not recorded); `contrast`, the contrast fit alone (no outline stood out, or its
   *  size disagreed with the recorded structure's). */
  readonly placedBy: 'structure' | 'outline' | 'contrast';
}

/** Summed-area table of a half-cell plane of `w` x `h`. */
function summed(plane: Float64Array, w: number, h: number): Float64Array {
  const s = new Float64Array((w + 1) * (h + 1));
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) s[(r + 1) * (w + 1) + c + 1] = plane[r * w + c]! + s[r * (w + 1) + c + 1]! + s[(r + 1) * (w + 1) + c]! - s[r * (w + 1) + c]!;
  }
  return s;
}

/** For each of `n * sub` sample points on an axis, the half cells it overlaps and by how much. */
function halfCellShares(n: number, sub: number): { k: number; w: number }[][] {
  const half = sub / 2;
  return Array.from({ length: n * sub }, (_, i) => {
    const out: { k: number; w: number }[] = [];
    for (let k = Math.floor(i / half); k * half < i + 1 && k < 2 * n; k++) out.push({ k, w: Math.min(i + 1, (k + 1) * half) - Math.max(i, k * half) });
    return out;
  });
}

/** Per half cell, the mean vote of the sample points over it for a colour that is neither the
 *  cell's reading nor sea: neither grass nor sea where it reads grass for a grass landmark, any but
 *  sea where it reads sea for a coast one. The
 *  sea within `landmarkSearch.shoreGap` cells of land is left out: the drawn beach reaches past the
 *  land cells there along every coast. */
function foreignVote(ev: CellEvidence, reading: GroundReading, coast: boolean): Float64Array {
  const { cols, rows, ground } = reading;
  const { sub, points } = ev;
  const W = cols * 2, H = rows * 2;
  const sum = new Float64Array(W * H), weight = new Float64Array(W * H);
  const xs = halfCellShares(cols, sub), ys = halfCellShares(rows, sub);
  const offshore = chessboardDistance(Uint8Array.from(ground, (g) => (g === SEA ? 1 : 0)), cols, rows);
  for (let py = 0; py < rows * sub; py++) {
    for (let px = 0; px < cols * sub; px++) {
      const cell = Math.floor(py / sub) * cols + Math.floor(px / sub);
      const g = ground[cell];
      const p = py * points.width + px;
      const sea = points.sea[p]!, grass = points.grass[p]!;
      const v = coast ? (g === SEA && offshore[cell]! > L.shoreGap ? 1 - sea : 0) : (g === GRASS ? Math.max(0, 1 - sea - grass) : 0);
      for (const a of ys[py]!) for (const b of xs[px]!) {
        const j = a.k * W + b.k;
        sum[j] = sum[j]! + a.w * b.w * v;
        weight[j] = weight[j]! + a.w * b.w;
      }
    }
  }
  for (let j = 0; j < sum.length; j++) sum[j] = weight[j]! > 0 ? sum[j]! / weight[j]! : 0;
  return sum;
}

/** The contrast fit of `spec`'s footprint, in cells on the half-cell grid, with its contrast and
 *  which placements suit the ground, or null when none does. Placements that score alike (a vote
 *  narrower than the footprint) go to the one centred on it. */
function bestPlacement(spec: LandmarkSpec, ev: CellEvidence, reading: GroundReading): (Fit & { score: number }) | null {
  const { cols, rows, ground, unseen } = reading;
  const W = cols * 2, H = rows * 2;
  const coast = spec.ground === 'coast';
  const vote = foreignVote(ev, reading, coast);
  const vx = new Float64Array(W * H), vy = new Float64Array(W * H);
  const barred = new Float64Array(W * H), sea = new Float64Array(W * H);
  for (let j = 0; j < W * H; j++) {
    const i = (j / W >> 1) * cols + ((j % W) >> 1);
    const g = ground[i];
    // A grass landmark stands on land; a coast landmark has no grass under it.
    barred[j] = unseen[i] || (coast ? g === GRASS : g === SEA) ? 1 : 0;
    sea[j] = g === SEA ? 1 : 0;
    vx[j] = vote[j]! * ((j % W) + 0.5);
    vy[j] = vote[j]! * (Math.floor(j / W) + 0.5);
  }
  const V = summed(vote, W, H), B = summed(barred, W, H), S = summed(sea, W, H), VX = summed(vx, W, H), VY = summed(vy, W, H);
  const box = (t: Float64Array, x: number, y: number, w: number, h: number): number => {
    const x0 = Math.max(0, x), y0 = Math.max(0, y), x1 = Math.min(W, x + w), y1 = Math.min(H, y + h);
    return x1 <= x0 || y1 <= y0 ? 0 : t[y1 * (W + 1) + x1]! - t[y0 * (W + 1) + x1]! - t[y1 * (W + 1) + x0]! + t[y0 * (W + 1) + x0]!;
  };
  const area = (x: number, y: number, w: number, h: number) => (Math.min(W, x + w) - Math.max(0, x)) * (Math.min(H, y + h) - Math.max(0, y));
  const w = spec.width * 2, h = spec.height * 2, ring = L.ring * 2;
  // In half cells. A coast landmark's north edge lies on land and its south edge on open sea.
  const fits = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x + w <= W && y + h <= H && box(B, x, y, w, h) === 0 && !(coast && (box(S, x, y, w, 1) > 0 || box(S, x, y + h - 1, w, 1) < w));
  let best: { x: number; y: number; score: number; off: number } | null = null;
  for (let y = 0; y + h <= H; y++) {
    for (let x = 0; x + w <= W; x++) {
      if (!fits(x, y)) continue;
      const inside = box(V, x, y, w, h);
      const ringArea = area(x - ring, y - ring, w + 2 * ring, h + 2 * ring) - w * h;
      const around = ringArea > 0 ? (box(V, x - ring, y - ring, w + 2 * ring, h + 2 * ring) - inside) / ringArea : 0;
      const score = inside / (w * h) - around;
      if (best && score < best.score - TIE) continue;
      const off = inside > 0 ? (box(VX, x, y, w, h) / inside - x - w / 2) ** 2 + (box(VY, x, y, w, h) / inside - y - h / 2) ** 2 : 0;
      if (!best || score > best.score + TIE || off < best.off) best = { x: x / 2, y: y / 2, score, off };
    }
  }
  return best && { x: best.x, y: best.y, score: best.score, fits: (x, y) => fits(Math.round(x * 2), Math.round(y * 2)) };
}

/** The mean L*a*b* colour of the seen sample points `p`, `p + stride`, ... (`n` of them), written
 *  to `out`; false when none is seen. */
function meanColour(ev: CellEvidence, p: number, stride: number, n: number, out: Float64Array): boolean {
  const { weight, lightness, a, b } = ev.points;
  let l = 0, u = 0, v = 0, count = 0;
  for (let i = 0, q = p; i < n; i++, q += stride) {
    if (!(weight[q]! > 0)) continue;
    l += lightness[q]!;
    u += a[q]!;
    v += b[q]!;
    count++;
  }
  if (!count) return false;
  out[0] = l / count;
  out[1] = u / count;
  out[2] = v / count;
  return true;
}

/** Where the peak at `values[i]` lies between its neighbours, in samples from `i` (within half a
 *  sample): the vertex of the parabola through the three. */
function peakOffset(values: readonly number[], i: number): number {
  const a = values[i - 1], b = values[i]!, c = values[i + 1];
  if (a === undefined || c === undefined) return 0;
  const curve = a - 2 * b + c;
  return curve < 0 ? Math.max(-0.5, Math.min(0.5, (a - c) / (2 * curve))) : 0;
}

/** The per-channel median L*a*b* colour of the seen sample points in the rectangles
 *  [x0, x1) x [y0, y1), or null where none is seen. */
function medianColour(ev: CellEvidence, rects: readonly (readonly [number, number, number, number])[]): number[] | null {
  const { width, height, weight, lightness, a, b } = ev.points;
  const channels: number[][] = [[], [], []];
  for (const [x0, x1, y0, y1] of rects) {
    for (let y = Math.max(0, y0); y < Math.min(height, y1); y++) {
      for (let x = Math.max(0, x0); x < Math.min(width, x1); x++) {
        const p = y * width + x;
        if (!(weight[p]! > 0)) continue;
        channels[0]!.push(lightness[p]!);
        channels[1]!.push(a[p]!);
        channels[2]!.push(b[p]!);
      }
    }
  }
  if (!channels[0]!.length) return null;
  return channels.map((c) => median(c, 'lower'));
}

/** The median colour step across the sample-point boundary `k` (before point k) on the axis the
 *  `vertical` boundaries cross, over the seen lines [from, to) of the other axis: per line, the
 *  L*a*b* distance between the mean colours of `landmarkSearch.edgeSpan` cells of points either side.
 *  The median keeps an edge that runs along the whole side above one that crosses part of it. */
function edge(ev: CellEvidence, vertical: boolean, k: number, from: number, to: number): number {
  const { width, height } = ev.points;
  const span = Math.max(1, Math.round(L.edgeSpan * ev.sub));
  if (k < span || k + span > (vertical ? width : height)) return 0;
  const stride = vertical ? 1 : width;
  const before = new Float64Array(3), after = new Float64Array(3);
  const steps: number[] = [];
  for (let t = Math.max(0, from); t < Math.min(vertical ? height : width, to); t++) {
    const p = vertical ? t * width + k : k * width + t;
    if (!meanColour(ev, p - span * stride, stride, span, before) || !meanColour(ev, p, stride, span, after)) continue;
    steps.push(labDistance(after, before));
  }
  return median(steps, 'lower');
}

/**
 * The footprint laid on the landmark's outline, at the placement within `landmarkSearch.refine` cells
 * of the contrast fit `at` that suits the ground and lies nearest the outline's; null when no outline
 * stands out, nothing there suits the ground, or the sides lie apart by other than the recorded
 * structure's width. The sides are the vertical colour-edge pair, `minFill` to 1 footprint width
 * apart, whose weaker edge is strongest and steps `outlineContrast` times the median between them. The
 * south side is the horizontal edge whose step, plus how much more the sides step over `sideBand`
 * cells north of it than south, less how far the colour `rimOffset` north of it lies from the sides'
 * inner colour, is greatest (a road along it steps too, but the sides go on); the north side is
 * not read, as the camera leans a tall top over it. A recorded structure places the footprint from
 * these edges; without one it is centred on the pair, its south inset taken from the sides'.
 */
function outlinePlacement(spec: LandmarkSpec, ev: CellEvidence, at: Fit): { x: number; y: number; byStructure: boolean } | null {
  const S = ev.sub, R = L.refine * S, B = Math.round(L.sideBand * S), w = spec.width * S, h = spec.height * S;
  const x0 = Math.round(at.x * S), y0 = Math.round(at.y * S);
  const lo = x0 - R, hi = x0 + w + R;
  const columns = Array.from({ length: hi - lo + 1 }, (_, i) => edge(ev, true, lo + i, y0, y0 + h));
  let pair = { score: -1, sum: -1, left: 0, right: 0 };
  for (let left = lo; left <= hi; left++) {
    for (let right = left + Math.ceil(L.minFill * w); right <= Math.min(hi, left + w); right++) {
      const l = columns[left - lo]!, r = columns[right - lo]!;
      const score = Math.min(l, r);
      if (score > pair.score + TIE || (score > pair.score - TIE && l + r > pair.sum)) pair = { score, sum: l + r, left, right };
    }
  }
  // An outline whose sides step no more than the colour does between them is texture, not an outline.
  if (!(pair.score > L.outlineContrast * median(columns.slice(pair.left - lo + 1, pair.right - lo), 'lower'))) return null;
  const left = pair.left + peakOffset(columns, pair.left - lo), right = pair.right + peakOffset(columns, pair.right - lo);
  const known = spec.structure;
  // Every landmark has one size on every planet, so sides apart by other than its structure's width
  // are not its own.
  if (known && Math.abs((right - left) / S - (spec.width - known.west - known.east)) > L.structureTolerance) return null;
  const inset = (w - (right - left)) / 2;
  const x = Math.round((known ? (left / S - known.west + right / S + known.east - spec.width) / 2 : (left - inset) / S) * 2) / 2;
  const px = Math.round(x * S);
  const sides = (from: number, to: number) => (edge(ev, true, pair.left, from, to) + edge(ev, true, pair.right, from, to)) / 2;
  const span = Math.max(1, Math.round(L.edgeSpan * S)), rimAt = Math.round(L.rimOffset * S);
  const rim = medianColour(ev, [[pair.left, pair.left + span, y0, y0 + h], [pair.right - span, pair.right, y0, y0 + h]]);
  const rows: number[] = [];
  let south = { score: -Infinity, k: 0 };
  for (let k = y0 + h - R; k <= y0 + h + R; k++) {
    const inner = medianColour(ev, [[pair.left, pair.right, k - rimAt - span, k - rimAt]]);
    const unlike = rim && inner ? labDistance(inner, rim) : 0;
    const score = edge(ev, false, k, px, px + w) + sides(k - B, k) - sides(k, k + B) - unlike;
    rows.push(score);
    if (score > south.score) south = { score, k };
  }
  const southEdge = (south.k + peakOffset(rows, south.k - (y0 + h - R))) / S;
  const y = Math.round((known ? southEdge + known.south - spec.height : southEdge + (inset - h) / S) * 2) / 2;
  // The placement within the search window that suits the ground and lies nearest the outline's.
  let best: { x: number; y: number; d: number } | null = null;
  for (let dy = -L.refine; dy <= L.refine; dy += 0.5) {
    for (let dx = -L.refine; dx <= L.refine; dx += 0.5) {
      const d = Math.hypot(at.x + dx - x, at.y + dy - y);
      if ((!best || d < best.d) && at.fits(at.x + dx, at.y + dy)) best = { x: at.x + dx, y: at.y + dy, d };
    }
  }
  return best && { x: best.x, y: best.y, byStructure: !!known };
}

/** Every landmark of the profile whose contrast fit stands out by `landmarkSearch.minContrast`, laid
 *  on its outline where one is read and at the contrast fit otherwise. */
export function detectLandmarks(ev: CellEvidence, reading: GroundReading): LandmarkDetection[] {
  const found: LandmarkDetection[] = [];
  for (const spec of LANDMARKS) {
    const best = bestPlacement(spec, ev, reading);
    if (!best || !(best.score > L.minContrast)) continue;
    const placed = outlinePlacement(spec, ev, best);
    const placedBy = !placed ? 'contrast' : placed.byStructure ? 'structure' : 'outline';
    found.push({ id: spec.id, x: (placed ?? best).x, y: (placed ?? best).y, confidence: best.score, placedBy });
  }
  return found;
}
