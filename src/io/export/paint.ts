/**
 * Canvas 2D painting of a laid-out share picture. The layout's rects are output pixels; every size
 * a painter adds is in the 800-pixel base coordinates of `compose.ts`, multiplied by the scale.
 */
import type { Badge, ExportComposition } from './types';
import { TiledMap } from './tiled-map';
import type { BandWindow } from './banded';
import { APP_FONT_FAMILY } from '../../assets/fonts/family';
import type { GridState, MapTemplate } from '../../core/model/types';
import type { Rect } from '../../core/grid/rect';
import { chunkColumnLabel, chunkRowLabel, mapCaptureFrame, mapChunkAxes } from '../../core/grid/map-chunks';
import { layersFor } from './layer-preview';
import { layerName } from '../../i18n/terms/layer-name';
import { paintLayer } from '../../view/shared/terrain/layer-section';
import { fitAspect } from '../../core/grid/rect';
import { rrPath } from '../../view/shared/viewport/round-rect';
import { COL_GAP_INNER, MAX_PER_COL, CARD_3D_BOTTOM_PAD, CARD_3D_CELLS, CARD_3D_GAP, CARD_3D_SIDE_PAD, CARD_3D_TITLE_H, CODE_LABEL_H, LEGEND_LEFT, LEGEND_BOTTOM } from './compose';
import { resolveFooter, DEFAULT_FOOTER, formatFooterDate } from './footer-template';
import { ellipsize, wrapLines } from './canvas-helpers';
import type { MapProvenanceSummary } from '../../core/provenance/types';
import { badgeScale } from './render';
import { EXPORT_CAPTION, EXPORT_CARD, EXPORT_MAP_PLACEHOLDER, EXPORT_ON_BADGE, EXPORT_PAPER, FRAME_INK, SURFACE_SECONDARY, TEXT_SECONDARY, rgbaOf } from '../../assets/brand-palette';
import { drawBrand } from './brand-band';
import { drawIsoCubeIcon, drawLayersStackIcon, drawMosaicIcon } from './icons';
import type { Translate } from '../../i18n/keys';

/** The hairline a card and its thumbnails are outlined with. */
const FRAME_HAIRLINE = rgbaOf(FRAME_INK, 0.1);

export interface CompositionAssets {
  /** Captured 2D map (full-map PNG data URL loaded into an Image), or one captured tile by tile. */
  baseMap: CanvasImageSource | TiledMap | null;
  /** The part of the composition being painted, when it is painted in tiles; the map draws only that. */
  window?: BandWindow;
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
  translate: Translate;
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

/** What every band painter reads: the canvas, the composition's assets, its scale and font family. */
export interface Painter {
  ctx: CanvasRenderingContext2D;
  assets: CompositionAssets;
  S: number;
  FF: string;
}

/** Draw the full composition into ctx, row by row from the header down to the maker's band.
 *  Browser-only. Font sizes are multiplied by comp.scale so text reads proportionally at any
 *  resolution. */
export function paintComposition(
  ctx: CanvasRenderingContext2D,
  comp: ExportComposition,
  assets: CompositionAssets,
): void {
  const S = comp.scale;
  const FF = APP_FONT_FAMILY;
  const p: Painter = { ctx, assets, S, FF };
  drawFrame(ctx, comp.width, comp.height, S, comp.bare === true);
  if (comp.header) drawHeader(p, comp.header, comp.badges);
  if (comp.map) drawMap(p, comp.map, comp.bare === true);
  if (comp.layerLabel) drawLayerHeader(p, comp.layerLabel);
  if (comp.layerCol) drawLayerColumn(p, comp.layerCol);
  if (comp.card3d) draw3dCard(p, comp.card3d);
  if (comp.codeBand) paintCodeBand(ctx, comp.codeBand, assets, S, FF);
  if (comp.footer) drawFooter(p, comp.footer, comp);
  drawBrand(p, comp.brand, comp.bare === true);
}

/** Solid full-bleed background (JPEG has no alpha) + a subtle inset rounded border for the frame.
 *  A bare export keeps the fill (rounding can leave hairline slivers at the canvas edge) and drops
 *  the border: there is no card to frame. */
function drawFrame(ctx: CanvasRenderingContext2D, width: number, height: number, S: number, bare: boolean): void {
  ctx.fillStyle = EXPORT_PAPER;
  ctx.fillRect(0, 0, width, height);
  if (bare) return;
  ctx.strokeStyle = FRAME_HAIRLINE;
  ctx.lineWidth = 2;
  rrPath(ctx, { x: 4, y: 4, w: width - 8, h: height - 8 }, 15 * S);
  ctx.stroke();
}

/** A badge pill's measures at a given scale, read both to lay the row out and to draw it. Leaves
 *  the label font set, so the measured width matches the drawn text exactly. */
function badgePill(
  ctx: CanvasRenderingContext2D, label: string, ff: string, S: number, scale: number,
): { padX: number; iconW: number; gap: number; w: number; h: number } {
  ctx.font = `800 ${14 * S * scale}px ${ff}`;
  const padX = 11 * S * scale, iconW = 16 * S * scale, gap = 6 * S * scale;
  return { padX, iconW, gap, w: padX + iconW + gap + ctx.measureText(label).width + padX, h: 28 * S * scale };
}

/** Header band: title, description (≤2 lines), and up to two provenance badge pills. Text is
 *  ellipsized so a long title never collides with the badges or resizes the layout. */
function drawHeader(p: Painter, rect: Rect, badges: Badge[]): void {
  const { ctx, assets, S, FF } = p;
  const { x, y, w } = rect;
  const title = assets.title.trim();
  const desc = assets.description.trim();

  const scale = badgeScale(badges.length);
  const gapBetween = 8 * S;
  const labels = badges.map(b => assets.translate(b.label));
  const widths = labels.map(l => badgePill(ctx, l, FF, S, scale).w);
  const badgeZoneW = widths.length ? widths.reduce((a, b) => a + b, 0) + gapBetween * (widths.length - 1) : 0;

  if (title) {
    ctx.fillStyle = FRAME_INK;
    ctx.font = `900 ${25 * S}px ${FF}`;
    ctx.fillText(ellipsize(ctx, title, w - (badgeZoneW ? badgeZoneW + 12 * S : 0)), x, y + 24 * S);
  }
  if (desc) {
    ctx.font = `600 ${15 * S}px ${FF}`;
    const maxW = w - 12;
    const all = wrapLines(ctx, desc, maxW);
    const lines = all.slice(0, 2);
    if (all.length > 2 && lines[1]) lines[1] = ellipsize(ctx, lines[1] + ' ' + all[2], maxW, true); // mark dropped text
    ctx.fillStyle = TEXT_SECONDARY;
    const descY = y + (title ? 34 * S : 0);
    for (let i = 0; i < lines.length; i++) ctx.fillText(lines[i]!, x, descY + 16 * S + i * 20 * S);
  }
  // Right-aligned pill row.
  let px = x + w - badgeZoneW;
  for (let i = 0; i < badges.length; i++) {
    drawBadgePill(p, { x: px, y: y + 2 * S }, { label: labels[i]!, color: badges[i]!.color }, scale);
    px += widths[i]! + gapBetween;
  }
}

/** Main map: the captured 2D map letterboxed into its band, plus the chunk index legend (the grid
 *  lines themselves are already baked into the capture). With the legend on, the map is fitted into
 *  a band inset by the legend margins so the map + labels together equal the map-only footprint. */
function drawMap(p: Painter, rect: Rect, bare = false): void {
  const { ctx, assets, S, FF } = p;
  const legendL = assets.grid ? LEGEND_LEFT * S : 0;
  const legendB = assets.grid ? LEGEND_BOTTOM * S : 0;
  const band: Rect = { x: rect.x + legendL, y: rect.y, w: rect.w - legendL, h: rect.h - legendB };
  const { x, y, w, h } = band;
  ctx.save();
  // Bare: the band is the canvas, so square corners — a rounded clip would notch the picture.
  rrPath(ctx, band, bare ? 0 : 14 * S);
  ctx.clip();
  if (assets.baseMap instanceof TiledMap) {
    assets.baseMap.draw(ctx, fitMap(band, assets.baseMap), assets.window);
  } else if (assets.baseMap) {
    ctx.drawImage(assets.baseMap, ...fitTuple(fitMap(band, assets.baseMap)));
  } else {
    ctx.fillStyle = EXPORT_MAP_PLACEHOLDER;
    ctx.fillRect(x, y, w, h);
  }
  ctx.restore();

  if (assets.grid) {
    const fit = assets.baseMap ? fitMap(band, assets.baseMap) : band;
    drawGridLegend(ctx, fit, assets.state.template, S, FF);
  }
}

/** Layer-area header strip: stack icon + "MAP LAYERS" label, vertically centered together. */
function drawLayerHeader(p: Painter, rect: Rect): void {
  const { ctx, assets, S, FF } = p;
  const { x, y, h } = rect;
  const cy = y + h / 2;
  const isz = 15 * S;
  drawLayersStackIcon(ctx, x + isz / 2, cy, isz);
  ctx.fillStyle = TEXT_SECONDARY;
  ctx.font = `800 ${13 * S}px ${FF}`;
  ctx.textBaseline = 'middle';
  ctx.fillText(assets.translate('export.layers_title').toUpperCase(), x + isz + 8 * S, cy);
  ctx.textBaseline = 'alphabetic';
}

/** Per-layer thumbnails on the right of the map. Stack down a sub-column, then wrap to the next
 *  sub-column once a column is full (MAX_PER_COL) — never shrink to slivers. */
function drawLayerColumn(p: Painter, rect: Rect): void {
  const { ctx, assets, S, FF } = p;
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

    ctx.fillStyle = EXPORT_CARD;
    rrPath(ctx, { x: tx, y: ty, w: subW, h: thumbH }, 6 * S);
    ctx.fill();
    ctx.strokeStyle = FRAME_HAIRLINE;
    ctx.lineWidth = 1;
    rrPath(ctx, { x: tx, y: ty, w: subW, h: thumbH }, 6 * S);
    ctx.stroke();

    paintLayer(ctx, { x: tx + 3 * S, y: ty + 3 * S, w: subW - 6 * S, h: imgH }, assets.state, step.level, mapAspect);

    ctx.fillStyle = EXPORT_CAPTION;
    ctx.font = `700 ${10 * S}px ${FF}`;
    ctx.textAlign = 'center';
    ctx.fillText(layerName(assets.translate, step.level), tx + subW / 2, ty + thumbH - 2 * S);
    ctx.textAlign = 'left';
  }
}

/** 3D card: a titled panel holding a row of smart-angle thumbnails (or a single still). */
function draw3dCard(p: Painter, rect: Rect): void {
  const { ctx, assets, S, FF } = p;
  const { x, y, w, h } = rect;
  ctx.fillStyle = EXPORT_CARD;
  rrPath(ctx, { x, y, w, h }, 12 * S);
  ctx.fill();
  ctx.strokeStyle = FRAME_HAIRLINE;
  ctx.lineWidth = 1.5;
  rrPath(ctx, { x, y, w, h }, 12 * S);
  ctx.stroke();

  ctx.fillStyle = TEXT_SECONDARY;
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
  // Cells are always the 5-up size, so the tile aspect + rounded corners stay identical for any
  // count (1..5) — fewer shots just leave the row shorter, centered, rather than stretching wider.
  // cover fills each cell so the rounded corners hug the image.
  const cw = (areaW - gap * (CARD_3D_CELLS - 1)) / CARD_3D_CELLS;
  // Distribute the cells with even gaps around and between them (space-evenly), so fewer-than-5
  // shots read as evenly padded rather than clustered or edge-stuck.
  const evenGap = (areaW - imgs.length * cw) / (imgs.length + 1);
  for (let i = 0; i < imgs.length; i++) {
    const ix = areaX + evenGap + i * (cw + evenGap);
    ctx.save();
    rrPath(ctx, { x: ix, y: areaY, w: cw, h: areaH }, 7 * S);
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
  ctx.fillStyle = TEXT_SECONDARY;
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
 *  The band carries only the user's own template: the AI-illustration disclosure is baked into the
 *  stylized map band's pixels instead, since this line is the user's to write and to remove. */
function drawFooter(p: Painter, rect: Rect, comp: ExportComposition): void {
  const { ctx, assets, S, FF } = p;
  const { x, y, w, h } = rect;
  ctx.fillStyle = rgbaOf(SURFACE_SECONDARY, 0.95);
  rrPath(ctx, { x, y, w, h }, 10 * S);
  ctx.fill();

  const dimW = assets.footerDims?.w ?? comp.width;
  const dimH = assets.footerDims?.h ?? comp.height;
  const values = { date: formatFooterDate(), dims: `${dimW}×${dimH}`, ...assets.footerTokens };
  // `??` not `||`: an empty template means the user cleared the footer, so render it empty (no
  // text). Only a caller that omits footerTemplate entirely (undefined) falls back to the default.
  const { left, right } = resolveFooter(assets.footerTemplate ?? DEFAULT_FOOTER, values);

  ctx.fillStyle = TEXT_SECONDARY;
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
function fitMap(rect: Rect, img: CanvasImageSource | TiledMap): Rect {
  const iw = (img as { width?: number }).width ?? rect.w;
  const ih = (img as { height?: number }).height ?? rect.h;
  return fitAspect(rect, ih > 0 ? iw / ih : rect.w / rect.h);
}
const fitTuple = (r: Rect): [number, number, number, number] => [r.x, r.y, r.w, r.h];

/** Chunk index legend outside the fitted map rect — row letters A,B,C… left, column numbers 1,2,3…
 *  below, one per chunk and centered on each chunk (same A1 scheme as the 2D editor). */
function drawGridLegend(ctx: CanvasRenderingContext2D, rect: Rect, template: MapTemplate, S: number, ff: string): void {
  const { x, y, w, h } = rect;
  const frame = mapCaptureFrame(template);
  const cw = w / Math.max(1, frame.width), ch = h / Math.max(1, frame.height);
  const { columns, rows } = mapChunkAxes(template);

  ctx.fillStyle = TEXT_SECONDARY;
  ctx.font = `800 ${12.5 * S}px ${ff}`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (let cr = 0; cr < rows.length; cr++) {
    ctx.fillText(chunkRowLabel(cr), x - 7 * S, y + (rows[cr]!.center - frame.y) * ch);
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (let cc = 0; cc < columns.length; cc++) {
    ctx.fillText(chunkColumnLabel(cc), x + (columns[cc]!.center - frame.x) * cw, y + h + 6 * S);
  }
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
}

// ── text helpers ────────────────────────────────────────────────────────────────

function drawBadgePill(p: Painter, at: { x: number; y: number }, badge: { label: string; color: string }, scale = 1): void {
  const { ctx, S, FF: ff } = p;
  const { x, y } = at;
  const { label, color } = badge;
  const { padX, iconW, gap, w, h } = badgePill(ctx, label, ff, S, scale);

  ctx.fillStyle = color;
  rrPath(ctx, { x, y, w, h }, h / 2);
  ctx.fill();

  ctx.fillStyle = EXPORT_ON_BADGE;
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

  ctx.fillStyle = EXPORT_ON_BADGE;
  ctx.font = `800 ${14 * S * scale}px ${ff}`;
  ctx.textBaseline = 'middle';
  ctx.fillText(label, x + padX + iconW + gap, y + h / 2 + 1);
  ctx.textBaseline = 'alphabetic';
}

