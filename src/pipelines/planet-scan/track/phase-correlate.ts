import { Fft2d, nextPowerOfTwo, splitRealPair } from './fft';
import { SCAN_PROFILE } from '../profile';
import type { GreyImage, ShiftCandidate, ShiftEstimate } from '../types';

// Translation between two equally sized grey tiles by phase correlation. Inputs are Hann-windowed
// and zero-padded to powers of two. The window weights the tile centre, so the true peak is
// reliable only while the two tiles overlap by at least about 0.4 of the tile on each axis;
// beyond that it drops out of the candidates. For larger offsets, crop both tiles to their
// overlap at a predicted shift and correlate the crops, adding the predicted shift back.

/** Box widths whose three passes approximate a Gaussian of `sigma`. */
function gaussianBoxes(sigma: number): [number, number, number] {
  const ideal = Math.sqrt((12 * sigma * sigma) / 3 + 1);
  let lower = Math.floor(ideal);
  if (lower % 2 === 0) lower--;
  const upper = lower + 2;
  const m = Math.round((12 * sigma * sigma - 3 * lower * lower - 12 * lower - 9) / (-4 * lower - 4));
  return [0, 1, 2].map((i) => (i < m ? lower : upper)) as [number, number, number];
}

function boxRows(src: Float32Array, dst: Float32Array, w: number, h: number, r: number): void {
  const norm = 1 / (2 * r + 1);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let sum = src[row]! * (r + 1);
    for (let x = 1; x <= r; x++) sum += src[row + Math.min(x, w - 1)]!;
    for (let x = 0; x < w; x++) {
      dst[row + x] = sum * norm;
      sum += src[row + Math.min(x + r + 1, w - 1)]! - src[row + Math.max(x - r, 0)]!;
    }
  }
}

function boxColumns(src: Float32Array, dst: Float32Array, size: { w: number; h: number }, r: number, sums: Float64Array): void {
  const { w, h } = size;
  const norm = 1 / (2 * r + 1);
  for (let x = 0; x < w; x++) sums[x] = src[x]! * (r + 1);
  for (let y = 1; y <= r; y++) {
    const row = Math.min(y, h - 1) * w;
    for (let x = 0; x < w; x++) sums[x]! += src[row + x]!;
  }
  for (let y = 0; y < h; y++) {
    const out = y * w;
    const add = Math.min(y + r + 1, h - 1) * w;
    const sub = Math.max(y - r, 0) * w;
    for (let x = 0; x < w; x++) {
      dst[out + x] = sums[x]! * norm;
      sums[x]! += src[add + x]! - src[sub + x]!;
    }
  }
}

/** Reusable buffers for `highPass` on one tile size. */
export interface HighPassScratch {
  readonly blur: Float32Array;
  readonly temp: Float32Array;
  readonly sums: Float64Array;
}

export function highPassScratch(width: number, height: number): HighPassScratch {
  return { blur: new Float32Array(width * height), temp: new Float32Array(width * height), sums: new Float64Array(width) };
}

/**
 * `src` minus its Gaussian blur of `sigma` (three box passes per axis, edges replicated). Removes
 * lighting gradients and the vignette, which stay put while the ground moves.
 */
export function highPass(
  image: GreyImage,
  sigma: number,
  out = new Float32Array(image.width * image.height),
  scratch = highPassScratch(image.width, image.height),
): GreyImage {
  const { width, height, data: src } = image;
  const { blur, temp, sums } = scratch;
  let from: Float32Array = src;
  for (const box of gaussianBoxes(sigma)) {
    const r = (box - 1) / 2;
    boxRows(from, temp, width, height, r);
    boxColumns(temp, blur, { w: width, h: height }, r, sums);
    from = blur;
  }
  for (let i = 0; i < width * height; i++) out[i] = src[i]! - blur[i]!;
  return { width, height, data: out };
}

/**
 * Normalised cross-correlation of `b` against `a` shifted by integer (dx, dy) over their overlap,
 * and the overlap as a share of the tile. An overlap narrower than `minWidth` or shorter than
 * `minHeight` pixels scores -1.
 */
export function overlapNcc(
  image: GreyImage,
  shifted: GreyImage,
  shift: { dx: number; dy: number },
  minWidth = 1,
  minHeight = 1,
): { ncc: number; overlap: number } {
  const { dx, dy } = shift;
  const { width, height, data: a } = image;
  if (shifted.width !== width || shifted.height !== height) throw new Error('overlap correlation needs equal tiles');
  const b = shifted.data;
  const x0 = Math.max(0, dx);
  const x1 = Math.min(width, width + dx);
  const y0 = Math.max(0, dy);
  const y1 = Math.min(height, height + dy);
  if (x1 - x0 < minWidth || y1 - y0 < minHeight) return { ncc: -1, overlap: 0 };
  let sa = 0;
  let sb = 0;
  let saa = 0;
  let sbb = 0;
  let sab = 0;
  for (let y = y0; y < y1; y++) {
    const rb = y * width;
    const ra = (y - dy) * width - dx;
    for (let x = x0; x < x1; x++) {
      const va = a[ra + x]!;
      const vb = b[rb + x]!;
      sa += va;
      sb += vb;
      saa += va * va;
      sbb += vb * vb;
      sab += va * vb;
    }
  }
  const n = (x1 - x0) * (y1 - y0);
  const cov = sab - (sa * sb) / n;
  const va = saa - (sa * sa) / n;
  const vb = sbb - (sb * sb) / n;
  const den = Math.sqrt(va * vb);
  return { ncc: den > 0 ? cov / den : 0, overlap: n / (width * height) };
}

/** Correlator tuning; each value defaults to, and is documented in, `SCAN_PROFILE.tracking.correlation`. */
export interface PhaseCorrelatorOptions {
  readonly candidates?: number;
  readonly suppressRadius?: number;
  readonly smoothSigma?: number;
  /** Shares of the tile on each axis. */
  readonly minOverlapWidth?: number;
  readonly minOverlapHeight?: number;
  readonly minNcc?: number;
}

const DEFAULTS: Required<PhaseCorrelatorOptions> = SCAN_PROFILE.tracking.correlation;

/**
 * Phase correlation for tiles of one size, with every buffer allocated once. `correlate` keeps
 * the smoothed, normalised cross-power spectrum of the last pair, which `refine` maximises as a
 * continuous surface. The smoothing kernel is symmetric and the series is evaluated exactly, so
 * sub-pixel estimates carry no pull toward whole pixels.
 */
export class PhaseCorrelator {
  readonly paddedWidth: number;
  readonly paddedHeight: number;
  private readonly options: Required<PhaseCorrelatorOptions>;
  private readonly fft: Fft2d;
  private readonly winX: Float64Array;
  private readonly winY: Float64Array;
  private readonly zRe: Float64Array;
  private readonly zIm: Float64Array;
  private readonly aRe: Float64Array;
  private readonly aIm: Float64Array;
  /** The smoothed, normalised cross-power spectrum of the last pair. */
  private readonly cRe: Float64Array;
  private readonly cIm: Float64Array;
  /** The smoothing Gaussian's transform per row and column frequency. */
  private readonly smoothX: Float64Array;
  private readonly smoothY: Float64Array;
  /** Scales surface values so identical tiles peak at 1. */
  private readonly unit: number;
  private readonly basisX: Float64Array;
  private readonly basisY: Float64Array;
  private ready = false;

  constructor(
    readonly width: number,
    readonly height: number,
    options: PhaseCorrelatorOptions = {},
  ) {
    this.options = { ...DEFAULTS, ...options };
    const pw = (this.paddedWidth = nextPowerOfTwo(width));
    const ph = (this.paddedHeight = nextPowerOfTwo(height));
    this.fft = new Fft2d(pw, ph);
    this.winX = hann(width);
    this.winY = hann(height);
    const n = pw * ph;
    this.zRe = new Float64Array(n);
    this.zIm = new Float64Array(n);
    this.aRe = new Float64Array(n);
    this.aIm = new Float64Array(n);
    this.cRe = new Float64Array(n);
    this.cIm = new Float64Array(n);
    this.smoothX = gaussianTransform(pw, this.options.smoothSigma);
    this.smoothY = gaussianTransform(ph, this.options.smoothSigma);
    const sum = (v: Float64Array) => v.reduce((t, g) => t + g, 0);
    this.unit = (pw * ph) / (sum(this.smoothX) * sum(this.smoothY));
    // Six complex values per frequency: e^(i w x), w e^(i w x), w^2 e^(i w x).
    this.basisX = new Float64Array(pw * 6);
    this.basisY = new Float64Array(ph * 6);
  }

  /**
   * Correlates `b` against `a` and returns the highest distinct peaks of the smoothed surface,
   * highest first, as integer shifts with `b(x, y) ~ a(x - dx, y - dy)`.
   */
  correlate(image: GreyImage, shifted: GreyImage): ShiftCandidate[] {
    const { width: w, height: h, paddedWidth: pw, paddedHeight: ph } = this;
    for (const t of [image, shifted]) {
      if (t.width !== w || t.height !== h) throw new Error(`phase correlation expects ${w}x${h} tiles`);
    }
    const a = image.data;
    const b = shifted.data;
    const { zRe, zIm, aRe, aIm, cRe, cIm, winX, winY, smoothX, smoothY } = this;
    zRe.fill(0);
    zIm.fill(0);
    for (let y = 0; y < h; y++) {
      const wy = winY[y]!;
      const src = y * w;
      const dst = y * pw;
      for (let x = 0; x < w; x++) {
        const win = wy * winX[x]!;
        zRe[dst + x] = a[src + x]! * win;
        zIm[dst + x] = b[src + x]! * win;
      }
    }
    this.fft.forward(zRe, zIm);
    // The spectrum of b lands in cRe/cIm and is overwritten by the cross power below.
    splitRealPair(pw, ph, { re: zRe, im: zIm }, { re: aRe, im: aIm }, { re: cRe, im: cIm });
    for (let ky = 0; ky < ph; ky++) {
      const gy = smoothY[ky]!;
      for (let kx = 0, k = ky * pw; kx < pw; kx++, k++) {
        const ar = aRe[k]!;
        const ai = aIm[k]!;
        const br = cRe[k]!;
        const bi = cIm[k]!;
        // B conj(A)
        const re = br * ar + bi * ai;
        const im = bi * ar - br * ai;
        const mag = Math.sqrt(re * re + im * im);
        const s = mag > 1e-12 ? (gy * smoothX[kx]!) / mag : 0;
        cRe[k] = re * s;
        cIm[k] = im * s;
      }
    }
    zRe.set(cRe);
    zIm.set(cIm);
    this.fft.inverse(zRe, zIm);
    this.ready = true;
    return this.peaks(zRe);
  }

  private peaks(surface: Float64Array): ShiftCandidate[] {
    const { paddedWidth: pw, paddedHeight: ph } = this;
    const want = this.options.candidates;
    const pool = want * 4;
    const best: { x: number; y: number; v: number }[] = [];
    for (let y = 0; y < ph; y++) {
      const up = ((y - 1 + ph) & (ph - 1)) * pw;
      const row = y * pw;
      const down = ((y + 1) & (ph - 1)) * pw;
      for (let x = 0; x < pw; x++) {
        const v = surface[row + x]!;
        if (best.length === pool && v <= best[pool - 1]!.v) continue;
        const l = (x - 1 + pw) & (pw - 1);
        const rr = (x + 1) & (pw - 1);
        if (
          v < surface[row + l]! || v <= surface[row + rr]! ||
          v < surface[up + x]! || v <= surface[down + x]! ||
          v < surface[up + l]! || v < surface[up + rr]! ||
          v <= surface[down + l]! || v <= surface[down + rr]!
        ) continue;
        let i = best.length;
        if (i === pool) i--;
        while (i > 0 && best[i - 1]!.v < v) i--;
        best.splice(i, 0, { x, y, v });
        if (best.length > pool) best.pop();
      }
    }
    const out: ShiftCandidate[] = [];
    const r2 = this.options.suppressRadius ** 2;
    for (const p of best) {
      const dx = p.x < pw / 2 ? p.x : p.x - pw;
      const dy = p.y < ph / 2 ? p.y : p.y - ph;
      const near = out.some((q) => {
        const ex = Math.abs(q.dx - dx);
        const ey = Math.abs(q.dy - dy);
        return Math.min(ex, pw - ex) ** 2 + Math.min(ey, ph - ey) ** 2 <= r2;
      });
      if (near) continue;
      out.push({ dx, dy, peak: p.v * this.unit });
      if (out.length === want) break;
    }
    return out;
  }

  /**
   * The continuous maximum of the last correlation surface near (dx, dy), by Newton steps on its
   * Fourier series. Stays within 1.5 pixels of the start; a step that lowers the surface is
   * halved up to four times before the climb stops.
   */
  refine(dx: number, dy: number): { dx: number; dy: number; response: number } {
    if (!this.ready) throw new Error('refine needs a correlation first');
    let x = dx;
    let y = dy;
    let s = this.series(x, y);
    for (let iter = 0; iter < 8; iter++) {
      const det = s.xx * s.yy - s.xy * s.xy;
      let stepX: number;
      let stepY: number;
      if (s.xx < 0 && det > 0) {
        stepX = -(s.yy * s.x - s.xy * s.y) / det;
        stepY = -(s.xx * s.y - s.xy * s.x) / det;
      } else {
        // Not concave here: a short climb along the gradient.
        const g = Math.hypot(s.x, s.y);
        if (g === 0) break;
        stepX = (0.25 * s.x) / g;
        stepY = (0.25 * s.y) / g;
      }
      const len = Math.hypot(stepX, stepY);
      if (len > 0.5) {
        stepX *= 0.5 / len;
        stepY *= 0.5 / len;
      }
      let nx = x;
      let ny = y;
      let next = s;
      for (let halving = 0; halving <= 4; halving++, stepX /= 2, stepY /= 2) {
        nx = Math.min(dx + 1.5, Math.max(dx - 1.5, x + stepX));
        ny = Math.min(dy + 1.5, Math.max(dy - 1.5, y + stepY));
        next = this.series(nx, ny);
        if (next.value >= s.value) break;
      }
      if (next.value < s.value) break;
      const moved = Math.hypot(nx - x, ny - y);
      x = nx;
      y = ny;
      s = next;
      if (moved < 1e-4) break;
    }
    return { dx: x, dy: y, response: s.value * this.unit };
  }

  /** Value, gradient and Hessian of the correlation surface at a real point. Sums over the
   *  half-plane of row frequencies 0..H/2 and doubles the conjugate rows. */
  private series(x: number, y: number): { value: number; x: number; y: number; xx: number; yy: number; xy: number } {
    const { paddedWidth: pw, paddedHeight: ph, cRe, cIm, basisX, basisY } = this;
    fillBasis(basisX, pw, x);
    fillBasis(basisY, ph, y);
    let v = 0;
    let gx = 0;
    let gy = 0;
    let hxx = 0;
    let hyy = 0;
    let hxy = 0;
    for (let ky = 0; ky <= ph / 2; ky++) {
      // Row sums R_j = sum over kx of C * ex_j.
      let r0r = 0, r0i = 0, r1r = 0, r1i = 0, r2r = 0, r2i = 0;
      const row = ky * pw;
      for (let kx = 0, o = 0; kx < pw; kx++, o += 6) {
        const cr = cRe[row + kx]!;
        const ci = cIm[row + kx]!;
        const e0r = basisX[o]!, e0i = basisX[o + 1]!;
        const e1r = basisX[o + 2]!, e1i = basisX[o + 3]!;
        const e2r = basisX[o + 4]!, e2i = basisX[o + 5]!;
        r0r += cr * e0r - ci * e0i;
        r0i += cr * e0i + ci * e0r;
        r1r += cr * e1r - ci * e1i;
        r1i += cr * e1i + ci * e1r;
        r2r += cr * e2r - ci * e2i;
        r2i += cr * e2i + ci * e2r;
      }
      const weight = ky === 0 || ky === ph / 2 ? 1 : 2;
      const o = ky * 6;
      const f0r = basisY[o]!, f0i = basisY[o + 1]!;
      const f1r = basisY[o + 2]!, f1i = basisY[o + 3]!;
      const f2r = basisY[o + 4]!, f2i = basisY[o + 5]!;
      // value = Re(R0 f0); d/dx = -Im(R1 f0); d/dy = -Im(R0 f1);
      // d2/dx2 = -Re(R2 f0); d2/dy2 = -Re(R0 f2); d2/dxdy = -Re(R1 f1).
      v += weight * (r0r * f0r - r0i * f0i);
      gx -= weight * (r1r * f0i + r1i * f0r);
      gy -= weight * (r0r * f1i + r0i * f1r);
      hxx -= weight * (r2r * f0r - r2i * f0i);
      hyy -= weight * (r0r * f2r - r0i * f2i);
      hxy -= weight * (r1r * f1r - r1i * f1i);
    }
    const s = 1 / (pw * ph);
    return { value: v * s, x: gx * s, y: gy * s, xx: hxx * s, yy: hyy * s, xy: hxy * s };
  }

  /**
   * The verified shift of `shifted` against `image`: the candidate whose integer shift correlates
   * best over an overlap of at least the minimum shares, refined to sub-pixel. Periodic ground
   * produces peaks a period away from the true shift; overlap correlation tells them apart. A
   * non-null result is verified: its overlap correlation exceeds `minNcc`. Null when no candidate
   * overlaps enough or the best one does not correlate.
   */
  estimate(image: GreyImage, shifted: GreyImage): ShiftEstimate | null {
    const candidates = this.correlate(image, shifted);
    const { width: w, height: h, options } = this;
    const minW = options.minOverlapWidth * w;
    const minH = options.minOverlapHeight * h;
    let best: { c: ShiftCandidate; rank: number; ncc: number; overlap: number } | null = null;
    for (let rank = 0; rank < candidates.length; rank++) {
      const c = candidates[rank]!;
      const v = overlapNcc(image, shifted, c, minW, minH);
      if (v.overlap > 0 && (!best || v.ncc > best.ncc)) best = { c, rank, ...v };
    }
    if (!best || best.ncc <= options.minNcc) return null;
    const { c, rank, ncc, overlap } = best;
    const fine = this.refine(c.dx, c.dy);
    return { dx: fine.dx, dy: fine.dy, response: fine.response, ncc, overlap, rank };
  }
}

/** Per frequency k of an n-point axis at position t: e^(i w t), w e^(i w t) and w^2 e^(i w t),
 *  with w = 2 pi k / n signed. The Nyquist bin takes the real interpolant cos(pi t). */
function fillBasis(out: Float64Array, n: number, t: number): void {
  for (let k = 0, o = 0; k < n; k++, o += 6) {
    if (k === n / 2) {
      const c = Math.cos(Math.PI * t);
      const s = Math.sin(Math.PI * t);
      out[o] = c;
      out[o + 1] = 0;
      out[o + 2] = 0;
      out[o + 3] = Math.PI * s;
      out[o + 4] = Math.PI * Math.PI * c;
      out[o + 5] = 0;
      continue;
    }
    const w = (2 * Math.PI * (k < n / 2 ? k : k - n)) / n;
    const c = Math.cos(w * t);
    const s = Math.sin(w * t);
    out[o] = c;
    out[o + 1] = s;
    out[o + 2] = w * c;
    out[o + 3] = w * s;
    out[o + 4] = w * w * c;
    out[o + 5] = w * w * s;
  }
}

/** Hann window of `n` samples, zero at both ends. */
function hann(n: number): Float64Array {
  const out = new Float64Array(n);
  if (n === 1) out[0] = 1;
  for (let i = 0; i < n && n > 1; i++) out[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)));
  return out;
}

/** The transform of a unit-sum Gaussian of `sigma` pixels at each frequency of an n-point axis. */
function gaussianTransform(n: number, sigma: number): Float64Array {
  const out = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    const f = (k <= n / 2 ? k : n - k) / n;
    out[k] = Math.exp(-2 * Math.PI * Math.PI * sigma * sigma * f * f);
  }
  return out;
}
