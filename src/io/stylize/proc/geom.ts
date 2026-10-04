/*
 * Distance and blur fields over a cell mask, the shared measure packs read rims, glows
 * and insets from.
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

/** Separable box blur run three times, which reads as a Gaussian. Hand-rolled because `ctx.filter`
 *  is unreliable on the platforms this must serve, and a pack's field work happens off-canvas. */
export function blurField(src: ArrayLike<number>, w: number, h: number, radius: number): Float32Array {
  const r = Math.max(1, Math.round(radius));
  let a = Float32Array.from(src as number[]);
  const b = new Float32Array(w * h);
  const clampi = (v: number, hi: number): number => (v < 0 ? 0 : v > hi ? hi : v);
  for (let pass = 0; pass < 3; pass++) {
    for (let y = 0; y < h; y++) {
      let sum = 0;
      for (let x = -r; x <= r; x++) sum += a[y * w + clampi(x, w - 1)]!;
      for (let x = 0; x < w; x++) {
        b[y * w + x] = sum / (2 * r + 1);
        sum += a[y * w + clampi(x + r + 1, w - 1)]! - a[y * w + clampi(x - r, w - 1)]!;
      }
    }
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let y = -r; y <= r; y++) sum += b[clampi(y, h - 1) * w + x]!;
      for (let y = 0; y < h; y++) {
        a[y * w + x] = sum / (2 * r + 1);
        sum += b[clampi(y + r + 1, h - 1) * w + x]! - b[clampi(y - r, h - 1) * w + x]!;
      }
    }
  }
  return a;
}
