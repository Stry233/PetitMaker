/**
 * The preview cell's two rasters, drawn ONCE and shared by both map views: the centre icon, and the
 * refused state's stripe tile.
 *
 * The art is vector (`core/runtime/preview-cell-art`), and a Path2D drawn into a canvas is the one
 * place it becomes pixels — the 2D painter wraps these as a PIXI texture and the 3D overlay as a
 * three CanvasTexture, so the glyph on the map is the same glyph in either view. Everything is
 * memoized: a ghost rebuilds on every pointer move and must allocate nothing.
 *
 * Both entry points return null where there is no canvas to draw into (a jsdom test run), which each
 * view treats as "no icon this frame" rather than as an error.
 */
import { PREVIEW_ICON_ART, type PreviewIcon, type PreviewPalette, PREVIEW_CELL_ART } from '../core/runtime/preview-cell';

/** Icon raster resolution per CELL. The glyph covers about half a cell, so this draws it at ~140px
 *  against the ~64px it occupies on screen at rest — crisp when the camera is zoomed in. */
const ICON_PX = 256;

/** The stripe tile spans THREE cells, and 7 diagonal repeats across it: a 45-degree pattern tiles
 *  seamlessly only when the tile's side is a whole number of diagonal periods, and 3 cells / 7 is
 *  the closest such pitch to the design's own (0.303 vs 0.306 cells). */
const HATCH_CELLS = 3;
const HATCH_REPEATS = 7;
/** Power of two: a WebGL1 context (the Canvas2D-fallback build's ceiling) cannot repeat a texture
 *  whose dimensions are not. */
const HATCH_PX = 256;

export { HATCH_CELLS };

function makeCanvas(w: number, h: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null {
  if (typeof document === 'undefined' || typeof Path2D === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w));
  canvas.height = Math.max(1, Math.round(h));
  const ctx = canvas.getContext('2d');
  return ctx ? { canvas, ctx } : null;
}

function cssHex(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

const iconCache = new Map<PreviewIcon, HTMLCanvasElement | null>();

/**
 * The icon as an opaque-white glyph on transparency, at its authored aspect.
 *
 * A part the design SUBTRACTS is punched out with `destination-out` rather than folded into one
 * even-odd path: the design's parts are sequential path operations, and two overlapping additive
 * parts (the eraser's body and its tip) would cancel each other under an even-odd rule.
 */
export function previewIconCanvas(icon: PreviewIcon): HTMLCanvasElement | null {
  const hit = iconCache.get(icon);
  if (hit !== undefined) return hit;
  const art = PREVIEW_ICON_ART[icon];
  const made = makeCanvas(art.w * ICON_PX, art.h * ICON_PX);
  if (!made) { iconCache.set(icon, null); return null; }
  const { canvas, ctx } = made;
  // The paths are centred on (0, 0) in cell fractions; move that centre to the middle of the raster.
  ctx.setTransform(ICON_PX, 0, 0, ICON_PX, canvas.width / 2, canvas.height / 2);
  for (const part of art.parts) {
    const path = new Path2D(part.d);
    ctx.globalCompositeOperation = part.hole ? 'destination-out' : 'source-over';
    ctx.globalAlpha = part.hole ? 1 : (part.alpha ?? 1);
    ctx.fillStyle = '#ffffff';
    ctx.fill(path);
  }
  iconCache.set(icon, canvas);
  return canvas;
}

const hatchCache = new Map<number, HTMLCanvasElement | null>();

/**
 * The refused state's background as a tile: its flat colour with the design's 45-degree bars over
 * it, both opaque, so a view fills the footprint with ONE texture at the palette's alpha. Keyed by
 * the palette's two colours; a palette with no stripes has no tile and fills flat.
 */
export function previewHatchCanvas(palette: PreviewPalette): HTMLCanvasElement | null {
  if (palette.hatch === undefined) return null;
  const key = palette.bg * 0x1000000 + palette.hatch;
  const hit = hatchCache.get(key);
  if (hit !== undefined) return hit;
  const made = makeCanvas(HATCH_PX, HATCH_PX);
  if (!made) { hatchCache.set(key, null); return null; }
  const { canvas, ctx } = made;
  ctx.fillStyle = cssHex(palette.bg);
  ctx.fillRect(0, 0, HATCH_PX, HATCH_PX);
  ctx.fillStyle = cssHex(palette.hatch);
  // Bars run along x + y = c. The pitch is measured PERPENDICULAR to them, so a step of one period
  // along c is that distance times sqrt(2).
  const pitch = (HATCH_PX * 2) / (HATCH_REPEATS * 2);
  const bar = pitch * (PREVIEW_CELL_ART.hatchWidth / PREVIEW_CELL_ART.hatchPeriod);
  for (let c = -pitch; c <= HATCH_PX * 2 + pitch; c += pitch) {
    ctx.beginPath();
    ctx.moveTo(c, 0);
    ctx.lineTo(c + bar, 0);
    ctx.lineTo(c + bar - HATCH_PX * 2, HATCH_PX * 2);
    ctx.lineTo(c - HATCH_PX * 2, HATCH_PX * 2);
    ctx.closePath();
    ctx.fill();
  }
  hatchCache.set(key, canvas);
  return canvas;
}
