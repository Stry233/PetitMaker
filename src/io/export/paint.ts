// src/io/export/paint.ts
// Canvas 2D rendering for export compositions. Layout rectangles use the 800-pixel base coordinate
// system from compose.ts and scale with the final output width.

import type { Badge, ExportComposition, Rect } from './types';
import { APP_FONT_FAMILY } from '../../assets/fonts/family';
import type { GridState } from '../../core/model/types';
import { CHUNK_SIZE } from '../../core/model/constants';
import { layersFor, paintLayer } from './layer-preview';
import { fitAspect, COL_GAP_INNER, MAX_PER_COL, BASE_WIDTH, PAD, CARD_3D_H, CODE_LABEL_H, LEGEND_LEFT, LEGEND_BOTTOM } from './compose';
import qrcode from 'qrcode-generator';
import { resolveFooter, DEFAULT_FOOTER, formatFooterDate } from './footer-template';
import { rrPath, ellipsize } from './canvas-helpers';
import type { MapProvenanceSummary } from '../../core/provenance/types';
import { badgeScale } from './render';

// 3D-card cells retain the five-column aspect at every item count; the shot picker shares it.
const CARD_3D_TITLE_H = 30, CARD_3D_SIDE_PAD = 8, CARD_3D_BOTTOM_PAD = 8, CARD_3D_GAP = 6;
export const CARD_3D_CELLS = 5;
const CARD_3D_INNER_W = BASE_WIDTH - PAD * 2 - CARD_3D_SIDE_PAD * 2;
const CARD_3D_AREA_H = CARD_3D_H - CARD_3D_TITLE_H - CARD_3D_BOTTOM_PAD;
/** A single 3D-card cell's aspect (width / height) at the 5-up layout. */
export const CARD_3D_CELL_ASPECT = (CARD_3D_INNER_W - CARD_3D_GAP * (CARD_3D_CELLS - 1)) / CARD_3D_CELLS / CARD_3D_AREA_H;

export interface CompositionAssets {
  /** Captured 2D map (full-map PNG data URL loaded into an Image). */
  baseMap: CanvasImageSource | null;
  /** The 3D card's shot thumbnails (empty/omitted skips the card body; caller should unset
   *  comp.card3d when 3D is unavailable). */
  card3dAngles?: CanvasImageSource[];
  /** PetitGlyph raster, drawn below the heading in `comp.codeBand` at native size. */
  codeImg?: CanvasImageSource | null;
  /** When true, draw the chunk index legend beside the (grid-baked) map. */
  grid?: boolean;
  /** Override for the dimensions shown in the footer (true export size, e.g. native). */
  footerDims?: { w: number; h: number };
  /** Footer line template (literal text + {tokens} + optional {fill}); defaults to DEFAULT_FOOTER. */
  footerTemplate?: string;
  /** Resolved footer token values (date/name/layers/objects/title); {dims} is filled from the comp. */
  footerTokens?: Record<string, string>;
  state: GridState;
  summary: MapProvenanceSummary;
  /** User-provided title (empty string if omitted). */
  title: string;
  /** User-provided description (empty string if omitted). */
  description: string;
  /** Translator for all visible strings except the user title/description. */
  translate: (key: string, vars?: Record<string, string | number>) => string;
  /** The maker's band on every export: the locale's lockup art plus an optionally configured site,
   *  invitation, and QR code. */
  brand: {
    /** The locale's logo lockup (public/banner{,-zh}.svg rasterised); null falls back to plain text. */
    lockup: CanvasImageSource | null;
    /** Where the QR points; empty when this deployment omits the site mark. */
    url: string;
    /** The display form of `url`, without its protocol. */
    label: string;
    /** The localized maker line, or import invitation when a site is present. */
    powerText: string;
  };
}

/** Draw the full composition into ctx per the computed layout (band order in the file header).
 *  Browser-only. Font sizes are multiplied by comp.scale so text reads proportionally at any
 *  resolution. */
export function paintComposition(
  ctx: CanvasRenderingContext2D,
  comp: ExportComposition,
  assets: CompositionAssets,
): void {
  const S = comp.scale;
  const FF = APP_FONT_FAMILY;
  drawFrame(ctx, comp.width, comp.height, S, comp.bare === true);
  if (comp.header) drawHeader(ctx, comp.header, comp.badges, assets, S, FF);
  if (comp.map) drawMap(ctx, comp.map, assets, S, FF, comp.bare === true);
  if (comp.layerLabel) drawLayerHeader(ctx, comp.layerLabel, assets, S, FF);
  if (comp.layerCol) drawLayerColumn(ctx, comp.layerCol, assets, S, FF);
  if (comp.card3d) draw3dCard(ctx, comp.card3d, assets, S, FF);
  if (comp.codeBand) paintCodeBand(ctx, comp.codeBand, assets, S, FF);
  if (comp.footer) drawFooter(ctx, comp.footer, comp, assets, S, FF);
  drawBrand(ctx, comp.brand, assets, S, FF, comp.bare === true);
}

/** Draw the app lockup and, when configured by the deployment, its address and QR code. */
function drawBrand(ctx: CanvasRenderingContext2D, rect: Rect, assets: CompositionAssets, S: number, FF: string, bare: boolean): void {
  // Full-bleed exports add the inset that framed exports receive from their card padding.
  const inset = bare ? PAD * S : 0;
  const x0 = rect.x + inset, w = rect.w - 2 * inset;
  const padY = 8 * S;
  const contentH = rect.h - 2 * padY;
  const cy = rect.y + rect.h / 2;

  if (bare) {
    ctx.fillStyle = '#fffdf5';
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  }
  // An empty URL omits the QR and address text.
  const hasSite = assets.brand.url.length > 0;
  const qrSide = hasSite ? contentH : 0;
  const qrX = x0 + w - qrSide;
  if (hasSite) drawSiteQr(ctx, assets.brand.url, qrX, rect.y + padY, qrSide, S);

  // Compensate for the transparent margins built into the lockup asset.
  const LOCKUP_OVERDRAW = 228 / 172;
  let lockupRight = x0;
  const art = assets.brand.lockup;
  const drawH = contentH * LOCKUP_OVERDRAW;
  const artW = art && 'width' in art && 'height' in art
    ? drawH * ((art.width as number) / (art.height as number)) : 0;
  if (art && artW > 0) {
    const padShareX = 28 / 796; // the art's own left margin, folded back so the mark starts at x0
    ctx.drawImage(art, x0 - artW * padShareX, cy - drawH / 2, artW, drawH);
    lockupRight = x0 + artW * (1 - 2 * padShareX);
  } else {
    ctx.fillStyle = '#43413F';
    ctx.font = `900 ${20 * S}px ${FF}`;
    ctx.fillText(assets.translate('app.name'), x0, cy + 7 * S);
    lockupRight = x0 + ctx.measureText(assets.translate('app.name')).width;
  }

  // Fit the address first, then the invitation when both fit beside the lockup.
  const textRight = hasSite ? qrX - 12 * S : x0 + w;
  const room = textRight - (lockupRight + 14 * S);
  ctx.textAlign = 'right';
  ctx.font = `800 ${14 * S}px ${FF}`;
  const labelW = ctx.measureText(assets.brand.label).width;
  ctx.font = `700 ${11 * S}px ${FF}`;
  const powerW = ctx.measureText(assets.brand.powerText).width;
  if (!hasSite) {
    // No site named: no words either. The band is the lockup alone.
  } else if (Math.max(labelW, powerW) <= room) {
    ctx.fillStyle = 'rgba(67,65,62,0.62)';
    ctx.fillText(assets.brand.powerText, textRight, cy - 3 * S);
    ctx.fillStyle = '#43413F';
    ctx.font = `800 ${14 * S}px ${FF}`;
    ctx.fillText(assets.brand.label, textRight, cy + 14 * S);
  } else if (labelW <= room) {
    ctx.fillStyle = '#43413F';
    ctx.font = `800 ${14 * S}px ${FF}`;
    ctx.fillText(assets.brand.label, textRight, cy + 5 * S);
  }
  ctx.textAlign = 'left';
}

/** Draw an error-level-M QR code with one quiet-zone module on each side. */
function drawSiteQr(ctx: CanvasRenderingContext2D, url: string, x: number, y: number, side: number, S: number): void {
  const qr = qrcode(0, 'M');
  qr.addData(url);
  qr.make();
  const n = qr.getModuleCount();
  const cell = side / (n + 2); // one quiet module each side
  ctx.fillStyle = '#ffffff';
  rrPath(ctx, x, y, side, side, 6 * S);
  ctx.fill();
  ctx.fillStyle = '#43413F';
  const ox = x + cell, oy = y + cell;
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!qr.isDark(r, c)) continue;
      // Overdrawn a hair so adjacent modules fuse without antialias seams.
      ctx.fillRect(ox + c * cell, oy + r * cell, cell + 0.5, cell + 0.5);
    }
  }
}

/** Solid full-bleed background (JPEG has no alpha) + a subtle inset rounded border for the frame.
 *  A bare export keeps the fill (rounding can leave hairline slivers at the canvas edge) and drops
 *  the border: there is no card to frame. */
function drawFrame(ctx: CanvasRenderingContext2D, width: number, height: number, S: number, bare: boolean): void {
  ctx.fillStyle = '#fffdf5';
  ctx.fillRect(0, 0, width, height);
  if (bare) return;
  ctx.strokeStyle = 'rgba(67,65,62,0.10)';
  ctx.lineWidth = 2;
  rrPath(ctx, 4, 4, width - 8, height - 8, 15 * S);
  ctx.stroke();
}

/** Width of a badge pill at a given scale, read both to lay the row out and to draw it. Sets the
 *  font itself so the measure matches drawBadgePill's text exactly. */
function badgePillWidth(ctx: CanvasRenderingContext2D, label: string, ff: string, S: number, scale: number): number {
  ctx.font = `800 ${14 * S * scale}px ${ff}`;
  const padX = 11 * S * scale, iconW = 16 * S * scale, gap = 6 * S * scale;
  return padX + iconW + gap + ctx.measureText(label).width + padX;
}

/** Header band: title, description (≤2 lines), and up to two provenance badge pills. Text is
 *  ellipsized so a long title never collides with the badges or resizes the layout. */
function drawHeader(ctx: CanvasRenderingContext2D, rect: Rect, badges: Badge[], assets: CompositionAssets, S: number, FF: string): void {
  const { x, y, w } = rect;
  const title = assets.title.trim();
  const desc = assets.description.trim();

  const scale = badgeScale(badges.length);
  const gapBetween = 8 * S;
  const labels = badges.map(b => assets.translate(b.label));
  const widths = labels.map(l => badgePillWidth(ctx, l, FF, S, scale));
  const badgeZoneW = widths.length ? widths.reduce((a, b) => a + b, 0) + gapBetween * (widths.length - 1) : 0;

  if (title) {
    ctx.fillStyle = '#43413F';
    ctx.font = `900 ${25 * S}px ${FF}`;
    ctx.fillText(ellipsize(ctx, title, w - (badgeZoneW ? badgeZoneW + 12 * S : 0)), x, y + 24 * S);
  }
  if (desc) {
    ctx.font = `600 ${15 * S}px ${FF}`;
    const maxW = w - 12;
    const all = wrapText(ctx, desc, maxW, `600 ${15 * S}px ${FF}`, Infinity);
    const lines = all.slice(0, 2);
    if (all.length > 2 && lines[1]) lines[1] = ellipsize(ctx, lines[1] + ' ' + all[2], maxW, true); // mark dropped text
    ctx.fillStyle = '#8A7B72';
    const descY = y + (title ? 34 * S : 0);
    for (let i = 0; i < lines.length; i++) ctx.fillText(lines[i]!, x, descY + 16 * S + i * 20 * S);
  }
  // Right-aligned pill row.
  let px = x + w - badgeZoneW;
  for (let i = 0; i < badges.length; i++) {
    drawBadgePill(ctx, px, y + 2 * S, labels[i]!, badges[i]!.color, FF, S, scale);
    px += widths[i]! + gapBetween;
  }
}

/** Space (BASE-800 px) reserved for the chunk index legend when grid is on: row letters sit to the
 *  LEFT of the map, column numbers BELOW it. Shrinking the map band by these keeps map+labels
 *  within the SAME footprint the map-only layout occupies; labels spilling into the padding make
 *  the grid-on map read larger than the grid-off one. */

/** Main map: the captured 2D map letterboxed into its band, plus the chunk index legend (the grid
 *  lines themselves are already baked into the capture). With the legend on, the map is fitted into
 *  a band inset by the legend margins so the map + labels together equal the map-only footprint. */
function drawMap(ctx: CanvasRenderingContext2D, rect: Rect, assets: CompositionAssets, S: number, FF: string, bare = false): void {
  const legendL = assets.grid ? LEGEND_LEFT * S : 0;
  const legendB = assets.grid ? LEGEND_BOTTOM * S : 0;
  const band: Rect = { x: rect.x + legendL, y: rect.y, w: rect.w - legendL, h: rect.h - legendB };
  const { x, y, w, h } = band;
  ctx.save();
  // Bare: the band IS the canvas, so square corners — a rounded clip would notch the picture.
  rrPath(ctx, x, y, w, h, bare ? 0 : 14 * S);
  ctx.clip();
  if (assets.baseMap) {
    ctx.drawImage(assets.baseMap, ...fitTuple(fitMap(band, assets.baseMap)));
  } else {
    ctx.fillStyle = '#bfeafe';
    ctx.fillRect(x, y, w, h);
  }
  ctx.restore();

  if (assets.grid) {
    const cols = Math.max(1, assets.state.template.width);
    const rows = Math.max(1, assets.state.template.height);
    const fit = assets.baseMap ? fitMap(band, assets.baseMap) : band;
    drawGridLegend(ctx, fit, cols, rows, S, FF);
  }
}

/** Layer-area header strip: stack icon + "MAP LAYERS" label, vertically centered together. */
function drawLayerHeader(ctx: CanvasRenderingContext2D, rect: Rect, assets: CompositionAssets, S: number, FF: string): void {
  const { x, y, h } = rect;
  const cy = y + h / 2;
  const isz = 15 * S;
  drawLayersStackIcon(ctx, x + isz / 2, cy, isz);
  ctx.fillStyle = '#8A7B72';
  ctx.font = `800 ${13 * S}px ${FF}`;
  ctx.textBaseline = 'middle';
  ctx.fillText(assets.translate('export.layers_title').toUpperCase(), x + isz + 8 * S, cy);
  ctx.textBaseline = 'alphabetic';
}

/** Per-layer thumbnails on the RIGHT of the map. Stack down a sub-column, then wrap to the next
 *  sub-column once a column is full (MAX_PER_COL) — never shrink to slivers. */
function drawLayerColumn(ctx: CanvasRenderingContext2D, rect: Rect, assets: CompositionAssets, S: number, FF: string): void {
  const { x, y, w, h } = rect;
  const steps = layersFor(assets.state);
  const n = steps.length;
  const nCols = Math.max(1, Math.ceil(n / MAX_PER_COL));
  const perCol = Math.ceil(n / nCols);
  const gapX = COL_GAP_INNER * S;
  const subW = (w - gapX * (nCols - 1)) / nCols;
  const cgap = 6 * S;
  const thumbH = (h - cgap * (perCol - 1)) / perCol;
  const mapAspect = assets.state.template.width / Math.max(1, assets.state.template.height);

  for (let i = 0; i < n; i++) {
    const step = steps[i]!;
    const tx = x + Math.floor(i / perCol) * (subW + gapX);
    const ty = y + (i % perCol) * (thumbH + cgap);
    const imgH = thumbH - 14 * S - 2 * S;

    ctx.fillStyle = '#ffffff';
    rrPath(ctx, tx, ty, subW, thumbH, 6 * S);
    ctx.fill();
    ctx.strokeStyle = 'rgba(67,65,62,0.10)';
    ctx.lineWidth = 1;
    rrPath(ctx, tx, ty, subW, thumbH, 6 * S);
    ctx.stroke();

    paintLayer(ctx, { x: tx + 3 * S, y: ty + 3 * S, w: subW - 6 * S, h: imgH }, assets.state, step.level, mapAspect);

    ctx.fillStyle = '#5a4f47';
    ctx.font = `700 ${10 * S}px ${FF}`;
    ctx.textAlign = 'center';
    ctx.fillText(assets.translate(step.labelKey, step.level > 0 ? { n: step.level } : undefined), tx + subW / 2, ty + thumbH - 2 * S);
    ctx.textAlign = 'left';
  }
}

/** 3D card: a titled panel holding a row of smart-angle thumbnails (or a single still). */
function draw3dCard(ctx: CanvasRenderingContext2D, rect: Rect, assets: CompositionAssets, S: number, FF: string): void {
  const { x, y, w, h } = rect;
  ctx.fillStyle = '#ffffff';
  rrPath(ctx, x, y, w, h, 12 * S);
  ctx.fill();
  ctx.strokeStyle = 'rgba(67,65,62,0.10)';
  ctx.lineWidth = 1.5;
  rrPath(ctx, x, y, w, h, 12 * S);
  ctx.stroke();

  ctx.fillStyle = '#8A7B72';
  ctx.font = `800 ${13 * S}px ${FF}`;
  const isz = 15 * S, titleH = CARD_3D_TITLE_H * S, titleCy = y + titleH / 2, iconX = x + 14 * S;
  drawIsoCubeIcon(ctx, iconX, titleCy - isz / 2, isz);
  ctx.textBaseline = 'middle';
  ctx.fillText(assets.translate('export.card_3d').toUpperCase(), iconX + isz + 8 * S, titleCy);
  ctx.textBaseline = 'alphabetic';

  const imgs = (assets.card3dAngles ?? []).filter(Boolean);
  if (!imgs.length) return;
  const areaX = x + CARD_3D_SIDE_PAD * S, areaY = y + titleH, areaW = w - CARD_3D_SIDE_PAD * 2 * S, areaH = h - titleH - CARD_3D_BOTTOM_PAD * S;
  const gap = CARD_3D_GAP * S;
  // Cells are always the 5-up size, so the tile aspect + rounded corners stay identical for ANY
  // count (1..5) — fewer shots just leave the row shorter, centered, rather than stretching wider.
  // cover fills each cell so the rounded corners hug the image.
  const cw = (areaW - gap * (CARD_3D_CELLS - 1)) / CARD_3D_CELLS;
  // Distribute the cells with EVEN gaps around and between them (space-evenly), so fewer-than-5
  // shots read as evenly padded rather than clustered or edge-stuck.
  const evenGap = (areaW - imgs.length * cw) / (imgs.length + 1);
  for (let i = 0; i < imgs.length; i++) {
    const ix = areaX + evenGap + i * (cw + evenGap);
    ctx.save();
    rrPath(ctx, ix, areaY, cw, areaH, 7 * S);
    ctx.clip();
    const im = imgs[i]! as CanvasImageSource & { width: number; height: number };
    const sc = Math.max(cw / im.width, areaH / im.height);
    const dw = im.width * sc, dh = im.height * sc;
    ctx.drawImage(im, ix + (cw - dw) / 2, areaY + (areaH - dh) / 2, dw, dh);
    ctx.restore();
  }
}

/** The heading sits outside the native-size raster so every code module keeps its exact pixels. */
export function paintCodeBand(
  ctx: CanvasRenderingContext2D, rect: Rect, assets: Pick<CompositionAssets, 'codeImg' | 'translate'>,
  S: number, FF = APP_FONT_FAMILY,
): void {
  const { x, y, w, h } = rect;
  const labelH = Math.round(CODE_LABEL_H * S);
  const cy = y + labelH / 2;
  const isz = 13 * S;
  drawMosaicIcon(ctx, x, cy - isz / 2, isz);
  ctx.fillStyle = '#8A7B72';
  ctx.font = `800 ${13 * S}px ${FF}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(assets.translate('export.code_label').toUpperCase(), x + isz + 8 * S, cy);
  ctx.textBaseline = 'alphabetic';

  if (!assets.codeImg) return;
  const my = y + labelH;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, my, w, h - labelH);
  ctx.clip();
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(assets.codeImg, Math.round(x), my);
  ctx.restore();
}

/** Footer band: the customizable line (literal text + {tokens}); {fill} splits it left/right.
 *  The band carries ONLY the user's own template: the AI-illustration disclosure is baked into the
 *  stylized map band's pixels instead, since this line is the user's to write and to remove. */
function drawFooter(ctx: CanvasRenderingContext2D, rect: Rect, comp: ExportComposition, assets: CompositionAssets, S: number, FF: string): void {
  const { x, y, w, h } = rect;
  ctx.fillStyle = 'rgba(243,238,232,0.95)';
  rrPath(ctx, x, y, w, h, 10 * S);
  ctx.fill();

  const dimW = assets.footerDims?.w ?? comp.width;
  const dimH = assets.footerDims?.h ?? comp.height;
  const values = { date: formatFooterDate(), dims: `${dimW}×${dimH}`, ...assets.footerTokens };
  // `??` not `||`: an EMPTY template means the user cleared the footer, so render it empty (no
  // text). Only a caller that omits footerTemplate entirely (undefined) falls back to the default.
  const { left, right } = resolveFooter(assets.footerTemplate ?? DEFAULT_FOOTER, values);

  ctx.fillStyle = '#8A7B72';
  ctx.font = `700 ${14 * S}px ${FF}`;
  ctx.textBaseline = 'middle';
  const cy = y + h / 2, pad = 14 * S;
  const maxHalf = w - 2 * pad - (left && right ? 12 * S : 0);
  if (left) { ctx.textAlign = 'left'; ctx.fillText(ellipsize(ctx, left, right ? maxHalf : w - 2 * pad), x + pad, cy); }
  if (right) { ctx.textAlign = 'right'; ctx.fillText(ellipsize(ctx, right, maxHalf), x + w - pad, cy); }
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
}

// ── helpers ─────────────────────────────────────────────────────────────────────

/** Letterbox an image's intrinsic aspect into `rect` (centered, never stretched). */
function fitMap(rect: Rect, img: CanvasImageSource): Rect {
  const iw = (img as { width?: number }).width ?? rect.w;
  const ih = (img as { height?: number }).height ?? rect.h;
  return fitAspect(rect, ih > 0 ? iw / ih : rect.w / rect.h);
}
const fitTuple = (r: Rect): [number, number, number, number] => [r.x, r.y, r.w, r.h];

/** Chunk index legend OUTSIDE the fitted map rect — row letters A,B,C… left, column numbers 1,2,3…
 *  below, one per chunk and centered on each chunk (same A1 scheme as the 2D editor). */
function drawGridLegend(ctx: CanvasRenderingContext2D, rect: Rect, cols: number, rows: number, S: number, ff: string): void {
  const { x, y, w, h } = rect;
  const cw = w / cols, ch = h / rows;
  const chunksX = Math.ceil(cols / CHUNK_SIZE), chunksY = Math.ceil(rows / CHUNK_SIZE);

  ctx.fillStyle = '#8A7B72';
  ctx.font = `800 ${12.5 * S}px ${ff}`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  // Each label sits at the middle of ITS chunk, the last one at the middle of whatever is left of
  // it: clamping to the map's edge would centre that label on the edge and clip half of it.
  const mid = (i: number, total: number) => (i * CHUNK_SIZE + Math.min((i + 1) * CHUNK_SIZE, total)) / 2;
  for (let cr = 0; cr < chunksY; cr++) {
    ctx.fillText(String.fromCharCode(65 + (cr % 26)), x - 7 * S, y + mid(cr, rows) * ch);
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (let cc = 0; cc < chunksX; cc++) {
    ctx.fillText(String(cc + 1), x + mid(cc, cols) * cw, y + h + 6 * S);
  }
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
}

// ── icon helpers ──────────────────────────────────────────────────────────────

/** Draw a stacked-layers icon (3 offset rounded rects), centered on (cx, cy). */
function drawLayersStackIcon(ctx: CanvasRenderingContext2D, cx: number, cy: number, sz: number): void {
  const rw = sz, rh = sz * 0.42, step = sz * 0.27;
  const colors = ['#97e1ff', '#5cb837', '#9a6b3f'];  // back (bottom) → front (top)
  for (let i = 0; i < 3; i++) {
    const dy = step - i * step;  // +step (bottom), 0 (middle), -step (top)
    ctx.fillStyle = colors[i]!;
    rrPath(ctx, cx - rw / 2, cy + dy - rh / 2, rw, rh, 2);
    ctx.fill();
  }
}

function drawMosaicIcon(ctx: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  const gap = size * 0.12, cell = (size - gap) / 2;
  const colors = ['#d9b86a', '#9ccf6e', '#7fb5d6', '#c8a6d6'];
  for (let row = 0; row < 2; row++) for (let col = 0; col < 2; col++) {
    ctx.fillStyle = colors[row * 2 + col]!;
    ctx.fillRect(x + col * (cell + gap), y + row * (cell + gap), cell, cell);
  }
}

/** Draw a tiny iso-cube icon — for the 3D card header. */
function drawIsoCubeIcon(ctx: CanvasRenderingContext2D, x: number, y: number, sz: number): void {
  const mx = x + sz / 2, my = y;
  const pts = {
    top: [[mx, my], [mx + sz / 2, my + sz * 0.3], [mx, my + sz * 0.6], [mx - sz / 2, my + sz * 0.3]] as [number, number][],
    left: [[mx - sz / 2, my + sz * 0.3], [mx, my + sz * 0.6], [mx, my + sz], [mx - sz / 2, my + sz * 0.7]] as [number, number][],
    right: [[mx + sz / 2, my + sz * 0.3], [mx, my + sz * 0.6], [mx, my + sz], [mx + sz / 2, my + sz * 0.7]] as [number, number][],
  };
  const drawPoly = (poly: [number, number][], fill: string) => {
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.moveTo(poly[0]![0], poly[0]![1]);
    for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i]![0], poly[i]![1]);
    ctx.closePath();
    ctx.fill();
  };
  drawPoly(pts.top, '#79c440');
  drawPoly(pts.left, '#3e941d');
  drawPoly(pts.right, '#298c19');
}

// ── text helpers ────────────────────────────────────────────────────────────────

function drawBadgePill(ctx: CanvasRenderingContext2D, x: number, y: number, label: string, color: string, ff: string, S: number, scale = 1): void {
  const padX = 11 * S * scale, iconW = 16 * S * scale, gap = 6 * S * scale;
  ctx.font = `800 ${14 * S * scale}px ${ff}`; // set the label font BEFORE measuring so the pill background matches the drawn text
  const tw = ctx.measureText(label).width;
  const w = padX + iconW + gap + tw + padX;
  const h = 28 * S * scale;

  ctx.fillStyle = color;
  rrPath(ctx, x, y, w, h, h / 2);
  ctx.fill();

  ctx.fillStyle = '#fff';
  ctx.save();
  ctx.translate(x + padX + iconW / 2, y + h / 2);
  ctx.beginPath();
  for (let i = 0; i < 5; i++) {
    const outerAng = -Math.PI / 2 + i * (2 * Math.PI / 5);
    const innerAng = outerAng + Math.PI / 5;
    ctx.lineTo(Math.cos(outerAng) * 6 * S * scale, Math.sin(outerAng) * 6 * S * scale);
    ctx.lineTo(Math.cos(innerAng) * 2.6 * S * scale, Math.sin(innerAng) * 2.6 * S * scale);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  ctx.fillStyle = '#fff';
  ctx.font = `800 ${14 * S * scale}px ${ff}`;
  ctx.textBaseline = 'middle';
  ctx.fillText(label, x + padX + iconW + gap, y + h / 2 + 1);
  ctx.textBaseline = 'alphabetic';
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxW: number, font: string, maxLines = 2): string[] {
  ctx.font = font;
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = '';
  for (const word of words) {
    const test = cur ? `${cur} ${word}` : word;
    if (ctx.measureText(test).width > maxW && cur) { lines.push(cur); cur = word; } else { cur = test; }
  }
  if (cur) lines.push(cur);
  return Number.isFinite(maxLines) ? lines.slice(0, maxLines) : lines;
}
