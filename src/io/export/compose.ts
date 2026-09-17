import { hasShareCode, type Badge, type ExportComposition, type ExportOptions, type Rect, type ResolutionKey } from './types';
import { canvasFitScale, CANVAS_LIMITS, type CanvasLimits, type PixelSize } from './sizing';
import { moduleBaseFor, currentBandSize } from '../share/glyph/geometry';
export type { ExportComposition, ExportOptions, Rect, ResolutionKey };
export type { PixelSize } from './sizing';

/** Letterbox `srcAspect` (= width/height) inside `rect`, centered, never stretched.
 *  Used for the main map and the per-layer thumbnails so neither is distorted. */
export function fitAspect(rect: Rect, srcAspect: number): Rect {
  const rA = rect.w / rect.h;
  if (srcAspect > rA) {
    const h = rect.w / srcAspect;
    return { x: rect.x, y: rect.y + (rect.h - h) / 2, w: rect.w, h };
  }
  const w = rect.h * srcAspect;
  return { x: rect.x + (rect.w - w) / 2, y: rect.y, w, h: rect.h };
}

/** Composition width per preset. `original` is resolved from the captured canvas width. */
export const RESOLUTION_WIDTHS: Record<ResolutionKey, number> = { compact: 960, standard: 1600, high: 2400, original: 1600 };

/** Reference width for all BASE-scale constants. S = actualWidth / BASE_WIDTH. */
export const BASE_WIDTH = 800;

// ── BASE-scale layout constants (designed at 800px wide, scaled by S) ──────────
export const PAD = 28;
const GAP = 18;
const TITLE_H = 34, DESC_H = 26, BADGE_ONLY_H = 34;   // header sub-heights
const LAYER_LABEL_H = 20;                              // "LAYERS" strip above the column
export const CARD_3D_H = 130;                          // optional 3D card row
export const CODE_LABEL_H = 20;                       // heading above the PetitGlyph raster
const FOOTER_H = 40;                                   // footer band
export const BRAND_H = 56;                              // maker's band, on every export
const COL_GAP = 16;                                    // gap between map and layer area
const SUB_COL_W = 148;                                 // width of one layer sub-column
/** Gap between stacked layer sub-columns (shared with paint). */
export const COL_GAP_INNER = 10;
/** Layers per sub-column before wrapping to the next column on the right (shared with paint). */
export const MAX_PER_COL = 5;

/** The grid legend's own gutters (left letters, bottom numbers), inside the map band. Owned here
 *  so the bare layout can size the canvas around them; drawMap consumes them at paint time. */
export const LEGEND_LEFT = 18;
export const LEGEND_BOTTOM = 18;

// The map+column content row height tracks the map's natural aspect, clamped readable. The upper
// clamp exists to balance the band against the LAYER COLUMN beside it; with the column off the
// map stands alone, and clamping it there only letterboxes it between wide side margins — alone
// it may run tall, held by the loose cap.
const CONTENT_MIN_RATIO = 0.42;   // of inner width
const CONTENT_MAX_RATIO = 0.64;
const CONTENT_MAX_RATIO_ALONE = 1.25;

/** The output canvas's own pixels. A composition held under a device ceiling floors them, so the
 *  rounding cannot put a canvas a fraction of a pixel back over the limit it was just fitted
 *  under — an area past the ceiling is refused whole, not cropped. */
function outPx(v: number, clamped: boolean): number {
  return clamped ? Math.floor(v) : Math.round(v);
}

/** The code band at a given output width: its own pixel geometry plus the gap above it. Null where
 *  the composition is too narrow to host a legible code. The band's modules must land on whole
 *  device pixels (`glyph/geometry.ts`), so this is measured from the output width rather than
 *  scaled out of the BASE-800 layout — which is also why the fit has to reserve it in advance. */
function codeBandFootprint(widthPx: number, S: number): { gapPx: number; bandW: number; bandBlockH: number } | null {
  const mb = moduleBaseFor(widthPx - 2 * Math.round(PAD * S));
  if (mb === null) return null;
  const { width: bandW, height: mosaicH } = currentBandSize(mb);
  return { gapPx: Math.round(GAP * S), bandW, bandBlockH: Math.round(CODE_LABEL_H * S) + mosaicH };
}

function scaleRect(r: Rect, S: number): Rect {
  return { x: Math.round(r.x * S), y: Math.round(r.y * S), w: Math.round(r.w * S), h: Math.round(r.h * S) };
}

/** Pure layout in BASE-800 coords, scaled by S = width/BASE_WIDTH. Rows stack with a
 *  consistent PAD margin and GAP: header → [map | layer column] → [3D card] → [code band] → footer.
 *  Every row shares the same left/right margins so the composition reads as an aligned grid;
 *  the map and the layer column share the same top and bottom.
 *
 *  Presets and Native use the IDENTICAL proportional layout — they differ ONLY by the chosen
 *  output width (Native = the map's native pixel width, so the image is full-resolution while the
 *  chrome stays proportional). The whole image is uniformly downscaled if it would exceed the
 *  canvas limit. */
export function computeComposition(
  opts: ExportOptions,
  mapAspect: number,
  badges: Badge[],
  ctx: { layerCount: number; mapPx?: PixelSize; limits?: CanvasLimits },
): ExportComposition {
  const innerW = BASE_WIDTH - PAD * 2;
  // The device's own ceiling where the caller measured it (`canvas-limits.ts`); desktop's constants
  // otherwise. A composition past it is not a large image, it is a blank one.
  const limits = ctx.limits ?? CANVAS_LIMITS;
  const aspect = mapAspect > 0 ? mapAspect : 1.2;

  const showBadge = opts.showBadge && badges.length > 0;
  const hasHeader = !!opts.title || !!opts.description || showBadge;
  const headerH = hasHeader ? ((opts.title ? TITLE_H : 0) + (opts.description ? DESC_H : 0) || BADGE_ONLY_H) : 0;

  // BARE EXPORT: nothing was asked for but the 2D map — no header, no layer column, no 3D card,
  // no code band, no footer. The card chrome (margins, cream frame, rounded corners) says "this
  // is a composed share sheet"; with nothing composed it is only a border around the picture, so
  // the canvas takes the map's own aspect and the map takes the whole canvas, keeping just the
  // grid legend's gutters when the legend is on.
  if (!hasHeader && !opts.layerPreview && !opts.card3d && !opts.footer && !hasShareCode(opts)) {
    const legendL = opts.grid ? LEGEND_LEFT : 0;
    const legendB = opts.grid ? LEGEND_BOTTOM : 0;
    // Unrounded in BASE coords: the one rounding happens at output scale, so height and the map
    // rect cannot disagree by a pixel.
    const bareH = legendB + (BASE_WIDTH - legendL) / aspect;
    let width = opts.resolution === 'original' && ctx.mapPx
      ? Math.max(RESOLUTION_WIDTHS.high, ctx.mapPx.w)
      : RESOLUTION_WIDTHS[opts.resolution];
    let S = width / BASE_WIDTH;
    const f = canvasFitScale(width, (bareH + BRAND_H) * S, limits);
    width *= f; S *= f;
    return {
      width: outPx(width, f < 1), height: outPx((bareH + BRAND_H) * S, f < 1), scale: S,
      map: scaleRect({ x: 0, y: 0, w: BASE_WIDTH, h: bareH }, S),
      brand: scaleRect({ x: 0, y: bareH, w: BASE_WIDTH, h: BRAND_H }, S),
      badges: [], bare: true,
    };
  }

  // Layer area: stacked sub-columns on the right (wraps to a 2nd/3rd column past MAX_PER_COL),
  // map fills the rest.
  const nCols = opts.layerPreview ? Math.max(1, Math.ceil(ctx.layerCount / MAX_PER_COL)) : 0;
  const layerAreaW = opts.layerPreview ? nCols * SUB_COL_W + (nCols - 1) * COL_GAP_INNER : 0;
  const mapW = opts.layerPreview ? innerW - layerAreaW - COL_GAP : innerW;
  // Content height follows the MAP's natural aspect (so it fills its band, minimal letterbox),
  // clamped to a balanced range so the map is never oversized or a thin slice.
  const maxRatio = opts.layerPreview ? CONTENT_MAX_RATIO : CONTENT_MAX_RATIO_ALONE;
  const contentH = Math.round(Math.min(innerW * maxRatio, Math.max(innerW * CONTENT_MIN_RATIO, mapW / aspect)));

  // Build the layout in BASE-800 coordinates first; width/scale are chosen afterwards so the
  // proportions are identical at every output size.
  const baseRects: Record<string, Rect> = {};
  let y = PAD;
  if (hasHeader) { baseRects.header = { x: PAD, y, w: innerW, h: headerH }; y += headerH + GAP; }
  baseRects.map = { x: PAD, y, w: mapW, h: contentH };
  if (opts.layerPreview) {
    const colX = PAD + mapW + COL_GAP;
    baseRects.layerLabel = { x: colX, y, w: layerAreaW, h: LAYER_LABEL_H };
    baseRects.layerCol = { x: colX, y: y + LAYER_LABEL_H, w: layerAreaW, h: contentH - LAYER_LABEL_H };
  }
  y += contentH;
  if (opts.card3d) { y += GAP; baseRects.card3d = { x: PAD, y, w: innerW, h: CARD_3D_H }; y += CARD_3D_H; }
  if (opts.footer) { y += GAP; baseRects.footer = { x: PAD, y, w: innerW, h: FOOTER_H }; y += FOOTER_H; }
  y += GAP;
  baseRects.brand = { x: PAD, y, w: innerW, h: BRAND_H };
  y += BRAND_H;
  const baseH = y + PAD;

  // Output width: presets are fixed; Native uses the map's native pixel width, with High as a floor.
  let width = opts.resolution === 'original' && ctx.mapPx
    ? Math.max(RESOLUTION_WIDTHS.high, ctx.mapPx.w)
    : RESOLUTION_WIDTHS[opts.resolution];
  // Uniformly shrink a composition that would exceed the canvas ceiling. The code band is the one
  // row whose height is not in `baseH`: it is quantized from the final width, so it does not shrink
  // with everything else and the fit is repeated against the band each candidate width carries. A
  // composition that already fits leaves its width untouched on the first pass.
  let clamped = false;
  for (let pass = 0; pass < 8; pass++) {
    const s = width / BASE_WIDTH;
    const band = hasShareCode(opts) ? codeBandFootprint(width, s) : null;
    const f = canvasFitScale(width, baseH * s + (band ? band.gapPx + band.bandBlockH : 0), limits);
    if (f >= 1) break;
    width = Math.max(1, Math.floor(width * f));
    clamped = true;
  }
  const S = width / BASE_WIDTH;

  const out: ExportComposition = {
    width: outPx(width, clamped), height: outPx(baseH * S, clamped), scale: S,
    map: scaleRect(baseRects.map!, S), brand: scaleRect(baseRects.brand!, S),
    badges: showBadge ? badges : [],
  };
  for (const k of ['header', 'layerLabel', 'layerCol', 'card3d', 'footer'] as const) {
    if (baseRects[k]) out[k] = scaleRect(baseRects[k]!, S);
  }

  // Code band: EXACT pixel geometry driven by the FINAL fitted width. The band sits at the same
  // PAD as everything else and takes its module base from that inset width.
  if (hasShareCode(opts)) {
    const band = codeBandFootprint(out.width, S);
    if (!band) {
      out.codeBandUnavailable = true; // composition too small to host a legible code
    } else {
      const prevBottom = out.card3d ? out.card3d.y + out.card3d.h : out.map.y + out.map.h;
      const bandY = prevBottom + band.gapPx;
      out.codeBand = { x: Math.round((out.width - band.bandW) / 2), y: bandY, w: band.bandW, h: band.bandBlockH };
      const footprint = band.gapPx + band.bandBlockH;
      if (out.footer) out.footer.y += footprint;
      out.brand.y += footprint;
      out.height += footprint;
    }
  }

  return out;
}
