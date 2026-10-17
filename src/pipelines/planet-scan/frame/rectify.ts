import { channelLuma } from '../../../core/base/color';
import type { GreyImage, Homography, Rectification, RgbaImage, TileSpec } from '../types';

/** The point `h` takes (x, y) to. */
function project(h: Homography, x: number, y: number): { a: number; b: number } {
  const w = h[6] * x + h[7] * y + h[8];
  return { a: (h[0] * x + h[1] * y + h[2]) / w, b: (h[3] * x + h[4] * y + h[5]) / w };
}

/** Ground point (rectified pixels from the calibration origin) to its screen pixel. */
export function groundToScreen(cal: Rectification, x: number, y: number): { u: number; v: number } {
  const p = project(cal.toScreen, x, y);
  return { u: p.a, v: p.b };
}

/** Screen pixel to its ground point (rectified pixels from the calibration origin). */
export function screenToGround(cal: Rectification, u: number, v: number): { x: number; y: number } {
  const p = project(cal.toGround, u, v);
  return { x: p.a, y: p.b };
}

/**
 * A precomputed bilinear remap from frame pixels to tile pixels. For output pixel `p`, `index[p]`
 * is the frame index of the top-left tap or -1 when the sample falls outside the frame, and
 * `fx[p]`, `fy[p]` are the fractional offsets toward the right and lower taps.
 */
export interface SampleMap {
  readonly width: number;
  readonly height: number;
  readonly frameWidth: number;
  readonly frameHeight: number;
  /** Ground pixels per output pixel. */
  readonly step: number;
  readonly index: Int32Array;
  readonly fx: Float32Array;
  readonly fy: Float32Array;
}

/** Ground point of an output pixel of a sample map built with `step` over `tile`. */
export function tileToGround(tile: TileSpec, step: number, col: number, row: number): { x: number; y: number } {
  return { x: col * step - tile.originX, y: row * step - tile.originY };
}

/**
 * Builds the remap for `tile` sampled every `step` ground pixels (1 for the full tile, 2 for half
 * resolution), with the world drawn `zoom` times its calibrated size about the frame's centre. The
 * calibration runs once per output pixel here, never per frame.
 */
export function buildSampleMap(cal: Rectification, tile: TileSpec, step = 1, zoom = 1): SampleMap {
  const width = Math.floor(tile.width / step);
  const height = Math.floor(tile.height / step);
  const fw = cal.frame.width;
  const fh = cal.frame.height;
  const index = new Int32Array(width * height);
  const fx = new Float32Array(width * height);
  const fy = new Float32Array(width * height);
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      let { u, v } = groundToScreen(cal, col * step - tile.originX, row * step - tile.originY);
      if (zoom !== 1) {
        u = fw / 2 + (u - fw / 2) * zoom;
        v = fh / 2 + (v - fh / 2) * zoom;
      }
      const p = row * width + col;
      if (u < 0 || v < 0 || u > fw - 1 || v > fh - 1) {
        index[p] = -1;
        continue;
      }
      // On the frame's last row or column the taps start one pixel earlier, so the sample takes
      // the far tap with full weight.
      const x0 = Math.min(Math.floor(u), fw - 2);
      const y0 = Math.min(Math.floor(v), fh - 2);
      index[p] = y0 * fw + x0;
      fx[p] = u - x0;
      fy[p] = v - y0;
    }
  }
  return { width, height, frameWidth: fw, frameHeight: fh, step, index, fx, fy };
}

function checkFrame(map: SampleMap, width: number, height: number): void {
  if (width !== map.frameWidth || height !== map.frameHeight) {
    throw new Error(`frame is ${width}x${height}, the sample map expects ${map.frameWidth}x${map.frameHeight}`);
  }
}

/** The frame rows [from, to) a sample map reads, its bilinear neighbours included. */
export function sampledRows(map: SampleMap): { from: number; to: number } {
  let lo = Infinity;
  let hi = -Infinity;
  for (const i of map.index) {
    if (i < 0) continue;
    if (i < lo) lo = i;
    if (i > hi) hi = i;
  }
  if (lo > hi) return { from: 0, to: 0 };
  return { from: Math.floor(lo / map.frameWidth), to: Math.floor(hi / map.frameWidth) + 2 };
}

/** ITU-R BT.601 luma of an RGBA frame, as float grey levels 0..255; only rows [from, to) are
 *  written when given. */
export function rgbaToGrey(src: RgbaImage, out = new Float32Array(src.width * src.height), rows?: { from: number; to: number }): GreyImage {
  const d = src.data;
  const start = rows ? rows.from * src.width : 0;
  const n = rows ? Math.min(rows.to, src.height) * src.width : src.width * src.height;
  for (let p = start, q = start * 4; p < n; p++, q += 4) out[p] = channelLuma(d[q]!, d[q + 1]!, d[q + 2]!);
  return { width: src.width, height: src.height, data: out };
}

/** Bilinear remap of a grey frame to the tile; samples outside the frame are 0. */
export function rectifyGrey(
  map: SampleMap,
  src: GreyImage<Float32Array | Uint8Array>,
  out = new Float32Array(map.width * map.height),
): GreyImage {
  checkFrame(map, src.width, src.height);
  const s = src.data;
  const fw = map.frameWidth;
  const { index, fx, fy } = map;
  for (let p = 0; p < index.length; p++) {
    const i = index[p]!;
    if (i < 0) {
      out[p] = 0;
      continue;
    }
    const ax = fx[p]!;
    const ay = fy[p]!;
    const top = s[i]! + (s[i + 1]! - s[i]!) * ax;
    const bottom = s[i + fw]! + (s[i + fw + 1]! - s[i + fw]!) * ax;
    out[p] = top + (bottom - top) * ay;
  }
  return { width: map.width, height: map.height, data: out };
}

/** Bilinear remap of an RGBA frame to the tile, rounded to bytes (the byte store truncates the
 *  value plus one half); samples outside the frame are transparent black. */
export function rectifyRgba(
  map: SampleMap,
  src: RgbaImage,
  out = new Uint8Array(map.width * map.height * 4),
): RgbaImage {
  checkFrame(map, src.width, src.height);
  const s = src.data;
  const row = map.frameWidth * 4;
  const { index, fx, fy } = map;
  for (let p = 0, o = 0; p < index.length; p++, o += 4) {
    const i = index[p]! * 4;
    if (i < 0) {
      out[o] = out[o + 1] = out[o + 2] = out[o + 3] = 0;
      continue;
    }
    const ax = fx[p]!;
    const ay = fy[p]!;
    const w00 = (1 - ax) * (1 - ay);
    const w01 = ax * (1 - ay);
    const w10 = (1 - ax) * ay;
    const w11 = ax * ay;
    const j = i + row;
    out[o] = w00 * s[i]! + w01 * s[i + 4]! + w10 * s[j]! + w11 * s[j + 4]! + 0.5;
    out[o + 1] = w00 * s[i + 1]! + w01 * s[i + 5]! + w10 * s[j + 1]! + w11 * s[j + 5]! + 0.5;
    out[o + 2] = w00 * s[i + 2]! + w01 * s[i + 6]! + w10 * s[j + 2]! + w11 * s[j + 6]! + 0.5;
    out[o + 3] = w00 * s[i + 3]! + w01 * s[i + 7]! + w10 * s[j + 3]! + w11 * s[j + 7]! + 0.5;
  }
  return { width: map.width, height: map.height, data: out };
}
