import { hasShareCode, type Badge, type ExportComposition, type ExportOptions, type Rect, type ResolutionKey } from './types';
import { canvasFitScale, type PixelSize } from './sizing';
import { moduleBaseFor, bandSize } from '../share/glyph/geometry';
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
const CODE_LABEL_H = 20;                               // PetitGlyph label above the code band
const FOOTER_H = 40;                                   // footer band
const COL_GAP = 16;                                    // gap between map and layer area
const SUB_COL_W = 148;                                 // width of one layer sub-column
/** Gap between stacked layer sub-columns (shared with paint). */
export const COL_GAP_INNER = 10;
/** Layers per sub-column before wrapping to the next column on the right (shared with paint). */
export const MAX_PER_COL = 5;

// The map+column content row height tracks the map's natural aspect, clamped readable.
const CONTENT_MIN_RATIO = 0.42;   // of inner width
const CONTENT_MAX_RATIO = 0.64;

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
  ctx: { layerCount: number; mapPx?: PixelSize },
): ExportComposition {
  const innerW = BASE_WIDTH - PAD * 2;
  const aspect = mapAspect > 0 ? mapAspect : 1.2;

  const showBadge = opts.showBadge && badges.length > 0;
  const hasHeader = !!opts.title || !!opts.description || showBadge;
  const headerH = hasHeader ? ((opts.title ? TITLE_H : 0) + (opts.description ? DESC_H : 0) || BADGE_ONLY_H) : 0;

  // Layer area: stacked sub-columns on the right (wraps to a 2nd/3rd column past MAX_PER_COL),
  // map fills the rest.
  const nCols = opts.layerPreview ? Math.max(1, Math.ceil(ctx.layerCount / MAX_PER_COL)) : 0;
  const layerAreaW = opts.layerPreview ? nCols * SUB_COL_W + (nCols - 1) * COL_GAP_INNER : 0;
  const mapW = opts.layerPreview ? innerW - layerAreaW - COL_GAP : innerW;
  // Content height follows the MAP's natural aspect (so it fills its band, minimal letterbox),
  // clamped to a balanced range so the map is never oversized or a thin slice.
  const contentH = Math.round(Math.min(innerW * CONTENT_MAX_RATIO, Math.max(innerW * CONTENT_MIN_RATIO, mapW / aspect)));

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
  const baseH = y + PAD;

  // Output width: presets are fixed; Native uses the map's native pixel width (≥ High as a floor)
  // so the image is full-resolution while keeping the identical layout ratio.
  let width = opts.resolution === 'original' && ctx.mapPx
    ? Math.max(RESOLUTION_WIDTHS.high, ctx.mapPx.w)
    : RESOLUTION_WIDTHS[opts.resolution];
  let S = width / BASE_WIDTH;
  const f = canvasFitScale(width, baseH * S); // uniformly shrink if it would exceed canvas limits
  width *= f; S *= f;

  const out: ExportComposition = {
    width: Math.round(width), height: Math.round(baseH * S), scale: S,
    map: scaleRect(baseRects.map!, S), badges: showBadge ? badges : [],
  };
  for (const k of ['header', 'layerLabel', 'layerCol', 'card3d', 'footer'] as const) {
    if (baseRects[k]) out[k] = scaleRect(baseRects[k]!, S);
  }

  // Code band: EXACT pixel geometry driven by the FINAL (post-f) width, never scaled through
  // scaleRect — a share code's modules must land on whole device pixels (see glyph/geometry.ts),
  // so its size is derived straight from moduleBaseFor(out.width) instead of the BASE-800 layout.
  if (hasShareCode(opts)) {
    // The band sits at the same PAD as everything else. Its module base comes from the INSET
    // width, so it is painted at a whole number of device pixels and never scaled to fit a
    // margin — scaling is what would soften its modules.
    const padPx = Math.round(PAD * S);
    const mb = moduleBaseFor(out.width - 2 * padPx);
    if (mb === null) {
      out.codeBandUnavailable = true; // composition too small to host a legible code
    } else {
      const { width: bandW, height: mosaicH } = bandSize(mb);
      const gapPx = Math.round(GAP * S);
      const bandBlockH = Math.round(CODE_LABEL_H * S + mosaicH);
      const prevBottom = out.card3d ? out.card3d.y + out.card3d.h : out.map.y + out.map.h;
      const bandY = prevBottom + gapPx;
      out.codeBand = { x: Math.round((out.width - bandW) / 2), y: bandY, w: bandW, h: bandBlockH };
      const footprint = gapPx + bandBlockH;
      if (out.footer) out.footer.y += footprint;
      out.height += footprint;
    }
  }

  return out;
}
