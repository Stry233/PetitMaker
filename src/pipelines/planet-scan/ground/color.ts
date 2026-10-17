import { srgbToLinear } from '../../../core/base/color';
import { SCAN_PROFILE } from '../profile';
import type { GreyImage, RgbaImage } from '../types';

// Colour as the ground reader sees it: CIE L*a*b* (D65) from 8-bit sRGB, as OpenCV's 8-bit
// conversion computes it (L in 0..100, a and b centred on 0), HSV saturation in 0..255, and the
// hue angle of (a, b) in degrees.

/** Pixel classes of the ground palette. */
export const SEA = 0;
export const SAND = 1;
export const GRASS = 2;

const LINEAR = new Float64Array(256);
for (let i = 0; i < 256; i++) LINEAR[i] = srgbToLinear(i / 255);

const labF = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);

/** The CIE76 distance between two L*a*b* colours, each read from index 0 of its array. */
export function labDistance(p: ArrayLike<number>, q: ArrayLike<number>): number {
  return Math.hypot(p[0]! - q[0]!, p[1]! - q[1]!, p[2]! - q[2]!);
}

/** L*a*b* of an 8-bit sRGB colour (channels rounded to integers), written to `out` at `at`. */
export function toLab(r: number, g: number, b: number, out: Float32Array | Float64Array, at = 0): void {
  const lr = LINEAR[r]!;
  const lg = LINEAR[g]!;
  const lb = LINEAR[b]!;
  const x = (0.412453 * lr + 0.35758 * lg + 0.180423 * lb) / 0.950456;
  const y = 0.212671 * lr + 0.71516 * lg + 0.072169 * lb;
  const z = (0.019334 * lr + 0.119193 * lg + 0.950227 * lb) / 1.088754;
  const fy = labF(y);
  out[at] = y > 0.008856 ? 116 * fy - 16 : 903.3 * y;
  out[at + 1] = 500 * (labF(x) - fy);
  out[at + 2] = 200 * (fy - labF(z));
}

/**
 * The region load lines' dash plane of a rectified RGBA tile: L* - a* + b* per pixel, into `out`.
 * A dash shifts the ground's colour towards yellow-green (+b*, -a*, L* never lower) on every
 * ground, by 11 to 75 units of this projection, while it changes the luma of sand by under one
 * level and the grass's flowers are bright luma blobs.
 */
export function dashPlane(tile: RgbaImage, out = new Float32Array(tile.width * tile.height)): GreyImage {
  const d = tile.data;
  const lab = new Float64Array(3);
  const n = tile.width * tile.height;
  for (let p = 0; p < n; p++) {
    toLab(d[4 * p]!, d[4 * p + 1]!, d[4 * p + 2]!, lab);
    out[p] = lab[0]! - lab[1]! + lab[2]!;
  }
  return { width: tile.width, height: tile.height, data: out };
}

/** HSV saturation in 0..255 of an sRGB colour. */
export function saturation(r: number, g: number, b: number): number {
  const v = Math.max(r, g, b);
  return v > 0 ? ((v - Math.min(r, g, b)) * 255) / v : 0;
}

/** Hue angle of (a, b) in degrees, in [0, 360). */
export function labHue(a: number, b: number): number {
  const h = (Math.atan2(b, a) * 180) / Math.PI;
  return h < 0 ? h + 360 : h;
}

/** Bits per channel of the colour index pixels are classed by: a pixel takes the class of its
 *  quantisation step's centre colour, so colours under a step apart class alike. */
const STEP_BITS = 6;
const STEP_SHIFT = 8 - STEP_BITS;

/** Index of an 8-bit colour's quantisation step into `stepColours`. */
export function stepIndex(r: number, g: number, b: number): number {
  return ((r >> STEP_SHIFT) << (2 * STEP_BITS)) | ((g >> STEP_SHIFT) << STEP_BITS) | (b >> STEP_SHIFT);
}

/** The L*a*b* of every quantisation step's centre colour, three values a step (3 MB). */
export function stepColours(): Float32Array {
  const steps = 1 << STEP_BITS;
  const half = (1 << STEP_SHIFT) / 2;
  const out = new Float32Array(steps ** 3 * 3);
  const c = (v: number) => Math.min(255, Math.floor((v << STEP_SHIFT) + half));
  for (let r = 0; r < steps; r++) {
    for (let g = 0; g < steps; g++) {
      for (let b = 0; b < steps; b++) toLab(c(r), c(g), c(b), out, ((r << (2 * STEP_BITS)) | (g << STEP_BITS) | b) * 3);
    }
  }
  return out;
}

const W = SCAN_PROFILE.evidence.weight;

/** The colour evidence's weight of every tile column and row; a pixel weighs their product. */
export function positionWeights(width: number, height: number): { x: Float32Array; y: Float32Array } {
  const x = new Float32Array(width);
  const y = new Float32Array(height);
  for (let i = 0; i < width; i++) x[i] = Math.exp(-(((i - W.centreX * width) / (W.sigmaX * width)) ** 2));
  for (let i = 0; i < height; i++) y[i] = Math.exp(-(((i - W.centreY * height) / (W.sigmaY * height)) ** 2));
  return { x, y };
}

/**
 * Gathers the colours the palette is fitted to from the kept distinct frames, before the path is solved:
 * a coarse centre-weighted mosaic on the tracked chain path, one bin every `step` ground pixels on
 * both axes. Every bin is the weighted mean colour of the frames that saw it, so each place on the
 * ground counts once however often the camera passed over it, and the coast, often seen only near
 * the view's edges, is represented as much as the centre of the planet. On the reference
 * recordings the chain path lies a median 7 to 15 and at most 50 rectified pixels from the solved
 * path, so a place revisited after drift can fill a second bin; the palette clusters colours and
 * does not use where a bin lies.
 * Memory: 16 bytes per bin, about 2 MB for the largest scan.
 */
export class PaletteSampler {
  private readonly weights: { x: Float32Array; y: Float32Array };
  /** Bins [bx0, bx0 + cols) x [by0, by0 + rows), each its weighted R, G, B sums and weight. */
  private bx0 = 0;
  private by0 = 0;
  private cols = 0;
  private rows = 0;
  private sums = new Float32Array(0);
  /** The bins any tile reached: [seen.x0, seen.x1) x [seen.y0, seen.y1). */
  private seen = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };

  constructor(
    readonly width: number,
    readonly height: number,
    readonly capacity: number = SCAN_PROFILE.evidence.paletteSamples,
    /** Ground pixels per bin on both axes. */
    readonly step: number = SCAN_PROFILE.evidence.paletteStep,
    /** A bin enters the palette above this accumulated weight. */
    readonly minWeight: number = SCAN_PROFILE.evidence.paletteMinWeight,
  ) {
    this.weights = positionWeights(width, height);
  }

  /** Grows the bin grid to hold bins [x0, x1) x [y0, y1). */
  private cover(x0: number, y0: number, x1: number, y1: number): void {
    if (this.cols > 0 && x0 >= this.bx0 && y0 >= this.by0 && x1 <= this.bx0 + this.cols && y1 <= this.by0 + this.rows) return;
    const nx0 = this.cols > 0 ? Math.min(this.bx0, x0 - this.cols) : x0;
    const ny0 = this.rows > 0 ? Math.min(this.by0, y0 - this.rows) : y0;
    const nx1 = this.cols > 0 ? Math.max(this.bx0 + this.cols, x1 + this.cols) : x1;
    const ny1 = this.rows > 0 ? Math.max(this.by0 + this.rows, y1 + this.rows) : y1;
    const cols = nx1 - nx0;
    const sums = new Float32Array(cols * (ny1 - ny0) * 4);
    for (let r = 0; r < this.rows; r++) {
      const from = r * this.cols * 4;
      sums.set(this.sums.subarray(from, from + this.cols * 4), ((r + this.by0 - ny0) * cols + this.bx0 - nx0) * 4);
    }
    this.bx0 = nx0;
    this.by0 = ny0;
    this.cols = cols;
    this.rows = ny1 - ny0;
    this.sums = sums;
  }

  /** Folds in one rectified RGBA tile whose origin sits at `at` on the chain path. */
  push(tile: RgbaImage, at: { readonly x: number; readonly y: number }): void {
    if (tile.width !== this.width || tile.height !== this.height) throw new Error(`the palette sampler expects ${this.width}x${this.height} tiles`);
    const { step } = this;
    const ox = Math.round(at.x);
    const oy = Math.round(at.y);
    // The tile pixels on the ground's bin grid, and the bins they fall in.
    const tx0 = (((-ox) % step) + step) % step;
    const ty0 = (((-oy) % step) + step) % step;
    const bx = (ox + tx0) / step;
    const by = (oy + ty0) / step;
    const nx = Math.ceil((this.width - tx0) / step);
    const ny = Math.ceil((this.height - ty0) / step);
    this.cover(bx, by, bx + nx, by + ny);
    const seen = this.seen;
    seen.x0 = Math.min(seen.x0, bx);
    seen.y0 = Math.min(seen.y0, by);
    seen.x1 = Math.max(seen.x1, bx + nx);
    seen.y1 = Math.max(seen.y1, by + ny);
    const { x: wx, y: wy } = this.weights;
    const d = tile.data;
    const sums = this.sums;
    for (let j = 0; j < ny; j++) {
      const y = ty0 + j * step;
      const row = ((by + j - this.by0) * this.cols + bx - this.bx0) * 4;
      for (let i = 0; i < nx; i++) {
        const x = tx0 + i * step;
        const w = wx[x]! * wy[y]!;
        const p = (y * this.width + x) * 4;
        const o = row + i * 4;
        sums[o]! += w * d[p]!;
        sums[o + 1]! += w * d[p + 1]!;
        sums[o + 2]! += w * d[p + 2]!;
        sums[o + 3]! += w;
      }
    }
  }

  /** The bins so far: bins [x0, x0 + cols) x [y0, y0 + rows) of `step` ground pixels, each its
   *  weighted R, G, B sums and weight, and the bins tiles reached (`seen`, in the same bin
   *  coordinates; empty before the first tile). Read only; the next `push` may replace it. */
  get mosaic(): {
    readonly x0: number; readonly y0: number; readonly cols: number; readonly rows: number; readonly step: number; readonly sums: Float32Array;
    readonly seen: { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number };
  } {
    return { x0: this.bx0, y0: this.by0, cols: this.cols, rows: this.rows, step: this.step, sums: this.sums, seen: { ...this.seen } };
  }

  /** The mosaic's bins above `minWeight` as L*a*b* triples, every k-th bin in grid order when
   *  more than `capacity` qualify; deterministic. */
  samples(): Float32Array {
    const sums = this.sums;
    const bins = sums.length / 4;
    let qualifying = 0;
    for (let b = 0; b < bins; b++) if (sums[b * 4 + 3]! > this.minWeight) qualifying++;
    const stride = Math.max(1, Math.ceil(qualifying / this.capacity));
    const out = new Float32Array(Math.ceil(qualifying / stride) * 3);
    const one = new Float64Array(3);
    let seen = 0;
    let kept = 0;
    for (let b = 0; b < bins; b++) {
      const w = sums[b * 4 + 3]!;
      if (!(w > this.minWeight)) continue;
      if (seen++ % stride !== 0) continue;
      const c = (v: number) => Math.min(255, Math.max(0, Math.round(v / w)));
      toLab(c(sums[b * 4]!), c(sums[b * 4 + 1]!), c(sums[b * 4 + 2]!), one);
      out.set(one, kept++ * 3);
    }
    return out.subarray(0, kept * 3);
  }
}

/**
 * The palette with its sand centres fitted again over each region of the ground, from a palette
 * sampler's mosaic. The game lights some places in their own tint, the same on every pass; a tinted
 * beach lies far enough from the recording's sand for the shallows' centre to take its wet edge, and
 * read against the sand of its own region the coast stays where the beach ends. The sea and grass
 * centres stay the recording's: fitted per region they move the station's deck and shallows off sea.
 */
export interface LocalPalette {
  /** Every centre's class, as in the recording's palette. */
  readonly classes: Uint8Array;
  /** Ground pixel of the first region's corner, a region's size in ground pixels, and the region grid. */
  readonly x0: number;
  readonly y0: number;
  readonly width: number;
  readonly height: number;
  readonly cols: number;
  readonly rows: number;
  /** Per region, every centre's L*a*b*, region-major. */
  readonly centres: Float64Array;
}

const LP = SCAN_PROFILE.ground.localPalette;

/** Interpolates the centres of a region grid bilinearly between region centres at region coordinates (u, v), into `out`. */
function regionCentres(local: LocalPalette, u: number, v: number, out: Float64Array): void {
  const { cols, rows, centres } = local;
  const k3 = local.classes.length * 3;
  const cu = Math.max(0, Math.min(cols - 1, u));
  const cv = Math.max(0, Math.min(rows - 1, v));
  const x0 = Math.max(0, Math.min(cols - 2, Math.floor(cu)));
  const y0 = Math.max(0, Math.min(rows - 2, Math.floor(cv)));
  const ax = cols > 1 ? Math.min(1, cu - x0) : 0;
  const ay = rows > 1 ? Math.min(1, cv - y0) : 0;
  const x1 = Math.min(cols - 1, x0 + 1);
  const y1 = Math.min(rows - 1, y0 + 1);
  const corners = [[y0 * cols + x0, (1 - ax) * (1 - ay)], [y0 * cols + x1, ax * (1 - ay)], [y1 * cols + x0, (1 - ax) * ay], [y1 * cols + x1, ax * ay]] as const;
  out.fill(0, 0, k3);
  for (const [r, w] of corners) for (let j = 0; j < k3; j++) out[j] = out[j]! + w * centres[r * k3 + j]!;
}

/** The centres at ground pixel (x, y) of a local palette, into `out` (three values a centre). */
export function centresAt(local: LocalPalette, x: number, y: number, out: Float64Array): void {
  regionCentres(local, (x - local.x0) / local.width - 0.5, (y - local.y0) / local.height - 0.5, out);
}

/** The nearest of `k` centres to the L*a*b* colour at `at` in `lab`. */
export function nearestCentre(lab: ArrayLike<number>, centres: ArrayLike<number>, k: number, at = 0): number {
  const l = lab[at]!, a = lab[at + 1]!, b = lab[at + 2]!;
  let best = 0;
  let bd = Infinity;
  for (let c = 0; c < k; c++) {
    const d = (l - centres[c * 3]!) ** 2 + (a - centres[c * 3 + 1]!) ** 2 + (b - centres[c * 3 + 2]!) ** 2;
    if (d < bd) {
      bd = d;
      best = c;
    }
  }
  return best;
}

/**
 * A local palette from a sampler's mosaic: regions of `localPalette.regionChunks` chunks, each sand
 * centre the mean of the region's mosaic bins nearest to it and at most `localPalette.margin` times
 * as far from it as from any other centre (a bin mixing sand with the sea or grass beside it is
 * left out), drawn towards the recording's centre by `localPalette.prior` bins and refitted
 * `localPalette.iterations` times; deterministic.
 */
export function localPalette(centres: Float64Array, classes: Uint8Array, sampler: PaletteSampler): LocalPalette {
  const m = sampler.mosaic;
  const k = classes.length;
  const width = SCAN_PROFILE.chunk.width * LP.regionChunks;
  const height = SCAN_PROFILE.chunk.height * LP.regionChunks;
  const x0 = m.x0 * m.step;
  const y0 = m.y0 * m.step;
  const cols = Math.max(1, Math.ceil((m.cols * m.step) / width));
  const rows = Math.max(1, Math.ceil((m.rows * m.step) / height));
  const lab: number[] = [];
  const at: number[] = [];
  const one = new Float64Array(3);
  for (let j = 0; j < m.rows; j++) {
    for (let i = 0; i < m.cols; i++) {
      const o = (j * m.cols + i) * 4;
      const w = m.sums[o + 3]!;
      if (!(w > sampler.minWeight)) continue;
      const c = (v: number) => Math.min(255, Math.max(0, Math.round(v / w)));
      toLab(c(m.sums[o]!), c(m.sums[o + 1]!), c(m.sums[o + 2]!), one);
      lab.push(one[0]!, one[1]!, one[2]!);
      at.push((i * m.step) / width, (j * m.step) / height);
    }
  }
  const local: LocalPalette = { classes, x0, y0, width, height, cols, rows, centres: new Float64Array(cols * rows * k * 3) };
  for (let r = 0; r < cols * rows; r++) local.centres.set(centres.subarray(0, k * 3), r * k * 3);
  const here = new Float64Array(k * 3);
  for (let it = 0; it < LP.iterations; it++) {
    const sum = new Float64Array(cols * rows * k * 3);
    const count = new Float64Array(cols * rows * k);
    for (let b = 0; b < lab.length / 3; b++) {
      regionCentres(local, at[b * 2]! - 0.5, at[b * 2 + 1]! - 0.5, here);
      let c = 0, near = Infinity, next = Infinity;
      for (let q = 0; q < k; q++) {
        const d = Math.hypot(lab[b * 3]! - here[q * 3]!, lab[b * 3 + 1]! - here[q * 3 + 1]!, lab[b * 3 + 2]! - here[q * 3 + 2]!);
        if (d < near) {
          next = near;
          near = d;
          c = q;
        } else if (d < next) next = d;
      }
      if (classes[c] !== SAND || near > LP.margin * next) continue;
      const r = Math.min(rows - 1, Math.floor(at[b * 2 + 1]!)) * cols + Math.min(cols - 1, Math.floor(at[b * 2]!));
      count[r * k + c]! += 1;
      for (let q = 0; q < 3; q++) sum[(r * k + c) * 3 + q]! += lab[b * 3 + q]!;
    }
    for (let r = 0; r < cols * rows; r++) {
      for (let c = 0; c < k; c++) {
        if (classes[c] !== SAND) continue;
        const o = (r * k + c) * 3;
        for (let q = 0; q < 3; q++) local.centres[o + q] = (sum[o + q]! + LP.prior * centres[c * 3 + q]!) / (count[r * k + c]! + LP.prior);
      }
    }
  }
  return local;
}
