// Row-major raster operations of the ground reader: binary masks (1 set, 0 clear) and float
// planes. Morphology treats everything outside the raster as clear, so an erosion clears the
// border; components are 4-connected unless `eight` is set; hole filling floods the clear cells
// 4-connected from the border.

/** Dilation by a (2r+1)-square, which equals r iterations of a 3 x 3 square. */
export function dilate(mask: Uint8Array, w: number, h: number, r: number): Uint8Array {
  return squareFilter(mask, w, h, r, true);
}

/** Erosion by a (2r+1)-square with clear cells beyond the border. */
export function erode(mask: Uint8Array, w: number, h: number, r: number): Uint8Array {
  return squareFilter(mask, w, h, r, false);
}

export function close(mask: Uint8Array, w: number, h: number, r: number): Uint8Array {
  return r > 0 ? erode(dilate(mask, w, h, r), w, h, r) : mask.slice();
}

export function open(mask: Uint8Array, w: number, h: number, r: number): Uint8Array {
  return r > 0 ? dilate(erode(mask, w, h, r), w, h, r) : mask.slice();
}

function squareFilter(mask: Uint8Array, w: number, h: number, r: number, grow: boolean): Uint8Array {
  if (r <= 0) return mask.slice();
  const across = new Uint8Array(w * h);
  const out = new Uint8Array(w * h);
  const count = new Int32Array(Math.max(w, h) + 1);
  const pass = (src: Uint8Array, dst: Uint8Array, n: number, lines: number, at: (line: number, i: number) => number) => {
    for (let l = 0; l < lines; l++) {
      count[0] = 0;
      for (let i = 0; i < n; i++) count[i + 1] = count[i]! + src[at(l, i)]!;
      for (let i = 0; i < n; i++) {
        const lo = i - r;
        const hi = i + r;
        const set = count[Math.min(n, hi + 1)]! - count[Math.max(0, lo)]!;
        dst[at(l, i)] = grow ? (set > 0 ? 1 : 0) : lo >= 0 && hi < n && set === 2 * r + 1 ? 1 : 0;
      }
    }
  };
  pass(mask, across, w, h, (y, x) => y * w + x);
  pass(across, out, h, w, (x, y) => y * w + x);
  return out;
}

/** Connected components of the set cells: labels from 1 (0 for clear cells) and each size. */
export function label(mask: Uint8Array, w: number, h: number, eight = false): { labels: Int32Array; sizes: number[] } {
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
          if (mask[j] && !labels[j]) {
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

/** The largest 4-connected component; the first in raster order among equals. Empty stays empty. */
export function largestComponent(mask: Uint8Array, w: number, h: number): Uint8Array {
  const { labels, sizes } = label(mask, w, h);
  let best = 0;
  for (let i = 1; i < sizes.length; i++) if (sizes[i]! > (sizes[best] ?? 0)) best = i;
  const out = new Uint8Array(w * h);
  if (best > 0) for (let i = 0; i < out.length; i++) out[i] = labels[i] === best ? 1 : 0;
  return out;
}

/** The components of `mask` that hold a cell of `seeds`. */
export function componentsTouching(mask: Uint8Array, seeds: Uint8Array, w: number, h: number, eight: boolean): Uint8Array {
  const { labels, sizes } = label(mask, w, h, eight);
  const keep = new Uint8Array(sizes.length);
  for (let i = 0; i < labels.length; i++) if (seeds[i] && labels[i]) keep[labels[i]!] = 1;
  const out = new Uint8Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = keep[labels[i]!] ? 1 : 0;
  return out;
}

/** The mask with every clear region that does not reach the border set. */
export function fillHoles(mask: Uint8Array, w: number, h: number): Uint8Array {
  const outside = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  let top = 0;
  const seed = (i: number) => {
    if (!mask[i] && !outside[i]) {
      outside[i] = 1;
      stack[top++] = i;
    }
  };
  for (let x = 0; x < w; x++) {
    seed(x);
    seed((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    seed(y * w);
    seed(y * w + w - 1);
  }
  while (top > 0) {
    const i = stack[--top]!;
    const x = i % w;
    if (x > 0) seed(i - 1);
    if (x < w - 1) seed(i + 1);
    if (i >= w) seed(i - w);
    if (i < (h - 1) * w) seed(i + w);
  }
  const out = new Uint8Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = outside[i] ? 0 : 1;
  return out;
}

/** Chessboard distance of every set cell to the nearest clear cell (0 on clear cells); cells with
 *  no clear cell in the raster get the raster's size. */
export function chessboardDistance(mask: Uint8Array, w: number, h: number): Int32Array {
  const far = w + h;
  const d = new Int32Array(w * h);
  for (let i = 0; i < d.length; i++) d[i] = mask[i] ? far : 0;
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? far : d[y * w + x]!);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!d[i]) continue;
      d[i] = Math.min(d[i]!, at(x - 1, y) + 1, at(x - 1, y - 1) + 1, at(x, y - 1) + 1, at(x + 1, y - 1) + 1);
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      if (!d[i]) continue;
      d[i] = Math.min(d[i]!, at(x + 1, y) + 1, at(x + 1, y + 1) + 1, at(x, y + 1) + 1, at(x - 1, y + 1) + 1);
    }
  }
  return d;
}

function gaussianKernel(sigma: number): Float64Array {
  const r = Math.max(1, Math.ceil(3 * sigma));
  const k = new Float64Array(2 * r + 1);
  let sum = 0;
  for (let i = -r; i <= r; i++) sum += k[i + r] = Math.exp(-(i * i) / (2 * sigma * sigma));
  for (let i = 0; i < k.length; i++) k[i]! /= sum;
  return k;
}

/**
 * Gaussian blur with sigmas in raster cells per axis. With `weight`, the blur is normalised by the
 * blurred weight, so cells of weight 0 neither contribute nor drag their neighbours toward 0; those
 * cells keep their own value. Without it, the border reflects.
 */
export function blur(src: Float32Array, w: number, h: number, sx: number, sy: number, weight?: Float32Array): Float32Array {
  const num = new Float32Array(w * h);
  const den = weight ? new Float32Array(w * h) : null;
  for (let i = 0; i < num.length; i++) {
    const wt = weight ? weight[i]! : 1;
    num[i] = src[i]! * wt;
    if (den) den[i] = wt;
  }
  const run = (plane: Float32Array) => {
    convolve(plane, w, h, gaussianKernel(sx), true);
    convolve(plane, w, h, gaussianKernel(sy), false);
  };
  run(num);
  if (!den) return num;
  run(den);
  const out = new Float32Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = den[i]! > 1e-6 && weight![i]! > 0 ? num[i]! / den[i]! : src[i]!;
  return out;
}

function convolve(plane: Float32Array, w: number, h: number, k: Float64Array, alongRows: boolean): void {
  const r = (k.length - 1) / 2;
  const n = alongRows ? w : h;
  const lines = alongRows ? h : w;
  const line = new Float64Array(n);
  const reflect = (i: number) => {
    if (n === 1) return 0;
    let j = i;
    while (j < 0 || j >= n) j = j < 0 ? -j : 2 * (n - 1) - j;
    return j;
  };
  for (let l = 0; l < lines; l++) {
    const at = (i: number) => (alongRows ? l * w + i : i * w + l);
    for (let i = 0; i < n; i++) line[i] = plane[at(i)]!;
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (let t = -r; t <= r; t++) s += k[t + r]! * line[reflect(i + t)]!;
      plane[at(i)] = s;
    }
  }
}

/** Bilinear sample of a plane at (x, y) in cell-centre coordinates (cell i's centre at i), or
 *  `outside` beyond the outermost centres. */
export function sampleBilinear(plane: ArrayLike<number>, w: number, h: number, x: number, y: number, outside: number): number {
  if (!(x >= 0 && y >= 0 && x <= w - 1 && y <= h - 1)) return outside;
  const x0 = Math.min(w - 2, Math.floor(x));
  const y0 = Math.min(h - 2, Math.floor(y));
  if (x0 < 0 || y0 < 0) {
    const i = Math.round(y) * w + Math.round(x);
    return plane[i]!;
  }
  const fx = x - x0;
  const fy = y - y0;
  const i = y0 * w + x0;
  const top = plane[i]! + (plane[i + 1]! - plane[i]!) * fx;
  const bottom = plane[i + w]! + (plane[i + w + 1]! - plane[i + w]!) * fx;
  return top + (bottom - top) * fy;
}

/** Linear-interpolated quantile (q in [0, 1]) of the values; NaN when there are none. */
export function quantile(values: Float64Array | Float32Array | number[], q: number): number {
  const v = Float64Array.from(values).sort();
  if (v.length === 0) return Number.NaN;
  const t = q * (v.length - 1);
  const i = Math.floor(t);
  return i + 1 < v.length ? v[i]! + (v[i + 1]! - v[i]!) * (t - i) : v[i]!;
}
