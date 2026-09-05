/*
 * geom.ts — a cell mask becomes an outline a pack can draw.
 *
 * The whole procedural path rests on this: a region is traced ONCE into rings of points, and every
 * pack then fills, strokes, insets or wobbles the same rings. Working in vector space is what makes
 * the marks that read as hand-made possible at all — a deliberate mis-registration between two
 * blocks, a boundary that waves along its own length, a rim drawn just inside a contour — none of
 * which can be reached from pixels, because a pixel does not know which region it belongs to.
 */

export type Pt = readonly [number, number];
export type Ring = Pt[];

/** Trace every boundary of a binary mask into closed rings, in CELL coordinates.
 *
 *  Rectilinear by construction: each set cell contributes the sides that face an unset neighbour,
 *  wound so an outer boundary runs one way and a hole the other. Rings therefore fill correctly
 *  under the even-odd rule with no separate hole detection. */
export function traceMask(mask: Uint8Array, w: number, h: number): Ring[] {
  const inside = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < w && y < h && mask[y * w + x] === 1;
  const key = (x: number, y: number): number => x * (h + 2) + y;
  const edges = new Map<number, Pt[]>();
  const push = (ax: number, ay: number, bx: number, by: number): void => {
    const k = key(ax, ay);
    const list = edges.get(k);
    if (list) list.push([bx, by]);
    else edges.set(k, [[bx, by]]);
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!inside(x, y)) continue;
      if (!inside(x, y - 1)) push(x, y, x + 1, y);
      if (!inside(x + 1, y)) push(x + 1, y, x + 1, y + 1);
      if (!inside(x, y + 1)) push(x + 1, y + 1, x, y + 1);
      if (!inside(x - 1, y)) push(x, y + 1, x, y);
    }
  }
  const rings: Ring[] = [];
  for (const [k0, arr] of edges) {
    while (arr.length > 0) {
      const start: Pt = [Math.floor(k0 / (h + 2)), k0 % (h + 2)];
      let cur = arr.pop()!;
      const ring: Pt[] = [start, cur];
      for (let guard = 0; guard < w * h * 4; guard++) {
        const next = edges.get(key(cur[0], cur[1]));
        if (!next || next.length === 0) break;
        cur = next.pop()!;
        if (cur[0] === start[0] && cur[1] === start[1]) break;
        ring.push(cur);
      }
      if (ring.length > 3) rings.push(ring);
    }
  }
  return rings;
}

/** Chaikin corner cutting. Two passes turn a staircase into a curve without any control points to
 *  carry, which matters because the input is always axis-aligned. */
export function chaikin(ring: Ring, iterations = 2): Ring {
  let pts = ring;
  for (let it = 0; it < iterations; it++) {
    const out: Pt[] = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i]!;
      const b = pts[(i + 1) % pts.length]!;
      out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25]);
      out.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    pts = out;
  }
  return pts;
}

/** Offset each vertex along its own normal by a noise of ARC LENGTH.
 *
 *  Correlated along the boundary, never independent per vertex: independent jitter reads as noise,
 *  a correlated wave reads as a hand. `amplitude` is in cells and the CALLER must clamp it against
 *  the output scale as well — at 13 output px per cell an unclamped half-cell wobble opens a hole
 *  the width of a path. */
export function wobble(ring: Ring, amplitude: number, wavelength: number, noise1: (t: number) => number): Ring {
  if (amplitude <= 0) return ring;
  const out: Pt[] = [];
  let s = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i]!;
    const prev = ring[(i - 1 + ring.length) % ring.length]!;
    const next = ring[(i + 1) % ring.length]!;
    const tx = next[0] - prev[0];
    const ty = next[1] - prev[1];
    const len = Math.hypot(tx, ty) || 1;
    s += Math.hypot(p[0] - prev[0], p[1] - prev[1]);
    const d = noise1(s / wavelength) * amplitude;
    out.push([p[0] + (-ty / len) * d, p[1] + (tx / len) * d]);
  }
  return out;
}

/** Signed area in cells. Negative and positive distinguish an outer ring from a hole; the absolute
 *  value is how a caller drops rings too small to draw at the current scale. */
export function ringArea(ring: Ring): number {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i]!;
    const q = ring[(i + 1) % ring.length]!;
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

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

/** Ramer-Douglas-Peucker in cell units: the polyline with every vertex that does not matter gone. */
export function rdp(points: readonly Pt[], epsilon: number): Pt[] {
  if (points.length < 3) return [...points];
  let maxDist = 0;
  let index = 0;
  const [ax, ay] = points[0]!;
  const [bx, by] = points[points.length - 1]!;
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy) || 1;
  for (let i = 1; i < points.length - 1; i++) {
    const d = Math.abs((points[i]![0] - ax) * dy - (points[i]![1] - ay) * dx) / len;
    if (d > maxDist) {
      maxDist = d;
      index = i;
    }
  }
  if (maxDist <= epsilon) return [points[0]!, points[points.length - 1]!];
  return [...rdp(points.slice(0, index + 1), epsilon).slice(0, -1), ...rdp(points.slice(index), epsilon)];
}
