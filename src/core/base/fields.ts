/*
 * Distance and blur fields over a cell mask: the measure procedural rims, glows and insets and the
 * video import's shore distances are read from.
 */

/** Exact squared euclidean distance transform, one axis (Felzenszwalb and Huttenlocher). Linear. */
function edt1d(f: Float64Array, n: number): Float64Array {
  const d = new Float64Array(n);
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);
  let k = 0;
  v[0] = 0;
  z[0] = -Infinity;
  z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s = (f[q]! + q * q - (f[v[k]!]! + v[k]! * v[k]!)) / (2 * q - 2 * v[k]!);
    while (s <= z[k]!) {
      k--;
      s = (f[q]! + q * q - (f[v[k]!]! + v[k]! * v[k]!)) / (2 * q - 2 * v[k]!);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1]! < q) k++;
    d[q] = (q - v[k]!) * (q - v[k]!) + f[v[k]!]!;
  }
  return d;
}

/** Distance in cells from every cell to the nearest set cell. Exact, not an approximation: an
 *  approximate field shows its own kernel as a ripple wherever a pack uses it for a rim. */
export function distanceField(mask: Uint8Array, w: number, h: number): Float32Array {
  const out = new Float64Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = mask[i] === 1 ? 0 : 1e20;
  const col = new Float64Array(h);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) col[y] = out[y * w + x]!;
    const d = edt1d(col, h);
    for (let y = 0; y < h; y++) out[y * w + x] = d[y]!;
  }
  const row = new Float64Array(w);
  const res = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) row[x] = out[y * w + x]!;
    const d = edt1d(row, w);
    for (let x = 0; x < w; x++) res[y * w + x] = Math.sqrt(d[x]!);
  }
  return res;
}

/** Negative inside the mask, positive outside. Rims, glows, coastal echoes and band inset all read
 *  this one field rather than each offsetting a polyline, which self-intersects in a concave bay. */
export function signedDistanceField(mask: Uint8Array, w: number, h: number): Float32Array {
  const inverted = new Uint8Array(w * h);
  for (let i = 0; i < mask.length; i++) inverted[i] = mask[i] === 1 ? 0 : 1;
  const outside = distanceField(mask, w, h);
  const insideD = distanceField(inverted, w, h);
  const out = new Float32Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = mask[i] === 1 ? -insideD[i]! : outside[i]!;
  return out;
}

/** Separable box blur of window `2 * radius + 1`, edges clamped, run `passes` times; three or more
 *  passes read as a Gaussian. Each window is summed afresh from its first tap, so a result does not
 *  depend on the order neighbouring windows were computed in. Hand-rolled because `ctx.filter` is
 *  unreliable on the platforms this must serve, and field work happens off-canvas. */
export function blurField(src: ArrayLike<number>, w: number, h: number, radius: number, passes: number): Float32Array {
  const r = Math.max(1, Math.round(radius));
  const size = 2 * r + 1;
  const a = Float32Array.from(src as number[]);
  const b = new Float32Array(w * h);
  for (let pass = 0; pass < passes; pass++) {
    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let x = 0; x < w; x++) {
        let sum = a[row + Math.max(0, x - r)]!;
        for (let j = 1 - r; j <= r; j++) sum += a[row + Math.min(w - 1, Math.max(0, x + j))]!;
        b[row + x] = sum / size;
      }
    }
    for (let x = 0; x < w; x++) {
      for (let y = 0; y < h; y++) {
        let sum = b[Math.max(0, y - r) * w + x]!;
        for (let j = 1 - r; j <= r; j++) sum += b[Math.min(h - 1, Math.max(0, y + j)) * w + x]!;
        a[y * w + x] = sum / size;
      }
    }
  }
  return a;
}

/** A normalised Gaussian kernel of `sigma` samples, cut at `truncate` sigmas (at least one sample
 *  each side), length `2 * radius + 1`. */
export function gaussianKernel(sigma: number, truncate: number): Float64Array {
  const r = Math.max(1, Math.ceil(truncate * sigma));
  const k = new Float64Array(2 * r + 1);
  let sum = 0;
  for (let i = -r; i <= r; i++) sum += k[i + r] = Math.exp(-(i * i) / (2 * sigma * sigma));
  for (let i = 0; i < k.length; i++) k[i]! /= sum;
  return k;
}
