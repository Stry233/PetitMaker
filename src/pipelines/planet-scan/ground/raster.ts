// Row-major raster operations of the ground reader: binary masks (1 set, 0 clear) and float
// planes. Morphology treats everything outside the raster as clear, so an erosion clears the
// border; components are 4-connected unless `eight` is set; hole filling floods the clear cells
// 4-connected from the border.
import { gaussianKernel } from '../../../core/base/fields';
import { floodFrom, labelComponents, stepDistance } from '../../../core/grid/cell-sets';

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

/** The largest 4-connected component; the first in raster order among equals. Empty stays empty. */
export function largestComponent(mask: Uint8Array, w: number, h: number): Uint8Array {
  const { labels, sizes } = labelComponents(mask, w, h);
  let best = 0;
  for (let i = 1; i < sizes.length; i++) if (sizes[i]! > (sizes[best] ?? 0)) best = i;
  const out = new Uint8Array(w * h);
  if (best > 0) for (let i = 0; i < out.length; i++) out[i] = labels[i] === best ? 1 : 0;
  return out;
}

/** The components of `mask` that hold a cell of `seeds`. */
export function componentsTouching(mask: Uint8Array, seeds: Uint8Array, w: number, h: number, eight: boolean): Uint8Array {
  const { labels, sizes } = labelComponents(mask, w, h, eight);
  const keep = new Uint8Array(sizes.length);
  for (let i = 0; i < labels.length; i++) if (seeds[i] && labels[i]) keep[labels[i]!] = 1;
  const out = new Uint8Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = keep[labels[i]!] ? 1 : 0;
  return out;
}

/** The mask with every clear region that does not reach the border set. */
export function fillHoles(mask: Uint8Array, w: number, h: number): Uint8Array {
  const border: number[] = [];
  for (let x = 0; x < w; x++) border.push(x, (h - 1) * w + x);
  for (let y = 0; y < h; y++) border.push(y * w, y * w + w - 1);
  const outside = floodFrom(border.filter((i) => !mask[i]), (i) => !mask[i], w, h);
  const out = new Uint8Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = outside[i] ? 0 : 1;
  return out;
}

/** Chessboard distance of every set cell to the nearest clear cell (0 on clear cells), by
 *  `stepDistance`; cells with no clear cell in the raster get its far value, above any distance an
 *  evidence grid of `SCAN_PROFILE.evidence.maxChunks` chunks can hold. */
export function chessboardDistance(mask: Uint8Array, w: number, h: number): Int16Array {
  const clear: number[] = [];
  for (let i = 0; i < w * h; i++) if (!mask[i]) clear.push(i);
  return stepDistance(clear, w, h, true);
}

/** Index `i` reflected into `[0, n)` about the end samples (`-1` to `1`, `n` to `n - 2`). */
export function reflectIndex(i: number, n: number): number {
  if (n === 1) return 0;
  while (i < 0 || i >= n) i = i < 0 ? -i : 2 * (n - 1) - i;
  return i;
}

/** Gaussian blur of one sigma in both axes, kernel cut at `truncate` sigmas, border reflected;
 *  written into `out`, as long as the image and not its data, when one is given. */
export function gaussianBlur(
  image: { readonly data: Float32Array; readonly width: number; readonly height: number },
  sigma: number, truncate: number, out: Float32Array = new Float32Array(image.data.length),
): Float32Array {
  const { width: w, height: h } = image;
  out.set(image.data);
  const k = gaussianKernel(sigma, truncate);
  convolve(out, w, h, k, true);
  convolve(out, w, h, k, false);
  return out;
}

/**
 * Gaussian blur with sigmas in raster cells per axis. With `weight`, the blur is normalised by the
 * blurred weight, so cells of weight 0 neither contribute nor drag their neighbours toward 0; those
 * cells keep their own value. Without it, the border reflects.
 */
export function blur(src: Float32Array, size: { w: number; h: number }, sigma: { sx: number; sy: number }, weight?: Float32Array): Float32Array {
  const { w, h } = size;
  const { sx, sy } = sigma;
  const num = new Float32Array(w * h);
  const den = weight ? new Float32Array(w * h) : null;
  for (let i = 0; i < num.length; i++) {
    const wt = weight ? weight[i]! : 1;
    num[i] = src[i]! * wt;
    if (den) den[i] = wt;
  }
  const run = (plane: Float32Array) => {
    convolve(plane, w, h, gaussianKernel(sx, 3), true);
    convolve(plane, w, h, gaussianKernel(sy, 3), false);
  };
  run(num);
  if (!den) return num;
  run(den);
  const out = new Float32Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = den[i]! > 1e-6 && weight![i]! > 0 ? num[i]! / den[i]! : src[i]!;
  return out;
}

/** Correlates every row (or column) of `plane` in place with the centred kernel `k`, edges reflected. */
export function convolve(plane: Float32Array, w: number, h: number, k: Float64Array, alongRows: boolean): void {
  const r = (k.length - 1) / 2;
  const n = alongRows ? w : h;
  const lines = alongRows ? h : w;
  const line = new Float64Array(n);
  for (let l = 0; l < lines; l++) {
    const at = (i: number) => (alongRows ? l * w + i : i * w + l);
    for (let i = 0; i < n; i++) line[i] = plane[at(i)]!;
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (let t = -r; t <= r; t++) s += k[t + r]! * line[reflectIndex(i + t, n)]!;
      plane[at(i)] = s;
    }
  }
}

/** Bilinear sample of a plane at (x, y) in cell-centre coordinates (cell i's centre at i), or
 *  `outside` beyond the outermost centres. */
export function sampleBilinear(
  image: { data: ArrayLike<number>; width: number; height: number }, x: number, y: number, outside: number,
): number {
  const { data: plane, width: w, height: h } = image;
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
