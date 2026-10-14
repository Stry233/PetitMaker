/**
 * The canvas rasters behind 3D annotation lettering: one paint on a wide canvas, then a pixel crop,
 * and the painters for zone captions, dimension numbers and tag chips. Lettering centres on its
 * visible glyph ink.
 */
import { APP_FONT_FAMILY } from '../../../assets/fonts/family';
import { INK_ZONE_DISC, isAnnotationInk } from '../../../config/annotation-palette';
import { MAP_INK, MAP_TEXT } from '../../../assets/brand-palette';

/** The canvas raster behind a billboard, px per world unit — crisp at the fly-in's framing. */
const TEX_PX_PER_UNIT = 96;

/** Paints a label into `ctx` at raster height `hPx` and returns the width it used, in px. */
export type LabelPainter = (ctx: CanvasRenderingContext2D, hPx: number) => number;

/** The cropped raster of a label `worldH` world units tall, or null without a 2D context. */
export function rasterNoteLabel(worldH: number, paint: LabelPainter): HTMLCanvasElement | null {
  // One paint, then a pixel crop: measured on one canvas and drawn on another, a font that
  // finished loading between the two paints clipped the label mid-glyph.
  // Resolution is bounded by capping the raster height, never by truncating the width: a big
  // map's ink scale is several world units of lettering, and a width cap cuts glyphs off.
  const hPx = Math.round(Math.min(worldH * TEX_PX_PER_UNIT, 360));
  const wide = document.createElement('canvas');
  wide.width = 2048;
  wide.height = hPx;
  const wctx = wide.getContext('2d');
  if (!wctx) return null;
  const wPx = Math.ceil(Math.min(2048, Math.max(8, paint(wctx, hPx))));
  const canvas = document.createElement('canvas');
  canvas.width = wPx;
  canvas.height = hPx;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(wide, 0, 0);
  return canvas;
}

/** A zone caption: its number disc when `num` is above 0, then its label. */
export function paintZoneCaption(ctx: CanvasRenderingContext2D, h: number, label: string, num: number, color: string): number {
  const withNum = num > 0;
  const fs = h * 0.52;
  ctx.font = `800 ${fs}px ${APP_FONT_FAMILY}`;
  const labelW = label ? ctx.measureText(label).width : 0;
  const numR = withNum ? fs * 0.62 : 0;
  const total = (withNum ? numR * 2 + (label ? 8 : 0) : 0) + labelW;
  let x = 8;
  const cy = h / 2;
  if (withNum) {
    ctx.fillStyle = isAnnotationInk(color) ? INK_ZONE_DISC : color;
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x + numR, cy, numR, 0, 7);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.font = `800 ${fs * 0.68}px ${APP_FONT_FAMILY}`;
    ctx.fillText(String(num), x + numR, centeredBaseline(ctx, String(num), cy));
    x += numR * 2 + (label ? 8 : 0);
  }
  if (label) {
    ctx.font = `800 ${fs}px ${APP_FONT_FAMILY}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = MAP_INK;
    ctx.lineWidth = fs * 0.16;
    ctx.strokeText(label, x, centeredBaseline(ctx, label, cy));
    ctx.fillStyle = MAP_TEXT;
    ctx.fillText(label, x, centeredBaseline(ctx, label, cy));
  }
  return total + 16;
}

/** A measurement number lying in the map plane. */
export function paintDimensionLabel(ctx: CanvasRenderingContext2D, h: number, text: string): number {
  const fs = h * 0.65;
  ctx.font = `800 ${fs}px ${APP_FONT_FAMILY}`;
  const width = ctx.measureText(text).width;
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'; ctx.lineJoin = 'round';
  ctx.strokeStyle = MAP_INK; ctx.lineWidth = fs * 0.16;
  const y = centeredBaseline(ctx, text, h / 2);
  ctx.strokeText(text, 6, y); ctx.fillStyle = MAP_TEXT; ctx.fillText(text, 6, y);
  return width + 12;
}

/** A tag chip: the label on a rounded plate in the note's colour, outlined when selected. */
export function paintChipLabel(ctx: CanvasRenderingContext2D, h: number, label: string, color: string, selected: boolean): number {
  const fs = h * 0.5;
  ctx.font = `800 ${fs}px ${APP_FONT_FAMILY}`;
  const w = ctx.measureText(label).width;
  const cy = h / 2;
  const padX = fs * 0.5;
  const chipH = fs * 1.6;
  ctx.fillStyle = color;
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = 2;
  roundRect(ctx, { x: 4, y: cy - chipH / 2, w: w + padX * 2, h: chipH }, chipH * 0.36);
  ctx.fill();
  if (selected) {
    ctx.strokeStyle = MAP_INK; ctx.lineWidth = 8; ctx.stroke();
    ctx.strokeStyle = '#FFFFFF'; ctx.lineWidth = 4;
  }
  ctx.stroke();
  ctx.fillStyle = isAnnotationInk(color) ? MAP_INK : '#fff';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(label, 4 + padX, centeredBaseline(ctx, label, cy));
  return w + padX * 2 + 8;
}

function roundRect(ctx: CanvasRenderingContext2D, box: { x: number; y: number; w: number; h: number }, r: number): void {
  const { x, y, w, h } = box;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Center visible glyph ink rather than the font's ascent/descent line box. */
function centeredBaseline(ctx: CanvasRenderingContext2D, text: string, center: number): number {
  const metrics = ctx.measureText(text);
  return center + ((metrics.actualBoundingBoxAscent ?? 0) - (metrics.actualBoundingBoxDescent ?? 0)) / 2;
}
