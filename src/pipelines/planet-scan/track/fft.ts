// Radix-2 complex FFTs on split real and imaginary Float64Arrays, in place. The forward transform
// is X[k] = sum_n x[n] e^(-2 pi i k n / N); the inverse uses the opposite sign and divides by N.

function isPowerOfTwo(n: number): boolean {
  return Number.isInteger(n) && n > 0 && (n & (n - 1)) === 0;
}

export function nextPowerOfTwo(n: number): number {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

/** Twiddles and bit reversal for one transform length. */
class Plan {
  readonly cos: Float64Array;
  readonly sin: Float64Array;
  readonly rev: Uint32Array;

  constructor(readonly n: number) {
    if (!isPowerOfTwo(n)) throw new Error(`FFT length ${n} is not a power of two`);
    this.cos = new Float64Array(n / 2);
    this.sin = new Float64Array(n / 2);
    for (let k = 0; k < n / 2; k++) {
      this.cos[k] = Math.cos((2 * Math.PI * k) / n);
      this.sin[k] = Math.sin((2 * Math.PI * k) / n);
    }
    this.rev = new Uint32Array(n);
    const bits = Math.log2(n);
    for (let i = 0; i < n; i++) {
      let r = 0;
      for (let b = 0, x = i; b < bits; b++, x >>= 1) r = (r << 1) | (x & 1);
      this.rev[i] = r;
    }
  }
}

/** One-dimensional transform of length `n` over `re[offset .. offset + n)`. */
export class Fft {
  private readonly plan: Plan;

  constructor(readonly n: number) {
    this.plan = new Plan(n);
  }

  forward(re: Float64Array, im: Float64Array, offset = 0): void {
    transform1d(this.plan, re, im, offset, -1);
  }

  inverse(re: Float64Array, im: Float64Array, offset = 0): void {
    transform1d(this.plan, re, im, offset, 1);
    const s = 1 / this.n;
    for (let i = offset; i < offset + this.n; i++) {
      re[i]! *= s;
      im[i]! *= s;
    }
  }
}

function transform1d(plan: Plan, re: Float64Array, im: Float64Array, off: number, sign: number): void {
  const { n, rev, cos, sin } = plan;
  for (let i = 0; i < n; i++) {
    const j = rev[i]!;
    if (j > i) {
      const a = off + i;
      const b = off + j;
      let t = re[a]!;
      re[a] = re[b]!;
      re[b] = t;
      t = im[a]!;
      im[a] = im[b]!;
      im[b] = t;
    }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1;
    const stride = n / size;
    for (let k = 0; k < half; k++) {
      const wr = cos[k * stride]!;
      const wi = sign * sin[k * stride]!;
      for (let start = off + k; start < off + n; start += size) {
        const b = start + half;
        const br = re[b]!;
        const bi = im[b]!;
        const tr = wr * br - wi * bi;
        const ti = wr * bi + wi * br;
        const ar = re[start]!;
        const ai = im[start]!;
        re[b] = ar - tr;
        im[b] = ai - ti;
        re[start] = ar + tr;
        im[start] = ai + ti;
      }
    }
  }
}

/**
 * Two-dimensional transform of a row-major `width` by `height` grid. Rows run as 1D transforms;
 * columns run as whole-row butterflies so every inner loop walks contiguous memory.
 */
export class Fft2d {
  private readonly rows: Plan;
  private readonly cols: Plan;
  private readonly swap: Float64Array;

  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.rows = new Plan(width);
    this.cols = new Plan(height);
    this.swap = new Float64Array(width);
  }

  forward(re: Float64Array, im: Float64Array): void {
    this.run(re, im, -1);
  }

  inverse(re: Float64Array, im: Float64Array): void {
    this.run(re, im, 1);
    const s = 1 / (this.width * this.height);
    for (let i = 0; i < re.length; i++) {
      re[i]! *= s;
      im[i]! *= s;
    }
  }

  private run(re: Float64Array, im: Float64Array, sign: number): void {
    const w = this.width;
    const h = this.height;
    if (re.length !== w * h || im.length !== w * h) throw new Error(`FFT buffers must hold ${w}x${h} values`);
    for (let y = 0; y < h; y++) transform1d(this.rows, re, im, y * w, sign);
    this.columns(re, im, sign);
  }

  private columns(re: Float64Array, im: Float64Array, sign: number): void {
    const w = this.width;
    const { n, rev, cos, sin } = this.cols;
    const swap = this.swap;
    for (let y = 0; y < n; y++) {
      const r = rev[y]!;
      if (r > y) {
        for (const buf of [re, im]) {
          swap.set(buf.subarray(y * w, y * w + w));
          buf.copyWithin(y * w, r * w, r * w + w);
          buf.set(swap, r * w);
        }
      }
    }
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1;
      const stride = n / size;
      for (let k = 0; k < half; k++) {
        const wr = cos[k * stride]!;
        const wi = sign * sin[k * stride]!;
        for (let start = k; start < n; start += size) {
          const a = start * w;
          const b = (start + half) * w;
          for (let x = 0; x < w; x++) {
            const br = re[b + x]!;
            const bi = im[b + x]!;
            const tr = wr * br - wi * bi;
            const ti = wr * bi + wi * br;
            const ar = re[a + x]!;
            const ai = im[a + x]!;
            re[b + x] = ar - tr;
            im[b + x] = ai - ti;
            re[a + x] = ar + tr;
            im[a + x] = ai + ti;
          }
        }
      }
    }
  }
}

/** One complex grid as its real and imaginary planes. */
export interface ComplexPlane { re: Float64Array; im: Float64Array }

/**
 * Splits the forward transform of `a + i b`, for real grids `a` and `b`, into the spectra of `a`
 * and `b`: A[k] = (Z[k] + conj Z[-k]) / 2 and B[k] = (Z[k] - conj Z[-k]) / 2i. One complex
 * transform thus serves two real ones.
 */
export function splitRealPair(width: number, height: number, z: ComplexPlane, a: ComplexPlane, b: ComplexPlane): void {
  const { re: zRe, im: zIm } = z, { re: aRe, im: aIm } = a, { re: bRe, im: bIm } = b;
  for (let y = 0; y < height; y++) {
    const ny = y === 0 ? 0 : height - y;
    for (let x = 0; x < width; x++) {
      const nx = x === 0 ? 0 : width - x;
      const p = y * width + x;
      const q = ny * width + nx;
      const pr = zRe[p]!;
      const pi = zIm[p]!;
      const qr = zRe[q]!;
      const qi = -zIm[q]!;
      aRe[p] = (pr + qr) / 2;
      aIm[p] = (pi + qi) / 2;
      // (p - q) / 2i = (Im(p - q) - i Re(p - q)) / 2
      bRe[p] = (pi - qi) / 2;
      bIm[p] = -(pr - qr) / 2;
    }
  }
}
