/**
 * Crops of a decoded picture: the window that most identifies its subject, and a rectangle as a
 * picture of its own.
 */
import { channelLuma } from '../../../core/base/color';
import type { SourcePixels } from './stencil-sample';

/** A rectangle of a source picture, in its own pixels. */
export interface SourceRect { x: number; y: number; width: number; height: number }

/**
 * The sub-rectangle of a picture that most identifies its subject, or null where it has none. Below
 * about twenty cells a whole figure is a silhouette, and a head (eyes, ears, markings) carries what a
 * viewer recognises where the body carries a colour.
 *
 * Identifying means local contrast over the subject's ink, read on a coarse grid (`CROP_GRID`) so one
 * hard pixel edge cannot name the window, in a window of the box's shape so letterboxing does not
 * eat the gain. It declines rather than guesses: the window must beat the whole subject's density by
 * `CROP_MIN_GAIN`, which an evenly detailed pattern never does.
 */
export const CROP_MAX_SIDE = 20;
const CROP_WINDOW = 0.6;
const CROP_GRID = 24;
const CROP_MIN_GAIN = 1.4;

export function salientCrop(
  src: SourcePixels, box: { width: number; height: number }, keyed: Uint8Array | null = null,
): SourceRect | null {
  const lumaAt = (x: number, y: number): number => {
    if (x < 0 || y < 0 || x >= src.width || y >= src.height) return 0;
    const i = (y * src.width + x) * 4;
    if (keyed?.[y * src.width + x] || (src.data[i + 3] ?? 0) < 128) return 0;
    return channelLuma(src.data[i]!, src.data[i + 1]!, src.data[i + 2]!);
  };
  const inked = (x: number, y: number): boolean => {
    const i = (y * src.width + x) * 4;
    return !keyed?.[y * src.width + x] && (src.data[i + 3] ?? 0) >= 128;
  };

  // The subject's own frame: a crop is a choice inside it, never a way of finding it.
  let x0 = src.width, y0 = src.height, x1 = -1, y1 = -1;
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      if (!inked(x, y)) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < x0 || y1 < y0) return null;
  const w = x1 - x0 + 1, h = y1 - y0 + 1;

  const cols = Math.min(CROP_GRID, w), rows = Math.min(CROP_GRID, h);
  const cw = w / cols, ch = h / rows;
  const detail = new Float64Array(cols * rows);
  const ink = new Float64Array(cols * rows);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (!inked(x, y)) continue;
      const at = Math.min(rows - 1, Math.floor((y - y0) / ch)) * cols + Math.min(cols - 1, Math.floor((x - x0) / cw));
      detail[at] = detail[at]! + Math.abs(lumaAt(x + 1, y) - lumaAt(x - 1, y)) + Math.abs(lumaAt(x, y + 1) - lumaAt(x, y - 1));
      ink[at] = ink[at]! + 1;
    }
  }
  let whole = 0, wholeInk = 0;
  for (let i = 0; i < detail.length; i++) { whole += detail[i]!; wholeInk += ink[i]!; }
  if (wholeInk === 0 || whole <= 0) return null;

  // A window of the box's shape, six tenths of the subject's shorter side, slid over the grid.
  const aspect = box.width / box.height;
  const side = CROP_WINDOW * Math.min(w, h);
  const ww = Math.min(w, aspect >= 1 ? side * aspect : side);
  const wh = Math.min(h, aspect >= 1 ? side : side / aspect);
  const bw = Math.max(1, Math.round(ww / cw)), bh = Math.max(1, Math.round(wh / ch));
  if (bw >= cols && bh >= rows) return null;

  let best = -1, bestAt: [number, number] = [0, 0];
  for (let r = 0; r + bh <= rows; r++) {
    for (let c = 0; c + bw <= cols; c++) {
      let sum = 0;
      for (let dr = 0; dr < bh; dr++) for (let dc = 0; dc < bw; dc++) sum += detail[(r + dr) * cols + c + dc]!;
      if (sum > best) { best = sum; bestAt = [c, r]; }
    }
  }
  if (best <= 0) return null;
  // Against the whole subject read at the same density: a picture whose detail is spread evenly has no
  // part that says more than all of it.
  const share = (bw * bh) / (cols * rows);
  if (best / whole < CROP_MIN_GAIN * share) return null;

  const [c, r] = bestAt;
  const left = Math.max(0, Math.round(x0 + c * cw)), top = Math.max(0, Math.round(y0 + r * ch));
  const right = Math.min(src.width, Math.round(x0 + (c + bw) * cw));
  const bottom = Math.min(src.height, Math.round(y0 + (r + bh) * ch));
  if (right <= left || bottom <= top) return null;
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** A rectangle of a picture as a picture of its own. `keyed` pixels come out transparent, which is
 *  how a backdrop decision made on the whole source survives into a reading of part of it. */
export function cropPixels(src: SourcePixels, rect: SourceRect, keyed: Uint8Array | null = null): SourcePixels {
  const data = new Uint8Array(rect.width * rect.height * 4);
  for (let y = 0; y < rect.height; y++) {
    for (let x = 0; x < rect.width; x++) {
      const from = ((y + rect.y) * src.width + x + rect.x) * 4, to = (y * rect.width + x) * 4;
      data[to] = src.data[from]!;
      data[to + 1] = src.data[from + 1]!;
      data[to + 2] = src.data[from + 2]!;
      data[to + 3] = keyed?.[(y + rect.y) * src.width + x + rect.x] ? 0 : src.data[from + 3]!;
    }
  }
  return { data, width: rect.width, height: rect.height };
}
