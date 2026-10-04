import { SCAN_PROFILE } from './profile';
import type { RgbaImage } from './types';

// Colour as the ground reader sees it: CIE L*a*b* (D65) from 8-bit sRGB, as OpenCV's 8-bit
// conversion computes it (L in 0..100, a and b centred on 0), HSV saturation in 0..255, and the
// hue angle of (a, b) in degrees.

/** Pixel classes of the ground palette. */
export const SEA = 0;
export const SAND = 1;
export const GRASS = 2;
export type PixelClass = typeof SEA | typeof SAND | typeof GRASS;

const LINEAR = new Float64Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  LINEAR[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

const labF = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);

/** Lightness of an 8-bit sRGB colour (channels rounded to integers). */
export function lightness(r: number, g: number, b: number): number {
  const y = 0.212671 * LINEAR[r]! + 0.71516 * LINEAR[g]! + 0.072169 * LINEAR[b]!;
  return y > 0.008856 ? 116 * Math.cbrt(y) - 16 : 903.3 * y;
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

/** Whether a hue angle lies in the sea's band (`SCAN_PROFILE.ground.seaHue`). */
export const inSeaBand = (hue: number): boolean => hue > SCAN_PROFILE.ground.seaHue[0] && hue < SCAN_PROFILE.ground.seaHue[1];

/** Bits per channel of the class lookup's colour index. */
const LUT_BITS = 6;
const LUT_SHIFT = 8 - LUT_BITS;

/** Index of an 8-bit colour into a class lookup. */
export function lutIndex(r: number, g: number, b: number): number {
  return ((r >> LUT_SHIFT) << (2 * LUT_BITS)) | ((g >> LUT_SHIFT) << LUT_BITS) | (b >> LUT_SHIFT);
}

/** The class of every colour quantised to `LUT_BITS` per channel, by `classify` on the
 *  quantisation step's centre colour. */
export function classLookup(classify: (r: number, g: number, b: number) => PixelClass): Uint8Array {
  const steps = 1 << LUT_BITS;
  const half = (1 << LUT_SHIFT) / 2;
  const lut = new Uint8Array(steps ** 3);
  for (let r = 0; r < steps; r++) {
    for (let g = 0; g < steps; g++) {
      for (let b = 0; b < steps; b++) {
        const c = (v: number) => Math.min(255, Math.floor((v << LUT_SHIFT) + half));
        lut[(r << (2 * LUT_BITS)) | (g << LUT_BITS) | b] = classify(c(r), c(g), c(b));
      }
    }
  }
  return lut;
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
