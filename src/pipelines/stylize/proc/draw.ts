/*
 * The Canvas2D kit every pack draws through.
 *
 * Thin on purpose. The suite runs on jsdom with no 2D context, so nothing decidable may live here:
 * every judgement (which cells, which colour, which value) belongs in the pure modules beside this
 * one, and this file only puts the result on a surface.
 *
 * Two rules bind every pack:
 *  - No `ctx.filter`. Safari keeps it behind a preference and OffscreenCanvas does not have it at
 *    all, so a pack that reached for it would silently render unstyled on a third of machines.
 *  - Every mark carries a floor in output pixels. The same pack draws at roughly 8, 13 and 22 px
 *    per cell; a mark sized only in cells becomes noise at the small end. Below its floor a mark is
 *    dropped or replaced by a simpler one, never drawn smaller.
 */
import { makeNoise } from './noise';

/** Where the band sits, in cells. `pxPerCell` is the only bridge to output pixels. */
export interface ProcView {
  pxPerCell: number;
  x0: number;
  y0: number;
  cellsW: number;
  cellsH: number;
}

export const viewWidth = (v: ProcView): number => v.cellsW * v.pxPerCell;
export const viewHeight = (v: ProcView): number => v.cellsH * v.pxPerCell;

/** A page inset inside the band: the pack composes a sheet rather than filling the rectangle, and
 *  everything it lays out reads through the returned transform. */
export interface SheetView {
  px: number;
  T: (x: number, y: number) => [number, number];
  W: number;
  H: number;
  ox: number;
  oy: number;
  mw: number;
  mh: number;
}
export function sheetView(
  v: ProcView, m: { left?: number; top?: number; right?: number; bottom?: number } = {},
): SheetView {
  const W = viewWidth(v);
  const H = viewHeight(v);
  const iw = W * (1 - (m.left ?? 0.05) - (m.right ?? 0.05));
  const ih = H * (1 - (m.top ?? 0.05) - (m.bottom ?? 0.05));
  const px = Math.min(iw / v.cellsW, ih / v.cellsH);
  const ox = W * (m.left ?? 0.05) + (iw - v.cellsW * px) / 2;
  const oy = H * (m.top ?? 0.05) + (ih - v.cellsH * px) / 2;
  return { px, T: (x, y) => [(x - v.x0) * px + ox, (y - v.y0) * px + oy], W, H, ox, oy, mw: v.cellsW * px, mh: v.cellsH * px };
}

/** Paper, applied through Bousseau's pigment law rather than as a multiplied grain layer.
 *
 *  `C' = C(1 - (1 - C)(d - 1))` has fixed points at 0 and 1, so paper white stays white and ink
 *  stays ink while everything between takes the tooth. Multiplying a grain layer instead drags the
 *  white grey, which is the most recognisable signature of a filtered image. */
export function applySubstrate(
  ctx: CanvasRenderingContext2D, width: number, height: number,
  o: { grain: number; seed: number; vignette?: number; scale?: number },
): void {
  const w = Math.ceil(width);
  const h = Math.ceil(height);
  if (w <= 0 || h <= 0 || o.grain <= 0) return;
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const noise = makeNoise(o.seed);
  const scale = o.scale ?? 1;
  const tooth = 1 / (0.55 * scale);
  const fibre = 1 / (2.2 * scale);
  const vignette = o.vignette ?? 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const density = 1 + o.grain * (
        (noise.fbm(x * tooth, y * tooth, 2) - 0.35) * 2.4 +
        (noise.fbm(x * fibre + 40, y * fibre, 3) - 0.35) * 1.6
      );
      for (let k = 0; k < 3; k++) {
        const c = d[i + k]! / 255;
        d[i + k] = 255 * Math.max(0, Math.min(1, c * (1 - (1 - c) * (density - 1))));
      }
      if (vignette > 0) {
        const dx = (x / w - 0.5) * 2;
        const dy = (y / h - 0.5) * 2;
        const v = 1 - vignette * Math.pow(Math.hypot(dx, dy) / 1.414, 2.4);
        d[i] = d[i]! * v;
        d[i + 1] = d[i + 1]! * v;
        d[i + 2] = d[i + 2]! * v;
      }
    }
  }
  ctx.putImageData(img, 0, 0);
}
