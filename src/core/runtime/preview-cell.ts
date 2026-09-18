/**
 * THE PREVIEW CELL: the card both map views draw where a tool is about to act.
 *
 * The design gives one 1x1 demonstration cell per tool — a translucent rounded background, four
 * corner dots, one solid centre icon — and it is NOT A TEXTURE. Over a footprint of any shape the
 * background grows to the footprint, the four dots sit at the footprint's own corners at the SAME
 * inset the 1x1 art has, and the icon stays 1x1-sized at the centre. This module is that rule, plus
 * the palette pick, as pure cell-space geometry: `canvas/map2d/layers/overlay-layer` multiplies by
 * TILE_SIZE and `canvas/map3d/scene/overlay3d` drapes the same numbers as world units, so the two
 * views cannot draw two different cards. The art itself is generated data (`preview-cell-art`).
 */
import {
  PREVIEW_CELL_ART, PREVIEW_ICON_ART, PREVIEW_PALETTES,
  type PreviewIcon, type PreviewIconArt, type PreviewPalette,
} from './preview-cell-art';

export { PREVIEW_CELL_ART, PREVIEW_ICON_ART, PREVIEW_PALETTES };
export type { PreviewIcon, PreviewIconArt, PreviewPalette };

/**
 * What a ghost is asking for: the preview card, in the state the operation is in.
 *
 * `icon` names the glyph the card carries — what is being LAID (ground/road, mountain, water) or
 * which tool is acting (eraser, trim) — and `null` is a card with no glyph at all, which is what
 * smart planting shows (a macro lays a composition, not one surface).
 */
export interface PreviewCell {
  icon: PreviewIcon | null;
  /** Whether the operation would be ACCEPTED here (the tool's own `canActAt` answer). */
  valid: boolean;
}

/** A ghost's paint: a plain tint (a placement wash) or the preview card. */
export type GhostPaint = number | PreviewCell;

export const CURVE_FOOTPRINT = { color: 0xffd75e, alpha: 0.3 } as const;

export function isPreviewCell(paint: GhostPaint): paint is PreviewCell {
  return typeof paint !== 'number';
}

export function previewPalette(cell: PreviewCell): PreviewPalette {
  return cell.valid ? PREVIEW_PALETTES.valid : PREVIEW_PALETTES.invalid;
}

/** A footprint's extent in CELLS (the card's frame). */
export interface CellBounds { x: number; y: number; w: number; h: number }

export function boundsOfCells(cells: readonly { x: number; y: number }[]): CellBounds | null {
  if (cells.length === 0) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const c of cells) {
    if (c.x < x0) x0 = c.x;
    if (c.y < y0) y0 = c.y;
    if (c.x > x1) x1 = c.x;
    if (c.y > y1) y1 = c.y;
  }
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** Same, for the span form an analytic drag shape previews as (structurally a `RowSpan`). */
export function boundsOfSpans(spans: readonly { x: number; y: number; w: number }[]): CellBounds | null {
  if (spans.length === 0) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of spans) {
    if (s.x < x0) x0 = s.x;
    if (s.y < y0) y0 = s.y;
    if (s.x + s.w - 1 > x1) x1 = s.x + s.w - 1;
    if (s.y > y1) y1 = s.y;
  }
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** Whether the footprint FILLS its bounds, so the card's background is one rounded rectangle
 *  (a brush dab, a rect drag, a single cell) rather than an irregular silhouette. */
export function isSolidRect(cellCount: number, bounds: CellBounds | null): boolean {
  return !!bounds && cellCount === bounds.w * bounds.h;
}

/** One corner dot: centre + radius, in cell units. */
export interface PreviewDot { x: number; y: number; r: number }

/**
 * The four dots at the footprint's corners. The inset is the 1x1 art's inset whatever the
 * footprint measures — the dots mark where the card's corners ARE, so scaling them with the
 * footprint would put them in the middle of a big preview.
 */
export function previewDots(bounds: CellBounds): PreviewDot[] {
  const { dotInset: inset, dotRadius: r } = PREVIEW_CELL_ART;
  const left = bounds.x + inset, right = bounds.x + bounds.w - inset;
  const top = bounds.y + inset, bottom = bounds.y + bounds.h - inset;
  return [
    { x: left, y: top, r }, { x: right, y: top, r },
    { x: left, y: bottom, r }, { x: right, y: bottom, r },
  ];
}

/** The refused state's bars run along `x + y = c`; these are the step and the bar width measured
 *  ALONG c, which is the perpendicular pitch the design gives times the diagonal. */
export const HATCH_STEP = PREVIEW_CELL_ART.hatchPeriod * Math.SQRT2;
export const HATCH_BAR = PREVIEW_CELL_ART.hatchWidth * Math.SQRT2;

/**
 * The refused state's stripes over `rects`, as convex polygons in cell units (flat x,y pairs, the
 * form a canvas path takes). The bars are anchored at the MAP's origin rather than the footprint's,
 * so they hold still while a ghost travels instead of crawling with it.
 *
 * `maxArea` bounds the work: a bar count grows with a footprint's perimeter times its rows, and past
 * a certain size the stripes stop reading as texture anyway — over that, the caller keeps the flat
 * wash alone.
 */
export function hatchBars(
  rects: readonly CellBounds[], maxArea = 400,
): number[][] {
  const area = rects.reduce((sum, r) => sum + r.w * r.h, 0);
  if (area > maxArea) return [];
  const out: number[][] = [];
  for (const r of rects) {
    const first = Math.floor((r.x + r.y) / HATCH_STEP) * HATCH_STEP;
    const last = r.x + r.w + r.y + r.h;
    for (let c = first; c <= last; c += HATCH_STEP) {
      const poly = clipToBand([r.x, r.y, r.x + r.w, r.y, r.x + r.w, r.y + r.h, r.x, r.y + r.h], c, c + HATCH_BAR);
      if (poly.length >= 6) out.push(poly);
    }
  }
  return out;
}

/** Sutherland-Hodgman clip of a convex polygon to `lo <= x + y <= hi`. */
function clipToBand(poly: number[], lo: number, hi: number): number[] {
  let cur = poly;
  for (const [sign, limit] of [[1, hi], [-1, -lo]] as const) {
    const next: number[] = [];
    const n = cur.length / 2;
    for (let i = 0; i < n; i++) {
      const ax = cur[i * 2]!, ay = cur[i * 2 + 1]!;
      const bx = cur[((i + 1) % n) * 2]!, by = cur[((i + 1) % n) * 2 + 1]!;
      const da = sign * (ax + ay) - limit, db = sign * (bx + by) - limit;
      if (da <= 0) next.push(ax, ay);
      if ((da < 0 && db > 0) || (da > 0 && db < 0)) {
        const t = da / (da - db);
        next.push(ax + (bx - ax) * t, ay + (by - ay) * t);
      }
    }
    cur = next;
    if (cur.length === 0) return [];
  }
  return cur;
}

/** The icon's rect, in cell units: its authored size, centred on the footprint. */
export function previewIconRect(bounds: CellBounds, icon: PreviewIcon): CellBounds {
  const art = PREVIEW_ICON_ART[icon];
  return {
    x: bounds.x + bounds.w / 2 - art.w / 2,
    y: bounds.y + bounds.h / 2 - art.h / 2,
    w: art.w,
    h: art.h,
  };
}
