import { Fft2d } from '../../../pipelines/planet-scan/track/fft';
import { CALIBRATED_WINDOW } from '../../../pipelines/planet-scan/frame/framing';
import { CALIBRATED_LAYOUT, placeProbe, type HudLayout } from '../../../pipelines/planet-scan/frame/hud';
import { SCAN_PROFILE } from '../../../pipelines/planet-scan/profile';
import type { GreyImage, PixelRect } from '../../../pipelines/planet-scan/types';

// Synthetic ground for the scan pipeline's tests.

export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A view of a field: the field shifted by (dx, dy), cropped to `width` by `height` from its
 *  top-left corner, plus uniform noise of amplitude `noise`. A crop larger than the field repeats
 *  it, which makes a periodic texture. */
export type FieldView = (dx: number, dy: number, size: { width: number; height: number }, noise?: number, noiseSeed?: number) => GreyImage;

/**
 * A periodic random field with a natural-image spectrum (amplitude falling as 1/f, nothing at
 * Nyquist) and an RMS of 20 grey levels. Views shift it by any real amount exactly through a
 * Fourier phase ramp, so content enters and leaves at the crop's edges as it does on screen.
 */
export function broadbandField(seed: number, fieldWidth = 512, fieldHeight = 256): FieldView {
  const n = fieldWidth * fieldHeight;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  const r = rng(seed);
  for (let i = 0; i < n; i++) re[i] = r() * 2 - 1;
  const fft = new Fft2d(fieldWidth, fieldHeight);
  fft.forward(re, im);
  const freqX = (kx: number) => (kx < fieldWidth / 2 ? kx : kx - fieldWidth) / fieldWidth;
  const freqY = (ky: number) => (ky < fieldHeight / 2 ? ky : ky - fieldHeight) / fieldHeight;
  for (let ky = 0; ky < fieldHeight; ky++) {
    for (let kx = 0; kx < fieldWidth; kx++) {
      const nyquist = kx === fieldWidth / 2 || ky === fieldHeight / 2;
      const gain = nyquist ? 0 : 1 / (Math.hypot(freqX(kx), freqY(ky)) + 0.02);
      re[ky * fieldWidth + kx]! *= gain;
      im[ky * fieldWidth + kx]! *= gain;
    }
  }
  const vRe = new Float64Array(n);
  const vIm = new Float64Array(n);
  return (dx, dy, { width, height }, noise = 0, noiseSeed = 1) => {
    for (let ky = 0; ky < fieldHeight; ky++) {
      const fy = freqY(ky);
      for (let kx = 0; kx < fieldWidth; kx++) {
        const t = -2 * Math.PI * (freqX(kx) * dx + fy * dy);
        const c = Math.cos(t);
        const s = Math.sin(t);
        const k = ky * fieldWidth + kx;
        vRe[k] = re[k]! * c - im[k]! * s;
        vIm[k] = re[k]! * s + im[k]! * c;
      }
    }
    fft.inverse(vRe, vIm);
    let sumSq = 0;
    for (let i = 0; i < n; i++) sumSq += vRe[i]! * vRe[i]!;
    const scale = 20 / Math.sqrt(sumSq / n);
    const nr = rng(noiseSeed);
    const out = new Float32Array(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        out[y * width + x] = vRe[(y % fieldHeight) * fieldWidth + (x % fieldWidth)]! * scale + (noise > 0 ? (nr() * 2 - 1) * noise : 0);
      }
    }
    return { width, height, data: out };
  };
}

/** A `width` by `height` window of `field` with its origin at real (x, y), bilinearly sampled,
 *  plus uniform noise of amplitude `noise`. The window must lie inside the field. */
export function cropAt(field: GreyImage, at: { x: number; y: number }, size: { width: number; height: number }, noise = 0, noiseSeed = 1): GreyImage {
  const { x, y } = at;
  const { width, height } = size;
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  if (ix < 0 || iy < 0 || ix + width + 1 > field.width || iy + height + 1 > field.height) throw new Error('crop leaves the field');
  const f = field.data;
  const fw = field.width;
  const nr = rng(noiseSeed);
  const out = new Float32Array(width * height);
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      const i = (iy + r) * fw + ix + c;
      const top = f[i]! + (f[i + 1]! - f[i]!) * fx;
      const bottom = f[i + fw]! + (f[i + fw + 1]! - f[i + fw]!) * fx;
      out[r * width + c] = top + (bottom - top) * fy + (noise > 0 ? (nr() * 2 - 1) * noise : 0);
    }
  }
  return { width, height, data: out };
}

/**
 * A serpentine raster scan like the recording protocol: rows swept left and right in quanta of
 * `quantum` pixels, one to three quanta per frame, with small jitter on both axes, and rows
 * `rowStep` apart reached in vertical quanta. Positions start at (x0, y0) and stay within
 * [x0, x1] by [y0, y1].
 */
export function rasterPath(
  seed: number,
  bounds: { x0: number; x1: number; y0: number; y1: number },
  quantum: { x: number; y: number },
  rowStep: number,
): { x: number[]; y: number[] } {
  const r = rng(seed);
  const xs: number[] = [];
  const ys: number[] = [];
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  const jitter = () => (r() * 2 - 1) * 0.3;
  let x = bounds.x0;
  let y = bounds.y0;
  let dir = 1;
  for (;;) {
    xs.push(x);
    ys.push(y);
    const next = x + dir * quantum.x * (1 + Math.floor(r() * 3)) + jitter();
    if (next >= bounds.x0 && next <= bounds.x1) {
      x = next;
      y = clamp(y + jitter() * 0.5, bounds.y0, bounds.y1);
      continue;
    }
    const target = y + rowStep;
    if (target > bounds.y1) break;
    while (y < target - 1) {
      y = clamp(Math.min(target, y + quantum.y * (1 + Math.floor(r() * 2))) + jitter() * 0.5, bounds.y0, bounds.y1);
      x = clamp(x + jitter(), bounds.x0, bounds.x1);
      if (y < target - 1) {
        xs.push(x);
        ys.push(y);
      }
    }
    dir = -dir;
  }
  return { x: xs, y: ys };
}

/** Distance from `v` to the nearest line of the lattice `origin + n * period`. */
export function toLine(v: number, origin: number, period: number): number {
  const d = (((v - origin) % period) + period) % period;
  return d > period / 2 ? d - period : d;
}

/** The temporal deviation of a still run whose tile origin sits at (x, y) in scan coordinates:
 *  sensor noise, animated lines of the lattice at `origin`, and blobs of animated foam. */
export function latticeDeviation(x: number, y: number, origin: { x: number; y: number }, seed: number): GreyImage {
  const { width: W, height: H } = SCAN_PROFILE.tile;
  const PX = SCAN_PROFILE.chunk.width;
  const PY = SCAN_PROFILE.chunk.height;
  const r = rng(seed);
  const amp = 2 + 2 * r();
  const data = new Float32Array(W * H);
  const lineX = new Float32Array(W);
  const lineY = new Float32Array(H);
  for (let c = 0; c < W; c++) lineX[c] = amp * Math.exp(-(toLine(x + c, origin.x, PX) ** 2) / (2 * 0.8 ** 2));
  for (let row = 0; row < H; row++) lineY[row] = amp * 0.7 * Math.exp(-(toLine(y + row, origin.y, PY) ** 2) / (2 * 0.8 ** 2));
  for (let row = 0; row < H; row++) {
    for (let c = 0; c < W; c++) data[row * W + c] = Math.max(lineX[c]!, lineY[row]!) + 0.4 * r();
  }
  for (let b = 0; b < 4; b++) {
    const bx = r() * W;
    const by = r() * H;
    for (let row = Math.max(0, Math.floor(by - 20)); row < Math.min(H, by + 20); row++) {
      for (let c = Math.max(0, Math.floor(bx - 20)); c < Math.min(W, bx + 20); c++) {
        data[row * W + c]! += 5 * Math.exp(-((c - bx) ** 2 + (row - by) ** 2) / (2 * 8 ** 2)) * r();
      }
    }
  }
  return { width: W, height: H, data };
}

// Decoded frames at the scan's frame size.

const { width: FW, height: FH } = SCAN_PROFILE.frame;
const HUD = SCAN_PROFILE.hud;

export function plainFrame(fill: readonly number[] = [90, 140, 60]): Uint8ClampedArray {
  const data = new Uint8ClampedArray(FW * FH * 4);
  for (let i = 0; i < FW * FH; i++) data.set([fill[0]!, fill[1]!, fill[2]!, 255], i * 4);
  return data;
}

export function paintRect(data: Uint8ClampedArray, r: PixelRect, colour: readonly number[]): void {
  for (let y = r.y0; y < r.y1; y++) for (let x = r.x0; x < r.x1; x++) data.set([colour[0]!, colour[1]!, colour[2]!], (y * FW + x) * 4);
}

/** Paints columns [x0, x1) of rows [y0, y1) in `colour`, a column cut by a fractional end blended
 *  by the share of it covered, as a scaler draws a picture edge between pixels. */
function paintSpan(data: Uint8ClampedArray, span: { x0: number; x1: number; y0: number; y1: number }, colour: readonly number[]): void {
  const { x0, x1, y0, y1 } = span;
  for (let x = Math.max(0, Math.floor(x0)); x < Math.min(FW, Math.ceil(x1)); x++) {
    const share = Math.min(x + 1, x1) - Math.max(x, x0);
    for (let y = y0; y < y1; y++) {
      const i = (y * FW + x) * 4;
      for (let c = 0; c < 3; c++) data[i + c] = Math.round(colour[c]! * share + data[i + c]! * (1 - share));
    }
  }
}

/** A plain frame holding a game window of columns [x0, x1) and rows [y0, y1) between black bars;
 *  a fractional side edge blends its column. */
export function windowFrame(x0: number, x1: number, fill?: readonly number[], y0 = 0, y1 = FH): Uint8ClampedArray {
  const data = plainFrame(fill);
  paintSpan(data, { x0: 0, x1: x0, y0: 0, y1: FH }, [0, 0, 0]);
  paintSpan(data, { x0: x1, x1: FW, y0: 0, y1: FH }, [0, 0, 0]);
  paintRect(data, { x0: 0, x1: FW, y0: 0, y1: Math.round(y0) }, [0, 0, 0]);
  paintRect(data, { x0: 0, x1: FW, y0: Math.round(y1), y1: FH }, [0, 0, 0]);
  return data;
}

/** A frame with the structures of the map view's HUD drawn in their measured colours, the zoom knob
 *  centred on `knob` (a row of the calibrated layout), laid out as `layout` inside the game window
 *  `window` between black bars (the calibrated layout and window by default). */
export function hudFrame(
  knob: number = HUD.zoom.knobCentre, skip: 'bar' | 'discs' | 'zoom' | null = null,
  layout: HudLayout = CALIBRATED_LAYOUT, window: PixelRect = CALIBRATED_WINDOW,
): Uint8ClampedArray {
  const data = windowFrame(window.x0, window.x1, undefined, window.y0, window.y1);
  if (skip !== 'bar') {
    // The bar spans the HUD's width at the probe's rows.
    const rows = placeProbe(HUD.bar.region, HUD.bar.anchor, layout);
    paintSpan(data, { x0: layout.left, x1: layout.right, y0: rows.y0, y1: rows.y1 }, HUD.barColor);
  }
  if (skip !== 'discs') for (const r of HUD.discs.regions) paintRect(data, placeProbe(r.rect, r.anchor, layout), HUD.discs.color);
  if (skip !== 'zoom') {
    const Z = HUD.zoom;
    paintRect(data, placeProbe(Z, Z.anchor, layout), HUD.barColor);
    const C = CALIBRATED_LAYOUT;
    // The knob's rows in `layout`, about its middle row as the zoom column scales.
    const mid = (layout.top + layout.bottom) / 2;
    const at = mid + (knob - (C.top + C.bottom) / 2) * layout.scale;
    // At the calibrated zoom, the maximum, the knob's colour fills the track from its top; at any
    // other zoom the knob is 22 rows tall.
    const half = (knob === Z.knobCentre ? Z.knobCentre - Z.y0 : 11) * layout.scale;
    const x = placeProbe(Z, Z.anchor, layout);
    paintRect(data, { x0: x.x0, x1: x.x1, y0: Math.round(at - half), y1: Math.round(at + half) }, Z.knobColor);
  }
  return data;
}
