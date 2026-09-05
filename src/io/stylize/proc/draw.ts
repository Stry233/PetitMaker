/*
 * draw.ts — the Canvas2D kit every pack draws through.
 *
 * Thin on purpose. The suite runs on jsdom with no 2D context, so nothing decidable may live here:
 * every judgement (which cells, which colour, which value) belongs in the pure modules beside this
 * one, and this file only puts the result on a surface.
 *
 * Two rules bind every pack:
 *  - No `ctx.filter`. Safari keeps it behind a preference and OffscreenCanvas does not have it at
 *    all, so a pack that reached for it would silently render unstyled on a third of machines.
 *  - Every mark carries a floor in OUTPUT pixels. The same pack draws at roughly 8, 13 and 22 px
 *    per cell; a mark sized only in cells becomes noise at the small end. Below its floor a mark is
 *    dropped or replaced by a simpler one, never drawn smaller.
 */
import { chaikin, traceMask, wobble, ringArea, type Ring } from './geom';
import { makeNoise, makeNoise1 } from './noise';
import { rgba } from './oklab';

/** Where the band sits, in CELLS. `pxPerCell` is the only bridge to output pixels. */
export interface ProcView {
  pxPerCell: number;
  x0: number;
  y0: number;
  cellsW: number;
  cellsH: number;
}

export const viewWidth = (v: ProcView): number => v.cellsW * v.pxPerCell;
export const viewHeight = (v: ProcView): number => v.cellsH * v.pxPerCell;

/** Cell coordinates to canvas pixels. */
export function transform(v: ProcView): (x: number, y: number) => [number, number] {
  return (x, y) => [(x - v.x0) * v.pxPerCell, (y - v.y0) * v.pxPerCell];
}

/** A sheet inset inside the band, so a pack can compose a page rather than fill the rectangle. */
export function inset(v: ProcView, margin: number): { view: ProcView; offsetX: number; offsetY: number } {
  const w = viewWidth(v);
  const h = viewHeight(v);
  const px = v.pxPerCell * (1 - margin * 2);
  return {
    view: { ...v, pxPerCell: px },
    offsetX: w * margin + (w * (1 - margin * 2) - v.cellsW * px) / 2,
    offsetY: h * margin + (h * (1 - margin * 2) - v.cellsH * px) / 2,
  };
}

export interface OutlineOptions {
  /** Chaikin passes. 0 keeps the staircase, which is right for anything machine-made. */
  smooth?: number;
  /** Wobble amplitude in CELLS. The caller must also clamp it in output px. */
  amplitude?: number;
  /** Wobble wavelength in cells. */
  wavelength?: number;
  seed?: number;
  /** Drop rings enclosing less than this many cells. */
  minArea?: number;
}

/** Trace, smooth and wobble a mask into rings ready to draw. */
export function outline(mask: Uint8Array, w: number, h: number, o: OutlineOptions = {}): Ring[] {
  const noise1 = makeNoise1(o.seed ?? 1);
  const minArea = o.minArea ?? 0.5;
  return traceMask(mask, w, h)
    .filter((r) => Math.abs(ringArea(r)) >= minArea)
    .map((r) => wobble(chaikin(r, o.smooth ?? 2), o.amplitude ?? 0, o.wavelength ?? 1.5, noise1));
}

/** Lay rings into the current path. `dx`/`dy` shift in cells, which is how a pack gets the small
 *  deliberate mis-registration that separates a laid block from a computed one. */
export function ringsPath(
  ctx: CanvasRenderingContext2D, rings: readonly Ring[], T: (x: number, y: number) => [number, number],
  dx = 0, dy = 0,
): void {
  ctx.beginPath();
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i++) {
      const [x, y] = T(ring[i]![0] + dx, ring[i]![1] + dy);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
  }
}

export function fillRings(
  ctx: CanvasRenderingContext2D, rings: readonly Ring[], T: (x: number, y: number) => [number, number],
  color: string, dx = 0, dy = 0,
): void {
  if (rings.length === 0) return;
  ctx.fillStyle = color;
  ringsPath(ctx, rings, T, dx, dy);
  ctx.fill('evenodd');
}

export function strokeRings(
  ctx: CanvasRenderingContext2D, rings: readonly Ring[], T: (x: number, y: number) => [number, number],
  color: string, widthPx: number, alpha = 1,
): void {
  if (rings.length === 0 || widthPx <= 0) return;
  ctx.strokeStyle = alpha >= 1 ? color : rgba(color, alpha);
  ctx.lineWidth = widthPx;
  ctx.lineJoin = 'round';
  ringsPath(ctx, rings, T);
  ctx.stroke();
}

/** A rim just inside a region's own edge, clipped to it so it can never bleed outward. The move
 *  that reads as pigment pooling where a brush stopped, and as a wash drying against its boundary. */
export function innerRim(
  ctx: CanvasRenderingContext2D, rings: readonly Ring[], T: (x: number, y: number) => [number, number],
  color: string, widthPx: number, alpha: number,
): void {
  if (rings.length === 0 || widthPx <= 0) return;
  ctx.save();
  ringsPath(ctx, rings, T);
  ctx.clip('evenodd');
  strokeRings(ctx, rings, T, color, widthPx * 2, alpha);
  ctx.restore();
}

/** A soft drop shadow without `ctx.filter`: the same rings filled a few times at growing offsets.
 *  A handful of passes read as a soft edge and cost that many fills rather than a blur over the
 *  whole band. Offsets arrive in OUTPUT pixels; `px` converts them into the ring's own cells. */
export function softShadowLoops(
  ctx: CanvasRenderingContext2D, rings: readonly Ring[], T: (x: number, y: number) => [number, number],
  o: { dx?: number; dy?: number; spreadPx?: number; steps?: number; alpha?: number; color?: string; px: number },
): void {
  const steps = o.steps ?? 6;
  const alpha = o.alpha ?? 0.3;
  const color = o.color ?? '#2b2621';
  const dx = (o.dx ?? 3) / o.px;
  const dy = (o.dy ?? 4) / o.px;
  const spread = (o.spreadPx ?? 5) / o.px;
  for (let i = steps; i >= 1; i--) {
    const t = i / steps;
    ctx.fillStyle = rgba(color, (alpha / steps) * (1.2 - t * 0.4));
    ringsPath(ctx, rings, T, dx * t, dy * t + spread * t * 0.2);
    ctx.fill('evenodd');
  }
}

/** A page inset inside the band: the pack composes a SHEET rather than filling the rectangle, and
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

/** A lobed blob: the shape a drawn canopy or a loaded brush touch makes, as against a circle. */
export function lobedBlob(
  ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number,
  lobes: number, phase: number, depth: number,
): void {
  const steps = lobes * 6;
  ctx.beginPath();
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2 + phase;
    const rr = r * (1 + depth * Math.sin(a * lobes));
    const x = cx + Math.cos(a) * rr;
    const y = cy + Math.sin(a) * rr * 0.94;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
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

/** Parallel rule lines clipped to a region. Sized in OUTPUT pixels, never cells: at 8 px per cell
 *  a cell-specified hatch is noise. Below a 3 px pitch the caller substitutes a wash, because a
 *  hatch that fine is a grey field that cost line work. */
export function hatchRegion(
  ctx: CanvasRenderingContext2D, rings: readonly Ring[], T: (x: number, y: number) => [number, number],
  o: {
    angleDeg?: number; spacingPx?: number; widthPx?: number; color?: string; alpha?: number;
    jitterPx?: number; seed?: number; dashPx?: number; W: number; H: number;
  },
): number {
  const spacing = o.spacingPx ?? 9;
  if (spacing < 3 || rings.length === 0) return 0;
  ctx.save();
  ringsPath(ctx, rings, T);
  ctx.clip('evenodd');
  const theta = ((o.angleDeg ?? 45) * Math.PI) / 180;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const diagonal = Math.hypot(o.W, o.H);
  const noise1 = makeNoise1(o.seed ?? 1);
  ctx.strokeStyle = rgba(o.color ?? '#333333', o.alpha ?? 0.35);
  ctx.lineWidth = o.widthPx ?? 1;
  ctx.lineCap = 'butt';
  let drawn = 0;
  ctx.beginPath();
  for (let d = -diagonal; d < diagonal; d += spacing) {
    const jitter = o.jitterPx ? noise1((d / spacing) * 0.7) * o.jitterPx : 0;
    const cx = o.W / 2 + cos * (d + jitter);
    const cy = o.H / 2 + sin * (d + jitter);
    const ux = -sin;
    const uy = cos;
    if (o.dashPx && o.dashPx > 0) {
      for (let t = -diagonal; t < diagonal; t += o.dashPx * 2) {
        ctx.moveTo(cx + ux * t, cy + uy * t);
        ctx.lineTo(cx + ux * (t + o.dashPx), cy + uy * (t + o.dashPx));
      }
    } else {
      ctx.moveTo(cx - ux * diagonal, cy - uy * diagonal);
      ctx.lineTo(cx + ux * diagonal, cy + uy * diagonal);
    }
    drawn += 1;
  }
  ctx.stroke();
  ctx.restore();
  return drawn;
}

/** Stroke rings with an optional hand: a small correlated jitter along the line, in output pixels.
 *  Zero jitter is a clean rule; the parameter exists because a drawn plate needs both. */
export function strokeLoops(
  ctx: CanvasRenderingContext2D, rings: readonly Ring[], T: (x: number, y: number) => [number, number],
  widthPx: number, color: string, alpha: number, jitterPx = 0, seed = 1, dx = 0, dy = 0,
): void {
  if (rings.length === 0 || widthPx <= 0) return;
  const noise1 = makeNoise1(seed);
  ctx.strokeStyle = alpha >= 1 ? color : rgba(color, alpha);
  ctx.lineWidth = widthPx;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (const ring of rings) {
    let s = 0;
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i]!;
      const prev = ring[(i - 1 + ring.length) % ring.length]!;
      const next = ring[(i + 1) % ring.length]!;
      const tx = next[0] - prev[0];
      const ty = next[1] - prev[1];
      const len = Math.hypot(tx, ty) || 1;
      s += Math.hypot(p[0] - prev[0], p[1] - prev[1]);
      const j = jitterPx ? noise1(s * 1.7) * jitterPx : 0;
      const [X, Y] = T(p[0] + dx, p[1] + dy);
      const x = X + (-ty / len) * j;
      const y = Y + (tx / len) * j;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
  }
  ctx.stroke();
}
