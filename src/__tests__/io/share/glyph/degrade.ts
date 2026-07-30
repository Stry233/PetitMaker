// Shared degradation models for the PetitGlyph robustness harness (NOT a test file — no test
// blocks, so vitest won't run it). Each transform takes an RGBA buffer (+ dims) and returns a
// new RGBA buffer the same size, simulating a realistic capture/repost pipeline.

export function clone(g: Uint8Array): Uint8Array { return new Uint8Array(g); }
export function clamp(v: number): number { return v < 0 ? 0 : v > 255 ? 255 : v; }
export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 0xffffffff; };
}

export function colorShift(rgba: Uint8Array, dr: number, dg: number, db: number): Uint8Array {
  const o = clone(rgba);
  for (let i = 0; i < o.length; i += 4) { o[i] = clamp(o[i]! + dr); o[i + 1] = clamp(o[i + 1]! + dg); o[i + 2] = clamp(o[i + 2]! + db); }
  return o;
}

export function noise(rgba: Uint8Array, amp: number, seed: number): Uint8Array {
  const o = clone(rgba); const r = rng(seed);
  for (let i = 0; i < o.length; i += 4) { const n = ((r() - 0.5) * 2 * amp) | 0; o[i] = clamp(o[i]! + n); o[i + 1] = clamp(o[i + 1]! + n); o[i + 2] = clamp(o[i + 2]! + n); }
  return o;
}

/** Separable convolution with a 3×3 kernel (weights need not sum to 1; normalized per pixel). */
export function blurKernel(rgba: Uint8Array, w: number, h: number, K: number[][]): Uint8Array {
  const out = new Uint8Array(rgba.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < 3; c++) {
    let sum = 0, n = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx >= 0 && xx < w && yy >= 0 && yy < h) { const wt = K[dy + 1]![dx + 1]!; sum += rgba[(yy * w + xx) * 4 + c]! * wt; n += wt; }
    }
    out[(y * w + x) * 4 + c] = (sum / n) | 0;
  }
  for (let i = 0; i < w * h; i++) out[i * 4 + 3] = 255;
  return out;
}
// σ≈0.5 (gentle) and σ≈0.85 (standard) Gaussians.
export const gaussSmall = (rgba: Uint8Array, w: number, h: number) => blurKernel(rgba, w, h, [[1, 1, 1], [1, 2, 1], [1, 1, 1]]);
export const gaussStd = (rgba: Uint8Array, w: number, h: number) => blurKernel(rgba, w, h, [[1, 2, 1], [2, 4, 2], [1, 2, 1]]);

/** Bilinear resample to an arbitrary size. */
export function resizeBilinear(rgba: Uint8Array, w: number, h: number, nw: number, nh: number): Uint8Array {
  const out = new Uint8Array(nw * nh * 4);
  const sx = w / nw, sy = h / nh;
  for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) {
    const fx = (x + 0.5) * sx - 0.5, fy = (y + 0.5) * sy - 0.5;
    const x0 = Math.max(0, Math.min(w - 1, Math.floor(fx))), y0 = Math.max(0, Math.min(h - 1, Math.floor(fy)));
    const x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1);
    const tx = fx - Math.floor(fx), ty = fy - Math.floor(fy);
    for (let c = 0; c < 4; c++) {
      const a = rgba[(y0 * w + x0) * 4 + c]!, b = rgba[(y0 * w + x1) * 4 + c]!;
      const cc = rgba[(y1 * w + x0) * 4 + c]!, d = rgba[(y1 * w + x1) * 4 + c]!;
      const top = a + (b - a) * tx, bot = cc + (d - cc) * tx;
      out[(y * nw + x) * 4 + c] = (top + (bot - top) * ty) | 0;
    }
  }
  for (let i = 0; i < nw * nh; i++) out[i * 4 + 3] = 255;
  return out;
}
/** Platform-style "resize then restore": downscale by `factor` (e.g. 0.75) then back up to full. */
export function downUp(rgba: Uint8Array, w: number, h: number, factor: number): Uint8Array {
  const dw = Math.max(1, Math.round(w * factor)), dh = Math.max(1, Math.round(h * factor));
  const small = resizeBilinear(rgba, w, h, dw, dh);
  return resizeBilinear(small, dw, dh, w, h);
}

// ── JPEG-like compression: per 8×8 block DCT-II → quantize (scaled luma table) → inverse. ──
const QBASE = [
  16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55,
  14, 13, 16, 24, 40, 57, 69, 56, 14, 17, 22, 29, 51, 87, 80, 62,
  18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113, 92,
  49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99,
];
const COS: number[] = (() => { const c = new Array(64); for (let u = 0; u < 8; u++) for (let x = 0; x < 8; x++) c[u * 8 + x] = Math.cos(((2 * x + 1) * u * Math.PI) / 16); return c; })();
const CU = (u: number) => (u === 0 ? Math.SQRT1_2 : 1);

function quantTable(quality: number): number[] {
  const S = quality < 50 ? 5000 / quality : 200 - 2 * quality;
  return QBASE.map((b) => Math.max(1, Math.min(255, Math.floor((b * S + 50) / 100))));
}
function dct8x8(block: Float64Array): Float64Array {
  const tmp = new Float64Array(64), out = new Float64Array(64);
  for (let y = 0; y < 8; y++) for (let u = 0; u < 8; u++) { let s = 0; for (let x = 0; x < 8; x++) s += block[y * 8 + x]! * COS[u * 8 + x]!; tmp[y * 8 + u] = 0.5 * CU(u) * s; }
  for (let u = 0; u < 8; u++) for (let v = 0; v < 8; v++) { let s = 0; for (let y = 0; y < 8; y++) s += tmp[y * 8 + u]! * COS[v * 8 + y]!; out[v * 8 + u] = 0.5 * CU(v) * s; }
  return out;
}
function idct8x8(coef: Float64Array): Float64Array {
  const tmp = new Float64Array(64), out = new Float64Array(64);
  for (let v = 0; v < 8; v++) for (let x = 0; x < 8; x++) { let s = 0; for (let u = 0; u < 8; u++) s += CU(u) * coef[v * 8 + u]! * COS[u * 8 + x]!; tmp[v * 8 + x] = 0.5 * s; }
  for (let x = 0; x < 8; x++) for (let y = 0; y < 8; y++) { let s = 0; for (let v = 0; v < 8; v++) s += CU(v) * tmp[v * 8 + x]! * COS[v * 8 + y]!; out[y * 8 + x] = 0.5 * s; }
  return out;
}
export function jpegLike(rgba: Uint8Array, w: number, h: number, quality = 75): Uint8Array {
  const q = quantTable(quality);
  const out = clone(rgba);
  const block = new Float64Array(64);
  for (let by = 0; by < h; by += 8) for (let bx = 0; bx < w; bx += 8) for (let c = 0; c < 3; c++) {
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { const sx = Math.min(w - 1, bx + x), sy = Math.min(h - 1, by + y); block[y * 8 + x] = rgba[(sy * w + sx) * 4 + c]! - 128; }
    const co = dct8x8(block);
    for (let i = 0; i < 64; i++) co[i] = Math.round(co[i]! / q[i]!) * q[i]!;
    const rec = idct8x8(co);
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { const sx = bx + x, sy = by + y; if (sx < w && sy < h) out[(sy * w + sx) * 4 + c] = clamp(Math.round(rec[y * 8 + x]! + 128)); }
  }
  return out;
}

export function eraseCells(rgba: Uint8Array, w: number, cols: number, rows: number, m: number, fraction: number, seed: number, bg: readonly number[]): Uint8Array {
  const o = clone(rgba); const r = rng(seed);
  for (let cell = 0; cell < cols * rows; cell++) {
    if (r() < fraction) {
      const cx = (cell % cols) * m, cy = Math.floor(cell / cols) * m;
      for (let y = 0; y < m; y++) for (let x = 0; x < m; x++) { const i = ((cy + y) * w + (cx + x)) * 4; o[i] = bg[0]!; o[i + 1] = bg[1]!; o[i + 2] = bg[2]!; o[i + 3] = 255; }
    }
  }
  return o;
}

/** Chroma 4:2:0 subsampling: convert to YCbCr (BT.601, 128-centered chroma), average Cb/Cr over
 *  each 2×2 block (odd edges clamp to the available pixels), then convert back — keeps per-pixel
 *  luma but destroys chroma detail below 2×2, exactly like a JPEG/H.264 4:2:0 encode. Same-size
 *  RGBA output, alpha forced to 255. Pure. */
export function chromaSubsample420(rgba: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(rgba.length);
  const n = w * h;
  const Y = new Float64Array(n), Cb = new Float64Array(n), Cr = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const r = rgba[i * 4]!, g = rgba[i * 4 + 1]!, b = rgba[i * 4 + 2]!;
    const y = 0.299 * r + 0.587 * g + 0.114 * b;
    Y[i] = y; Cb[i] = (b - y) * 0.564 + 128; Cr[i] = (r - y) * 0.713 + 128;
  }
  for (let by = 0; by < h; by += 2) for (let bx = 0; bx < w; bx += 2) {
    let sumCb = 0, sumCr = 0, cnt = 0;
    const idxs: number[] = [];
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
      const x = bx + dx, y = by + dy;
      if (x < w && y < h) { const idx = y * w + x; sumCb += Cb[idx]!; sumCr += Cr[idx]!; cnt++; idxs.push(idx); }
    }
    const acb = sumCb / cnt, acr = sumCr / cnt;
    for (const idx of idxs) {
      const y = Y[idx]!;
      out[idx * 4] = clamp(Math.round(y + 1.403 * (acr - 128)));
      out[idx * 4 + 1] = clamp(Math.round(y - 0.344 * (acb - 128) - 0.714 * (acr - 128)));
      out[idx * 4 + 2] = clamp(Math.round(y + 1.773 * (acb - 128)));
      out[idx * 4 + 3] = 255;
    }
  }
  return out;
}

export function randomImage(len: number, seed: number): Uint8Array {
  const r = rng(seed); const rand = new Uint8Array(len);
  for (let i = 0; i < len; i += 4) { rand[i] = (r() * 256) | 0; rand[i + 1] = (r() * 256) | 0; rand[i + 2] = (r() * 256) | 0; rand[i + 3] = 255; }
  return rand;
}
