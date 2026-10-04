import type { AxisPins } from './path-solve';
import { SCAN_PROFILE } from './profile';
import type { GreyImage } from './types';

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

function reflect(i: number, n: number): number {
  if (n === 1) return 0;
  while (i < 0 || i >= n) i = i < 0 ? -i : 2 * n - 2 - i;
  return i;
}

function gaussianKernel(sigma: number): Float64Array {
  const r = Math.max(1, Math.ceil(4 * sigma));
  const k = new Float64Array(2 * r + 1);
  let sum = 0;
  for (let i = -r; i <= r; i++) sum += k[i + r] = Math.exp(-(i * i) / (2 * sigma * sigma));
  for (let i = 0; i < k.length; i++) k[i]! /= sum;
  return k;
}

/** Correlates `n` samples read as `src[offset + i * stride]` with a centred kernel, edges
 *  reflected, into `dst` with the same layout. */
function convolve1d(
  src: Float32Array, dst: Float32Array, offset: number, stride: number, n: number, kernel: Float64Array, line: Float64Array,
): void {
  const r = (kernel.length - 1) / 2;
  for (let i = 0; i < n; i++) line[i] = src[offset + i * stride]!;
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = -r; j <= r; j++) s += kernel[j + r]! * line[reflect(i + j, n)]!;
    dst[offset + i * stride] = s;
  }
}

/** The median of `values[0 .. n)`, reordering them. */
function medianInPlace(values: Float32Array | Float64Array, n: number): number {
  const select = (k: number): number => {
    let lo = 0;
    let hi = n - 1;
    while (lo < hi) {
      const pivot = values[(lo + hi) >> 1]!;
      let i = lo;
      let j = hi;
      while (i <= j) {
        while (values[i]! < pivot) i++;
        while (values[j]! > pivot) j--;
        if (i <= j) {
          const t = values[i]!;
          values[i] = values[j]!;
          values[j] = t;
          i++;
          j--;
        }
      }
      if (k <= j) hi = j;
      else if (k >= i) lo = i;
      else break;
    }
    return values[k]!;
  };
  const upper = select(n >> 1);
  if (n % 2 === 1) return upper;
  let lower = -Infinity;
  for (let i = 0; i < n >> 1; i++) lower = Math.max(lower, values[i]!);
  return (lower + upper) / 2;
}

function median(values: ArrayLike<number>): number {
  const copy = Float64Array.from(values);
  return medianInPlace(copy, copy.length);
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
    out[c] = medianInPlace(values, along) + (L.meanShare * total) / along;
  }
  return out;
}

/** The two line profiles of a still run's temporal deviation, sampled every `step` rectified
 *  pixels. */
export function lineProfiles(deviation: GreyImage, step = 1): LineProfiles {
  const { width, height, data } = deviation;
  const kernel = gaussianKernel(L.ridgeSigma / step);
  const temp = new Float32Array(width * height);
  const blurred = new Float32Array(width * height);
  const line = new Float64Array(Math.max(width, height));
  for (let y = 0; y < height; y++) convolve1d(data, temp, y * width, 1, width, kernel, line);
  for (let x = 0; x < width; x++) convolve1d(temp, blurred, x, width, height, kernel, line);
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
 * Fits the comb `phase + n * period` to a profile: the trend is removed, the phase maximising the
 * mean interpolated profile over the teeth is searched every `phaseStep` samples, each tooth's
 * line is then located to sub-sample precision as the parabolic peak of the largest sample within
 * `lineRadius`, and the phase moves by the lines' median offset. Null when the profile is shorter
 * than one period.
 */
export function fitComb(
  profile: ArrayLike<number>,
  period: number,
  options: { readonly phaseStep: number; readonly lineRadius: number },
): CombFit | null {
  const n = profile.length;
  if (n < period + 2) return null;
  const raw = new Float32Array(n);
  for (let i = 0; i < n; i++) raw[i] = profile[i]!;
  const trend = new Float32Array(n);
  convolve1d(raw, trend, 0, 1, n, gaussianKernel(L.detrendSigma), new Float64Array(n));
  const p = new Float64Array(n);
  let mean = 0;
  for (let i = 0; i < n; i++) mean += p[i] = raw[i]! - trend[i]!;
  mean /= n;
  let variance = 0;
  for (let i = 0; i < n; i++) variance += (p[i]! - mean) ** 2;
  const sd = Math.sqrt(variance / n);

  let best = -Infinity;
  let phase = 0;
  for (let k = 0; k * options.phaseStep < period; k++) {
    const ph = k * options.phaseStep;
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
  const shift = dev.length > 0 ? median(dev) : 0;
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

/** A still run's line profiles, by the index of its distinct frame. */
export interface RunProfiles {
  readonly distinct: number;
  readonly frames: number;
  readonly profiles: LineProfiles;
}

/** The path solve's pins: every still run of at least `latticeMinFrames` frames whose lines
 *  locate the lattice, per axis. */
export function latticePins(runs: readonly RunProfiles[], period: LatticePeriod = CHUNK_PERIOD): { x: AxisPins; y: AxisPins } {
  const pins = { x: { frame: [] as number[], phase: [] as number[] }, y: { frame: [] as number[], phase: [] as number[] } };
  for (const run of runs) {
    if (run.frames < SCAN_PROFILE.latticeMinFrames) continue;
    const seen = runLattice(run.profiles, period);
    for (const axis of ['x', 'y'] as const) {
      const phase = seen[axis];
      if (phase === null) continue;
      pins[axis].frame.push(run.distinct);
      pins[axis].phase.push(phase);
    }
  }
  const pack = (p: { frame: number[]; phase: number[] }): AxisPins => ({ frame: Int32Array.from(p.frame), phase: Float64Array.from(p.phase) });
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
  const profile = new Float64Array(n);
  for (let i = 0; i < n; i++) profile[i] = cover[i]! >= L.minWeight ? sum[i]! / cover[i]! : 0;
  return { origin, profile };
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
 * without the region load display (its lines fit none). Each run of at least `latticeMinFrames`
 * frames gives, per axis, the scale whose comb scores best among the scales passing the run gates.
 */
export function periodScale(runs: readonly RunProfiles[], period: LatticePeriod = CHUNK_PERIOD): PeriodScale {
  const { scaleRange: [lo, hi], scaleStep } = SCAN_PROFILE.import;
  const steps = Math.round((hi - lo) / scaleStep);
  const scales: number[] = [];
  for (const run of runs) {
    if (run.frames < SCAN_PROFILE.latticeMinFrames) continue;
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
  scales.sort((p, q) => p - q);
  return { scale: scales[Math.floor(scales.length / 2)]!, fitted: scales.length };
}
