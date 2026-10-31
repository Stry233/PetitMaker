/**
 * The magnifier a touch press shows: the map around the finger, enlarged in a circle above it, so
 * the cells a fingertip covers stay visible. The page has one; whichever view the press is on shows
 * it with its own canvas as the source, and the interface draws the circle and its ring
 * (`ui/chrome/floating/MapLoupe.tsx`) from this module's state.
 *
 * Each source reports its frames (`loupeFramePainted`). One that can draw the circle's square of its
 * scene at the loupe's own device pixels (`renderRegion`, the 2D view on WebGL) does so once per
 * frame it reports, so the circle is as sharp as the map at that scale; enlarging drawn pixels would
 * blur them by the magnification and any resolution cap. Any other source, or one whose drawing
 * fails, lends the pixels it drew: a WebGL canvas without a preserved drawing buffer is readable only
 * in the task that drew it, so the loupe keeps the pixels around the finger from each reported frame,
 * and a finger that moves past them asks for another.
 * Nothing here draws into the map canvas, so no capture or export of the map shows the loupe.
 */
import { createSignal } from '../../../core/base/signal';
import { viewportRect, viewportSize } from '../../../platform/device/viewport-space';

/** The loupe's geometry, in layout px. */
export const LOUPE = {
  /** The magnified circle's radius, inside its ring. */
  radius: 64,
  /** The ring around the circle. */
  ring: 4,
  /** How far above the finger the circle's centre stands. */
  lift: 96,
  /** Magnification of the map under the finger: the circle shows 128 / 1.25 = about 102 layout px
   *  of map, a fingertip's pad and about two placement cells on each side at a working zoom whose
   *  cells stand about 13 px. */
  zoom: 1.25,
} as const;

/** The edge of the loupe from its centre, ring included. */
export const LOUPE_OUTER = LOUPE.radius + LOUPE.ring;
/** The map around the finger the circle shows, as a half side in layout px. */
const SEEN = LOUPE.radius / LOUPE.zoom;
/** Pixels kept beyond what the circle shows, so a finger moving between frames stays covered. */
const KEPT = SEEN + LOUPE.radius;

type Point = { x: number; y: number };

/** A map view's canvas as the loupe's source. */
export interface LoupeSource {
  readonly canvas: HTMLCanvasElement;
  /** Asks for a frame, which arrives through `loupeFramePainted`. */
  requestFrame(): void;
  /** Draws the scene of the frame being reported into a square of `outPx` device px: the square of
   *  the canvas whose top left is (`x`, `y`) and whose side is `side`, in layout px. Null falls back
   *  to the frame's own pixels. */
  renderRegion?(region: { x: number; y: number; side: number }, outPx: number): CanvasImageSource | null;
  /** Frees what `renderRegion` keeps, once the loupe has gone. */
  releaseRegion?(): void;
}

/** The pixels kept from the source's last frame: a square of `canvas` whose top left lies at
 *  layout point (`left`, `top`), at `scale` device px per layout px. */
interface Kept { canvas: HTMLCanvasElement; left: number; top: number; scale: number; size: number }

/** `rendered`: the source's own drawing of the circle's map at its last reported frame. */
interface Shown { source: LoupeSource; at: Point; kept: Kept | null; rendered: CanvasImageSource | null }

/** Device px per layout px the circle was last painted at, which the source's own drawing matches. */
let paintRatio = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;

let shown: Shown | null = null;
/** Counts every change, so a subscriber can tell whether it missed one. */
const changed = createSignal(0);
const bump = (): void => changed.emit(changed.get() + 1);

/** Shows the loupe over `at`, the layout point under the finger, magnifying `source`'s frame. */
export function showLoupe(source: LoupeSource, at: Point): void {
  const moved = shown?.source !== source || shown.at.x !== at.x || shown.at.y !== at.y;
  if (shown?.source !== source) { shown?.source.releaseRegion?.(); shown = { source, at, kept: null, rendered: null }; }
  else shown.at = at;
  if (shown.rendered ? moved : !covers(shown.kept, at)) source.requestFrame();
  bump();
}

export function hideLoupe(): void {
  if (!shown) return;
  shown.source.releaseRegion?.();
  shown = null;
  bump();
}

/** `source` will draw no more frames: a loupe over it goes. */
export function releaseLoupeSource(source: LoupeSource): void {
  if (shown?.source === source) hideLoupe();
}

/** `source` has a frame: one that draws its own square draws the circle's map of it now; otherwise
 *  the frame's pixels are readable and the loupe keeps those around the finger. */
export function loupeFramePainted(source: LoupeSource): void {
  if (shown?.source !== source) return;
  shown.rendered = renderedRegion(shown, Math.round(2 * LOUPE.radius * paintRatio));
  if (!shown.rendered) shown.kept = keep(source.canvas, shown.at, shown.kept);
  bump();
}

/** Where the loupe's centre stands in layout px: above the finger, kept whole inside the viewport.
 *  Null while hidden. */
export function loupeCentre(): Point | null {
  if (!shown) return null;
  const { width, height } = viewportSize();
  const clamp = (v: number, max: number) => Math.min(Math.max(v, LOUPE_OUTER), Math.max(LOUPE_OUTER, max - LOUPE_OUTER));
  return { x: clamp(shown.at.x, width), y: clamp(shown.at.y - LOUPE.lift, height) };
}

export function onLoupeChange(listener: () => void): () => void {
  return changed.subscribe(() => listener());
}

/** A number that changes with every change to the loupe. */
export function loupeVersion(): number {
  return changed.get();
}

/** Paints the magnified map into `target`, a square canvas `2 * radius` layout px wide drawn at
 *  `pixelRatio`. Leaves it clear until the source has drawn a frame since the loupe showed. */
export function paintLoupe(target: HTMLCanvasElement, pixelRatio: number): void {
  if (!shown) return;
  if (pixelRatio !== paintRatio) { paintRatio = pixelRatio; shown.source.requestFrame(); }
  const side = Math.round(2 * LOUPE.radius * pixelRatio);
  const { rendered, kept } = shown;
  if (!rendered && !kept) return;
  if (target.width !== side) target.width = side;
  if (target.height !== side) target.height = side;
  const ctx = target.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, side, side);
  if (rendered) { ctx.drawImage(rendered, 0, 0, side, side); return; }
  if (!kept) return;
  drawWithin(ctx, kept.canvas, {
    x: (shown.at.x - SEEN - kept.left) * kept.scale, y: (shown.at.y - SEEN - kept.top) * kept.scale, side: 2 * SEEN * kept.scale,
  }, side);
}

/** The circle's map drawn by the source itself at `side` device px, or null where it offers none. */
function renderedRegion({ source, at }: Shown, side: number): CanvasImageSource | null {
  if (!source.renderRegion) return null;
  const rect = viewportRect(source.canvas);
  if (rect.width <= 0) return null;
  return source.renderRegion({ x: at.x - SEEN - rect.left, y: at.y - SEEN - rect.top, side: 2 * SEEN }, side);
}

/** Whether `kept` holds everything the circle shows around `at`. */
function covers(kept: Kept | null, at: Point): boolean {
  if (!kept) return false;
  const side = kept.size / kept.scale;
  return at.x - SEEN >= kept.left && at.y - SEEN >= kept.top && at.x + SEEN <= kept.left + side && at.y + SEEN <= kept.top + side;
}

/** Copies the square of `source` around `at` into `reuse`'s canvas, or a new one. */
function keep(source: HTMLCanvasElement, at: Point, reuse: Kept | null): Kept | null {
  const rect = viewportRect(source);
  if (rect.width <= 0 || source.width <= 0) return null;
  const scale = source.width / rect.width;
  const size = Math.ceil(2 * KEPT * scale);
  const canvas = reuse?.canvas ?? document.createElement('canvas');
  if (canvas.width !== size) canvas.width = size;
  if (canvas.height !== size) canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const left = at.x - KEPT, top = at.y - KEPT;
  ctx.clearRect(0, 0, size, size);
  drawWithin(ctx, source, { x: (left - rect.left) * scale, y: (top - rect.top) * scale, side: size }, size);
  return { canvas, left, top, scale, size };
}

/**
 * Draws the square `read` of `source` into the square (0, 0) to `out` of `ctx`. Older WebKit and Gecko draw nothing for a source rect reaching past the canvas, so the
 * read is cut to the canvas and the part outside stays clear, each pixel landing where it would
 * have.
 */
function drawWithin(ctx: CanvasRenderingContext2D, source: HTMLCanvasElement, read: { x: number; y: number; side: number }, out: number): void {
  const { x: sx, y: sy, side } = read;
  const x0 = Math.max(0, sx), y0 = Math.max(0, sy);
  const x1 = Math.min(source.width, sx + side), y1 = Math.min(source.height, sy + side);
  if (x1 <= x0 || y1 <= y0) return;
  const k = out / side;
  ctx.drawImage(source, x0, y0, x1 - x0, y1 - y0, (x0 - sx) * k, (y0 - sy) * k, (x1 - x0) * k, (y1 - y0) * k);
}
