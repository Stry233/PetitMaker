// src/io/export/paint.ts
// Browser-only Canvas-2D drawing for the composed export image. Implements the layout contract
// computed by compose.ts: rows stack frame → header (title/desc + badge pill) → main map (left)
// + layer column (right) → optional 3D card → share-code band → footer, every rect positioned in
// the BASE-800 coordinate system and scaled by S = width/BASE_WIDTH.
// paintComposition is a thin orchestrator; each band is drawn by its own helper below.

import type { Badge, ExportComposition, Rect } from './types';
import type { GridState } from '../../core/model/types';
import { CHUNK_SIZE } from '../../core/model/constants';
import { layersFor, paintLayer } from './layer-preview';
import { fitAspect, COL_GAP_INNER, MAX_PER_COL, BASE_WIDTH, PAD, CARD_3D_H } from './compose';
import { resolveFooter, DEFAULT_FOOTER, formatFooterDate } from './footer-template';
import { rrPath, ellipsize } from './canvas-helpers';
import type { MapProvenanceSummary } from '../../core/provenance/types';
import { badgeScale } from './render';

// 3D-card cell geometry (BASE-800). Cells are packed at the 5-up size for ANY count, so a single
// cell's aspect (below) is fixed — the export shots menu imports it so its thumbnails use the same
// frame shape and rounded corners as the exported card.
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
  /** The rendered PetitGlyph v2 share-code band (drawn into `comp.codeBand` at native size, no
   *  resampling). Null leaves the band body blank — callers gate on the code being ready. */
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
  const FF = fontFamily();
  drawFrame(ctx, comp.width, comp.height, S);
  if (comp.header) drawHeader(ctx, comp.header, comp.badges, assets, S, FF);
  if (comp.map) drawMap(ctx, comp.map, assets, S, FF);
  if (comp.layerLabel) drawLayerHeader(ctx, comp.layerLabel, assets, S, FF);
  if (comp.layerCol) drawLayerColumn(ctx, comp.layerCol, assets, S, FF);
  if (comp.card3d) draw3dCard(ctx, comp.card3d, assets, S, FF);
  if (comp.codeBand) drawCode(ctx, comp.codeBand, assets, S, FF);
  if (comp.footer) drawFooter(ctx, comp.footer, comp, assets, S, FF);
}

/** Solid full-bleed background (JPEG has no alpha) + a subtle inset rounded border for the frame. */
function drawFrame(ctx: CanvasRenderingContext2D, width: number, height: number, S: number): void {
  ctx.fillStyle = '#fffdf5';
  ctx.fillRect(0, 0, width, height);
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
const LEGEND_LEFT = 18;
const LEGEND_BOTTOM = 18;

/** Main map: the captured 2D map letterboxed into its band, plus the chunk index legend (the grid
 *  lines themselves are already baked into the capture). With the legend on, the map is fitted into
 *  a band inset by the legend margins so the map + labels together equal the map-only footprint. */
function drawMap(ctx: CanvasRenderingContext2D, rect: Rect, assets: CompositionAssets, S: number, FF: string): void {
  const legendL = assets.grid ? LEGEND_LEFT * S : 0;
  const legendB = assets.grid ? LEGEND_BOTTOM * S : 0;
  const band: Rect = { x: rect.x + legendL, y: rect.y, w: rect.w - legendL, h: rect.h - legendB };
  const { x, y, w, h } = band;
  ctx.save();
  rrPath(ctx, x, y, w, h, 14 * S);
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

/** Share-code band: a labeled row above the PetitGlyph v2 code image, drawn INTO the composed
 *  image so every appearance option still applies. There is NO placeholder — callers gate
 *  painting on the code being ready (the preview stays in its loading state until then), so a
 *  null codeImg just leaves the band body blank. The code image is blitted at NATIVE size with
 *  smoothing off — a code's modules must land on exact device pixels, never fitted/resampled. */
function drawCode(ctx: CanvasRenderingContext2D, rect: Rect, assets: CompositionAssets, S: number, FF: string): void {
  const { x, y, w, h } = rect;
  const labelH = 20 * S;
  const cy = y + labelH / 2;
  const isz = 13 * S;
  drawMosaicIcon(ctx, x, cy - isz / 2, isz);
  ctx.fillStyle = '#8A7B72';
  ctx.font = `800 ${13 * S}px ${FF}`;
  ctx.textBaseline = 'middle';
  ctx.fillText(assets.translate('export.code_label').toUpperCase(), x + isz + 8 * S, cy);
  ctx.textBaseline = 'alphabetic';

  const my = y + labelH, mh = h - labelH;
  if (!assets.codeImg) return;
  // Clip to the band rect so a code image mis-sized upstream can't paint outside its
  // band. The clip must never introduce scaling — the draw stays an
  // integer-coord, native-size blit with smoothing off (a code's modules must land on exact
  // device pixels).
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, my, w, mh);
  ctx.clip();
  const smoothed = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(assets.codeImg, Math.round(x), Math.round(my));
  ctx.imageSmoothingEnabled = smoothed;
  ctx.restore();
}

/** Footer band: the customizable line (literal text + {tokens}); {fill} splits it left/right. */
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
  for (let cr = 0; cr < chunksY; cr++) {
    const midCell = Math.min(cr * CHUNK_SIZE + CHUNK_SIZE / 2, rows);
    ctx.fillText(String.fromCharCode(65 + (cr % 26)), x - 7 * S, y + midCell * ch);
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (let cc = 0; cc < chunksX; cc++) {
    const midCell = Math.min(cc * CHUNK_SIZE + CHUNK_SIZE / 2, cols);
    ctx.fillText(String(cc + 1), x + midCell * cw, y + h + 6 * S);
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

/** Draw a tiny 2×2 colored-mosaic icon — for the share-code band header (evokes the code mosaic). */
function drawMosaicIcon(ctx: CanvasRenderingContext2D, x: number, y: number, sz: number): void {
  const gap = sz * 0.12, c = (sz - gap) / 2;
  const cols = ['#d9b86a', '#9ccf6e', '#7fb5d6', '#c8a6d6'];
  let i = 0;
  for (let r = 0; r < 2; r++) for (let cc = 0; cc < 2; cc++) {
    ctx.fillStyle = cols[i++]!;
    ctx.fillRect(x + cc * (c + gap), y + r * (c + gap), c, c);
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

function fontFamily(): string {
  return "'Alibaba PuHuiTi 3','PW Rounded Sans','Varela Round',system-ui,-apple-system,sans-serif";
}

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
