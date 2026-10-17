import { EDGE_CONSECUTIVE, SOURCE_ASSUMED, SOURCE_LINES, type AxisPins, type EdgeList } from './path-solve';
import { gaussianKernel } from '../../../core/base/fields';
import { median, medianInPlace } from '../../../core/base/math';
import { convolve, gaussianBlur, reflectIndex as reflect } from '../ground/raster';
import { SCAN_PROFILE } from '../profile';
import type { GreyImage } from '../types';

// The chunk lattice from the animated region load lines. A still run's temporal deviation shows
// the lines as thin bright ridges on land and sea alike. Each run is reduced to two line profiles
// (ridge strength per tile column for the vertical lines, per tile row for the horizontal ones),
// which locate the lattice inside that view, and which, placed at the run's solved position, add
// up to the whole scan's profiles. The period is the calibrated chunk size; only the phase is fit.

const L = SCAN_PROFILE.lattice;

/** A run's line profiles. Sample `i` sits `i * step` rectified pixels from the tile's origin. */
export interface LineProfiles {
  /** Vertical-line strength per tile column. */
  readonly x: Float32Array;
  /** Horizontal-line strength per tile row. */
  readonly y: Float32Array;
  /** Rectified pixels per profile sample. */
  readonly step: number;
}

/** A comb `phase + n * period` fitted to a profile. Units are profile samples. */
export interface CombFit {
  /** Where the first line sits, in [0, period). */
  readonly phase: number;
  /** Mean comb-tooth height over the profile's standard deviation. */
  readonly score: number;
  /** Standard deviation of the located lines' offsets from the comb; Infinity with under two lines. */
  readonly spread: number;
  /** Each located line's offset from the fitted comb. */
  readonly deviations: Float64Array;
}

/**
 * Ridge strength of thin bright lines across one axis: blur, the negative second derivative
 * across the lines smoothed by [1 2 1] along them, clipped at 0, then averaged over
 * `lineSmooth` pixels along the lines. Returns the per-column (axis `x`) or per-row (axis `y`)
 * median plus `meanShare` of the mean.
 */
function ridgeProfile(blurred: Float32Array, width: number, height: number, axis: 'x' | 'y', ridge: Float32Array): Float32Array {
  for (let y = 0; y < height; y++) {
    const up = reflect(y - 1, height) * width;
    const row = y * width;
    const down = reflect(y + 1, height) * width;
    for (let x = 0; x < width; x++) {
      const l = reflect(x - 1, width);
      const r = reflect(x + 1, width);
      const ul = blurred[up + l]!, uc = blurred[up + x]!, ur = blurred[up + r]!;
      const ml = blurred[row + l]!, mc = blurred[row + x]!, mr = blurred[row + r]!;
      const dl = blurred[down + l]!, dc = blurred[down + x]!, dr = blurred[down + r]!;
      const d = axis === 'x'
        ? (ul - 2 * uc + ur) + 2 * (ml - 2 * mc + mr) + (dl - 2 * dc + dr)
        : (ul + 2 * uc + ur) - 2 * (ml + 2 * mc + mr) + (dl + 2 * dc + dr);
      ridge[row + x] = d < 0 ? -d : 0;
    }
  }
  // Box average along the lines: vertical lines are averaged down the columns.
  const along = axis === 'x' ? height : width;
  const across = axis === 'x' ? width : height;
  const stride = axis === 'x' ? width : 1;
  const step = axis === 'x' ? 1 : width;
  const r = (L.lineSmooth - 1) / 2;
  const line = new Float64Array(along);
  const values = new Float32Array(along);
  const out = new Float32Array(across);
  for (let c = 0; c < across; c++) {
    const offset = c * step;
    for (let i = 0; i < along; i++) line[i] = ridge[offset + i * stride]!;
    let sum = 0;
    for (let j = -r; j <= r; j++) sum += line[reflect(j, along)]!;
    let total = 0;
    for (let i = 0; i < along; i++) {
      const v = sum / L.lineSmooth;
      values[i] = v;
      total += v;
      sum += line[reflect(i + r + 1, along)]! - line[reflect(i - r, along)]!;
    }
    out[c] = medianInPlace(values, along, 'mean') + (L.meanShare * total) / along;
  }
  return out;
}

/** The image-sized planes `lineProfiles` works in, for a caller that reads many images of one size. */
export interface LineScratch {
  readonly blurred: Float32Array;
  readonly ridge: Float32Array;
}

/** Scratch planes for images of `pixels` pixels or fewer. */
export function lineScratch(pixels: number): LineScratch {
  return { blurred: new Float32Array(pixels), ridge: new Float32Array(pixels) };
}

/** The two line profiles of a still run's temporal deviation, sampled every `step` rectified
 *  pixels; `scratch` saves allocating the image-sized planes. */
export function lineProfiles(deviation: GreyImage, step = 1, scratch?: LineScratch): LineProfiles {
  const { width, height } = deviation;
  const n = width * height;
  const blurred = gaussianBlur(deviation, L.ridgeSigma / step, 4, scratch ? scratch.blurred.subarray(0, n) : undefined);
  const temp = scratch ? scratch.ridge.subarray(0, n) : new Float32Array(n);
  return {
    x: ridgeProfile(blurred, width, height, 'x', temp),
    y: ridgeProfile(blurred, width, height, 'y', temp),
    step,
  };
}

function interpolate(p: Float64Array, t: number): number {
  const i = Math.floor(t);
  const f = t - i;
  return i + 1 < p.length ? p[i]! + (p[i + 1]! - p[i]!) * f : p[i]!;
}

/**
 * Fits the comb `phase + n * period` to a profile: the trend (`detrendSigma`, by default the
 * lattice's) is removed, the phase maximising the
 * mean interpolated profile over the teeth is searched every `phaseStep` samples, each tooth's
 * line is then located to sub-sample precision as the parabolic peak of the largest sample within
 * `lineRadius`, and the phase moves by the lines' median offset. Null when the profile is shorter
 * than one period.
 */
export function fitComb(
  profile: ArrayLike<number>,
  period: number,
  options: {
    readonly phaseStep: number; readonly lineRadius: number; readonly detrendSigma?: number;
    readonly around?: { readonly phase: number; readonly radius: number };
  },
): CombFit | null {
  const n = profile.length;
  if (n < period + 2) return null;
  const raw = new Float32Array(n);
  for (let i = 0; i < n; i++) raw[i] = profile[i]!;
  const trend = Float32Array.from(raw);
  convolve(trend, n, 1, gaussianKernel(options.detrendSigma ?? L.detrendSigma, 4), true);
  const p = new Float64Array(n);
  let mean = 0;
  for (let i = 0; i < n; i++) mean += p[i] = raw[i]! - trend[i]!;
  mean /= n;
  let variance = 0;
  for (let i = 0; i < n; i++) variance += (p[i]! - mean) ** 2;
  const sd = Math.sqrt(variance / n);

  let best = -Infinity;
  let phase = 0;
  // With `around`, only phases within `radius` samples of `around.phase` (mod period) are searched.
  const a = options.around;
  const from = a ? a.phase - a.radius : 0, count = a ? Math.floor((2 * a.radius) / options.phaseStep) + 1 : Math.ceil(period / options.phaseStep);
  for (let k = 0; k < count; k++) {
    const ph = a ? (((from + k * options.phaseStep) % period) + period) % period : k * options.phaseStep;
    let s = 0;
    let teeth = 0;
    for (let t = ph; t < n - 1; t += period, teeth++) s += interpolate(p, t);
    if (teeth > 0 && s / teeth > best) {
      best = s / teeth;
      phase = ph;
    }
  }

  const r = options.lineRadius;
  const deviations: number[] = [];
  for (let c = phase; c < n - r - 1; c += period) {
    const j0 = Math.round(c);
    if (j0 < r + 1) continue;
    let j = j0 - r;
    for (let i = j0 - r + 1; i <= j0 + r; i++) if (p[i]! > p[j]!) j = i;
    if (j <= 0 || j >= n - 1) continue;
    const den = p[j - 1]! - 2 * p[j]! + p[j + 1]!;
    const sub = den !== 0 ? (0.5 * (p[j - 1]! - p[j + 1]!)) / den : 0;
    deviations.push(j + sub - c);
  }
  const dev = Float64Array.from(deviations);
  const shift = dev.length > 0 ? median(dev, 'mean') : 0;
  let spread = Infinity;
  if (dev.length > 1) {
    const m = dev.reduce((t, v) => t + v, 0) / dev.length;
    spread = Math.sqrt(dev.reduce((t, v) => t + (v - m) ** 2, 0) / dev.length);
  }
  for (let i = 0; i < dev.length; i++) dev[i]! -= shift;
  const wrapped = (((phase + shift) % period) + period) % period;
  return { phase: wrapped, score: sd > 0 ? best / sd : 0, spread, deviations: dev };
}

/** The lattice seen by one still run: where its lines sit, in rectified pixels from the tile's
 *  origin, per axis; null on an axis whose lines are too faint or irregular to pin. */
export interface RunLattice {
  readonly x: number | null;
  readonly y: number | null;
}

/** The chunk period on each axis in rectified pixels. */
export interface LatticePeriod {
  readonly x: number;
  readonly y: number;
}

const CHUNK_PERIOD: LatticePeriod = { x: SCAN_PROFILE.chunk.width, y: SCAN_PROFILE.chunk.height };

/** Where one still run's lines sit, from its profiles; the comb gates are `SCAN_PROFILE.lattice`'s. */
export function runLattice(profiles: LineProfiles, period: LatticePeriod = CHUNK_PERIOD): RunLattice {
  const axis = (profile: Float32Array, p: number): number | null => {
    const fit = fitComb(profile, p / profiles.step, L.run);
    if (!fit || fit.score <= L.minScore || !(fit.spread < L.maxSpread)) return null;
    return fit.phase * profiles.step;
  };
  return { x: axis(profiles.x, period.x), y: axis(profiles.y, period.y) };
}

/** Where one kept frame's own lines sit, read from its dash plane (`ground/color.ts:dashPlane`) at
 *  tile resolution with a still run's gates in tile pixels (`SCAN_PROFILE.lattice.frame`). A frame
 *  shows the region load lines as faint ridges among the ground's own, so its reading is a weak pin
 *  the path solve rejects when it disagrees. `prior` is where the frame's tracked position predicts
 *  a line per axis, tile pixels (NaN where unknown): the comb is then searched within
 *  `framePrior.window` of it, which keeps it off ridges the prediction rules out (dashes drawn on
 *  raised tops, which the drawn offset and lean move 9 to 25 px north, and ground texture), and one
 *  line in view pins the axis, as the tile's height often allows only one. */
export function frameLines(
  plane: GreyImage, period: LatticePeriod = CHUNK_PERIOD, scratch?: LineScratch, prior?: { readonly x: number; readonly y: number },
): RunLattice {
  const profiles = lineProfiles(plane, 1, scratch);
  const F = L.frame;
  const axis = (a: 'x' | 'y'): number | null => {
    const p = period[a];
    const at = prior?.[a];
    if (at === undefined || !Number.isFinite(at)) {
      const fit = fitComb(profiles[a], p, F);
      return fit && fit.score > L.minScore && fit.spread < F.maxSpread ? fit.phase : null;
    }
    const w = L.framePrior.window;
    const around = ((at % p) + p) % p;
    const fit = fitComb(profiles[a], p, { ...F, around: { phase: around, radius: w } });
    if (!fit || fit.score <= L.minScore) return null;
    // One line in view pins the axis here: the prior settles the phase it leaves open.
    if (fit.deviations.length > 1 && !(fit.spread < F.maxSpread)) return null;
    if (fit.deviations.length === 0 || Math.abs(((fit.phase - around) % p + 1.5 * p) % p - p / 2) > w) return null;
    return fit.phase;
  };
  return { x: axis('x'), y: axis('y') };
}

/** Each kept frame's own line phases per axis (`frameLines`), NaN where none was read. */
export interface FrameLines {
  readonly x: ArrayLike<number>;
  readonly y: ArrayLike<number>;
}

/** A still run's line profiles, by the index of its distinct frame. */
export interface RunProfiles {
  readonly distinct: number;
  readonly frames: number;
  /** Seconds from the run's first frame to its last. */
  readonly seconds: number;
  readonly profiles: LineProfiles;
}

/** The path solve's pins: every still run of at least `latticeMinSeconds` whose lines
 *  locate the lattice, per axis, then each kept frame's own lines from `lines` on every axis no
 *  still run at that frame pinned, marked moving. */
export function latticePins(runs: readonly RunProfiles[], period: LatticePeriod = CHUNK_PERIOD, lines?: FrameLines): { x: AxisPins; y: AxisPins } {
  const axisPins = () => ({ frame: [] as number[], phase: [] as number[], moving: [] as number[] });
  const pins = { x: axisPins(), y: axisPins() };
  const still = { x: new Set<number>(), y: new Set<number>() };
  for (const run of runs) {
    if (run.seconds < SCAN_PROFILE.latticeMinSeconds) continue;
    const seen = runLattice(run.profiles, period);
    for (const axis of ['x', 'y'] as const) {
      const phase = seen[axis];
      if (phase === null) continue;
      still[axis].add(run.distinct);
      pins[axis].frame.push(run.distinct);
      pins[axis].phase.push(phase);
      pins[axis].moving.push(0);
    }
  }
  if (lines) {
    for (const axis of ['x', 'y'] as const) {
      const at = lines[axis];
      for (let k = 0; k < at.length; k++) {
        if (still[axis].has(k) || !Number.isFinite(at[k]!)) continue;
        pins[axis].frame.push(k);
        pins[axis].phase.push(at[k]!);
        pins[axis].moving.push(1);
      }
    }
  }
  const pack = (p: ReturnType<typeof axisPins>): AxisPins => ({
    frame: Int32Array.from(p.frame), phase: Float64Array.from(p.phase), ...(lines ? { moving: Uint8Array.from(p.moving) } : {}),
  });
  return { x: pack(pins.x), y: pack(pins.y) };
}

/** A still run placed on the solved path: its tile origin in scan coordinates and its weight. */
export interface PlacedRun {
  readonly x: number;
  readonly y: number;
  readonly frames: number;
  readonly profiles: LineProfiles;
}

/** The scan's lattice on one axis, in the path's rectified pixel coordinates. */
export interface AxisLattice {
  /** Lines sit at `phase + n * period`; phase in [0, period). */
  readonly phase: number;
  /** Lines located along the scan. */
  readonly lines: number;
  /** RMS and largest offset of the located lines from the fitted lattice, in rectified pixels. */
  readonly residualRms: number;
  readonly residualMax: number;
  /** Comb score of the whole-scan profile. */
  readonly score: number;
}

export interface ScanLattice {
  readonly x: AxisLattice | null;
  readonly y: AxisLattice | null;
  readonly period: LatticePeriod;
}

function centreWeights(n: number, centre: number): Float64Array {
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) w[i] = Math.exp(-(((i - centre * n) / (L.weight.sigma * n)) ** 2));
  return w;
}

function placeProfiles(runs: readonly PlacedRun[], axis: 'x' | 'y'): { origin: number; profile: Float64Array } | null {
  if (runs.length === 0) return null;
  const step = runs[0]!.profiles.step;
  let lo = Infinity;
  let hi = -Infinity;
  for (const run of runs) {
    if (run.profiles.step !== step) throw new Error('placed runs need one profile step');
    const at = run[axis];
    lo = Math.min(lo, at);
    hi = Math.max(hi, at + run.profiles[axis].length * step);
  }
  const origin = Math.floor(lo);
  const n = Math.ceil((hi - origin) / step) + 2;
  const sum = new Float64Array(n);
  const cover = new Float64Array(n);
  const weightsByLength = new Map<number, Float64Array>();
  for (const run of runs) {
    const prof = run.profiles[axis];
    let w = weightsByLength.get(prof.length);
    if (!w) {
      w = centreWeights(prof.length, axis === 'x' ? L.weight.centreX : L.weight.centreY);
      weightsByLength.set(prof.length, w);
    }
    const start = (run[axis] - origin) / step;
    const i0 = Math.floor(start);
    const f = start - i0;
    for (let i = 0; i < prof.length; i++) {
      const wt = w[i]! * run.frames;
      const j = i0 + i;
      sum[j]! += (1 - f) * wt * prof[i]!;
      cover[j]! += (1 - f) * wt;
      sum[j + 1]! += f * wt * prof[i]!;
      cover[j + 1]! += f * wt;
    }
  }
  // The scan's ends, past the last sample any run weighs enough, hold no line the comb could locate.
  let first = 0;
  let last = n - 1;
  while (first < last && cover[first]! < L.minWeight) first++;
  while (last > first && cover[last]! < L.minWeight) last--;
  const profile = new Float64Array(last - first + 1);
  for (let i = first; i <= last; i++) profile[i - first] = cover[i]! >= L.minWeight ? sum[i]! / cover[i]! : 0;
  return { origin: origin + first * step, profile };
}

/**
 * Fits the chunk lattice to every still run's line profiles placed at their solved positions,
 * with the period fixed. The residual measures how well the runs agree on one lattice, which is
 * also how well the path places them.
 */
export function fitScanLattice(runs: readonly PlacedRun[], period: LatticePeriod = CHUNK_PERIOD): ScanLattice {
  const axis = (a: 'x' | 'y'): AxisLattice | null => {
    const placed = placeProfiles(runs, a);
    if (!placed) return null;
    const step = runs[0]!.profiles.step;
    const p = period[a];
    const fit = fitComb(placed.profile, p / step, L.scan);
    if (!fit || fit.deviations.length === 0) return null;
    let sq = 0;
    let max = 0;
    for (const d of fit.deviations) {
      sq += d * d;
      max = Math.max(max, Math.abs(d));
    }
    const phase = (((placed.origin + fit.phase * step) % p) + p) % p;
    return {
      phase,
      lines: fit.deviations.length,
      residualRms: Math.sqrt(sq / fit.deviations.length) * step,
      residualMax: max * step,
      score: fit.score,
    };
  };
  return { x: axis('x'), y: axis('y'), period };
}

/** How the still runs' lines fit when their period may differ from the calibrated one. */
export interface PeriodScale {
  /** The median, over run axes whose lines fit some period, of the best-fitting period's scale to
   *  the calibrated one; 1 when none fits. */
  readonly scale: number;
  /** Run axes whose lines fit a period in the searched range. */
  readonly fitted: number;
}

/**
 * The scale of the line period the still runs show, searched over `SCAN_PROFILE.import`'s scale
 * range, which tells a recording made at another zoom (its lines fit another period) from one
 * without the region load display (its lines fit none). Each run of at least `latticeMinSeconds`
 * gives, per axis, the scale whose comb scores best among the scales passing the run gates.
 */
export function periodScale(runs: readonly RunProfiles[], period: LatticePeriod = CHUNK_PERIOD): PeriodScale {
  const { scaleRange: [lo, hi], scaleStep } = SCAN_PROFILE.import;
  const steps = Math.round((hi - lo) / scaleStep);
  const scales: number[] = [];
  for (const run of runs) {
    if (run.seconds < SCAN_PROFILE.latticeMinSeconds) continue;
    for (const a of ['x', 'y'] as const) {
      let best = -Infinity;
      let at = 1;
      for (let k = 0; k <= steps; k++) {
        const s = lo + k * scaleStep;
        const fit = fitComb(run.profiles[a], (period[a] * s) / run.profiles.step, L.run);
        if (!fit || fit.score <= L.minScore || !(fit.spread < L.maxSpread) || fit.score <= best) continue;
        best = fit.score;
        at = s;
      }
      if (best > -Infinity) scales.push(at);
    }
  }
  if (scales.length === 0) return { scale: 1, fitted: 0 };
  return { scale: median(scales, 'upper'), fitted: scales.length };
}

/** What `resolveChunkSlips` did, per axis. */
export interface ChunkSlips {
  /** The consecutive edges it moved by a chunk, as edge indices. */
  readonly x: Int32Array;
  readonly y: Int32Array;
  /** Steps it could not decide and left as tracked: between neighbours moving one way, a step
   *  under `moving` of a chunk, or one reversing them that the nearer-chunk test keeps. A pan step
   *  of about a chunk or more, slipped a chunk short, reads as such a small step. */
  readonly suspect: { readonly x: Int32Array; readonly y: Int32Array };
  /** Tracked pixels per line pixel, from the steps both of whose frames read their lines; 1 with
   *  fewer than `SCALE_STEPS` of them. */
  readonly scale: { readonly x: number; readonly y: number };
}

/** Steps the tracked-to-line scale needs before it is measured. */
const SCALE_STEPS = 8;

/**
 * Moves each consecutive edge that slipped a whole chunk onto the chunk the camera's motion
 * continues, in place. On ground repeating every chunk, tracking can match a pan of more than half
 * a chunk one chunk of ground short, as a smaller step backwards, which a frame's own lines (they
 * place it only within a chunk) cannot see. Such an edge reverses both neighbours, each moving one
 * way by at least `tracking.chunkSlip.moving` of a chunk; it slipped when one ground chunk on in
 * their direction lies nearer their mean, since the camera cannot turn round and back within two
 * frames. The moved shift is the frames' line difference on that chunk where both read lines, else
 * that step, in tracked pixels (`scale`). Kept steps are assumed under about a chunk: a longer
 * one slips to a small step forwards, which only `suspect` counts.
 */
export function resolveChunkSlips(edges: EdgeList, lines?: FrameLines, period: LatticePeriod = CHUNK_PERIOD): ChunkSlips {
  let frames = 0;
  for (let e = 0; e < edges.count; e++) frames = Math.max(frames, edges.a[e]! + 1, edges.b[e]! + 1);
  // The verified consecutive edge from frame k to k + 1, or -1.
  const step = new Int32Array(frames).fill(-1);
  for (let e = 0; e < edges.count; e++) {
    if (edges.kind[e] !== EDGE_CONSECUTIVE || edges.source[e] === SOURCE_ASSUMED || edges.b[e] !== edges.a[e]! + 1) continue;
    step[edges.a[e]!] = e;
  }
  const moving = SCAN_PROFILE.tracking.chunkSlip.moving;
  const resolve = (axis: 'x' | 'y') => {
    const shift = axis === 'x' ? edges.dx : edges.dy;
    const P = period[axis];
    const seen = lines?.[axis];
    // pos[k] - pos[k + 1] is the line difference up to whole chunks, in line pixels.
    const lineStep = (k: number) => (seen ? seen[k + 1]! - seen[k]! : Number.NaN);
    const ratios: number[] = [];
    for (let k = 0; k + 1 < frames; k++) {
      const e = step[k]!;
      const l = lineStep(k);
      if (e < 0 || !Number.isFinite(l) || Math.abs(shift[e]!) < moving * P) continue;
      const near = l + P * Math.round((shift[e]! - l) / P);
      if (Math.abs(near) >= moving * P) ratios.push(shift[e]! / near);
    }
    const scale = ratios.length >= SCALE_STEPS ? median(ratios, 'mean') : 1;
    const moved: number[] = [];
    const to: number[] = [];
    const suspect: number[] = [];
    for (let k = 1; k + 1 < frames - 1; k++) {
      const e = step[k]!, before = step[k - 1]!, after = step[k + 1]!;
      if (e < 0 || before < 0 || after < 0) continue;
      const a = shift[before]!, b = shift[after]!, d = shift[e]!;
      const s = Math.sign(a);
      if (s === 0 || Math.sign(b) !== s || Math.min(Math.abs(a), Math.abs(b)) < moving * P) continue;
      if (d * s >= moving * P) continue;
      const mean = (a + b) / 2;
      const on = d + s * scale * P;
      if (d * s >= 0 || Math.abs(on - mean) >= Math.abs(d - mean)) {
        suspect.push(e);
        continue;
      }
      const l = lineStep(k);
      moved.push(e);
      to.push(Number.isFinite(l) ? scale * (l + P * Math.round((on / scale - l) / P)) : on);
    }
    moved.forEach((e, i) => (shift[e] = to[i]!));
    return { moved: Int32Array.from(moved), suspect: Int32Array.from(suspect), scale };
  };
  const x = resolve('x');
  const y = resolve('y');
  return { x: x.moved, y: y.moved, suspect: { x: x.suspect, y: y.suspect }, scale: { x: x.scale, y: y.scale } };
}

/**
 * Places each lost consecutive step (`SOURCE_ASSUMED`) whose two frames both read their own lines on
 * both axes, in place: on each axis the step is the line difference moved by the whole chunks that
 * put it nearest the camera's motion, the mean of the step before it (already placed when it was
 * lost too) and the next tracked step, and is taken only when that lies within
 * `tracking.chunkSlip.bridge` of a chunk of the mean and under a chunk. The camera pans
 * continuously, so a step changes little from the steps around it and never reaches a chunk;
 * nothing assumes it pans at a constant speed. `scale` is the tracked-to-line scale per axis
 * (`ChunkSlips.scale`). Returns the edges placed.
 */
export function bridgeLostSteps(
  edges: EdgeList, lines: FrameLines, scale: { readonly x: number; readonly y: number } = { x: 1, y: 1 }, period: LatticePeriod = CHUNK_PERIOD,
): Int32Array {
  let frames = 0;
  for (let e = 0; e < edges.count; e++) frames = Math.max(frames, edges.a[e]! + 1, edges.b[e]! + 1);
  const step = new Int32Array(frames).fill(-1);
  for (let e = 0; e < edges.count; e++) {
    if (edges.kind[e] === EDGE_CONSECUTIVE && edges.b[e] === edges.a[e]! + 1) step[edges.a[e]!] = e;
  }
  const known = (e: number) => e >= 0 && edges.source[e] !== SOURCE_ASSUMED;
  const reach = SCAN_PROFILE.tracking.chunkSlip.bridge;
  const placed: number[] = [];
  for (let k = 0; k + 1 < frames; k++) {
    const e = step[k]!;
    if (e < 0 || edges.source[e] !== SOURCE_ASSUMED) continue;
    let next = -1;
    for (let j = k + 1; j + 1 < frames && next < 0; j++) if (known(step[j]!)) next = step[j]!;
    const before = k > 0 && known(step[k - 1]!) ? step[k - 1]! : -1;
    if (before < 0 && next < 0) continue;
    const to = { x: 0, y: 0 };
    let ok = true;
    for (const axis of ['x', 'y'] as const) {
      const a = lines[axis][k]!, b = lines[axis][k + 1]!;
      if (!Number.isFinite(a) || !Number.isFinite(b)) { ok = false; break; }
      const shift = axis === 'x' ? edges.dx : edges.dy;
      const around = [before, next].filter((n) => n >= 0).map((n) => shift[n]!);
      const mean = around.reduce((t, v) => t + v, 0) / around.length / scale[axis];
      const P = period[axis];
      // pos[k] - pos[k + 1] is the line difference up to whole chunks, in line pixels.
      const l = b - a;
      const near = l + P * Math.round((mean - l) / P);
      if (Math.abs(near - mean) >= reach * P || Math.abs(near) >= P) { ok = false; break; }
      to[axis] = near * scale[axis];
    }
    if (!ok) continue;
    edges.dx[e] = to.x;
    edges.dy[e] = to.y;
    edges.weight[e] = 1;
    edges.source[e] = SOURCE_LINES;
    placed.push(e);
  }
  return Int32Array.from(placed);
}
