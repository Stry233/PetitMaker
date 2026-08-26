/**
 * Turns a CursorId into a CSS `cursor` value: the image, the hotspot, and a keyword fallback.
 *
 * This is the ONE place an id becomes art, so both canvases, the DOM custom properties and every
 * component that styles itself follow the same set and the same preference without branching of
 * their own.
 *
 * The trailing keyword is required by the CSS grammar, and is what the browser falls back to if
 * the image is unusable. Values are memoised; the controller asks for one on every hover change.
 *
 * EVERY CURSOR IS ONE SVG at an intrinsic 32px, and the value wraps it as
 * `image-set(url(…) <density>)` where the engine reads image-set in `cursor`. What the density
 * does to a VECTOR cursor is the one thing the engines disagree on, so the density is per-engine
 * and this header is where the verified facts live:
 *
 * - BLINK AND WEBKIT DIVIDE THE DRAWN SIZE BY THE DENSITY, vector or not, and rasterise an SVG
 *   at the screen's own scale first (Blink `event_handler.cc` SelectCursor multiplies the SVG's
 *   raster scale by the device scale factor and divides both the drawn size and the 32px
 *   fallback cap by the image-set scale; WebKit `EventHandler.cpp` selectCursor mirrors it).
 *   So a 32px SVG declared 2x drew 16 CSS px on every retina screen (observed: Chrome and
 *   Safari on a dpr-2 Mac), and 1x is the one density that draws the intrinsic 32 at 32 CSS px
 *   on every screen — sharp at dpr 2 and at the fractional Windows scales alike, because the
 *   vector is rasterised at the live device scale, not at the declared density.
 * - GECKO SIZES A VECTOR CURSOR AT ITS INTRINSIC WIDTH WHATEVER THE DENSITY (the css-images-4
 *   reading: a resolution divides pixel dimensions, which a vector image does not have), and
 *   reads the density as a pure RASTERISATION hint that is LOAD-BEARING: a plain url rasterises
 *   soft whenever the hovered element stands under CSS zoom (the app's chrome always does),
 *   while 2x rasterises sharp at every zoom probed and matches the resolution the embedded
 *   painted renders carry; a fractional density rasterises slightly soft (Firefox 152 at
 *   dpr 2). Gecko is told apart by the `-moz-appearance` alias only it parses
 *   (probed: Firefox 154 true, Chrome 151 false), and an engine the probe does not recognise
 *   gets 1x, the density that can never change the drawn size.
 *
 * NO ENGINE scales a cursor's drawn size by the element's CSS zoom, and the hotspot stays in the
 * intrinsic 32px grid in every engine at either density.
 *
 * A browser without image-set in `cursor` gets the plain url — right size, engine-chosen
 * sharpness — because a value the engine cannot parse is a DROPPED declaration and the element
 * would fall back to the platform arrow rather than to our art.
 *
 * `busy` is the one ANIMATED cursor: a long operation is running, and a static custom cursor
 * reads as stuck, so the art is a frame ring (`busyFrame`) the controller cycles while the state
 * holds. `frame` picks one; the plain ask resolves frame 0.
 */
import { busyFrame, cursorArt } from './cursor-art';
import { classicCursorArt } from './cursor-art-classic';
import { USE_CLASSIC_CURSORS } from './cursor-set';
import { CURSORS, type CursorId } from '../../core/runtime/cursor-spec';

const cache = new Map<string, string>();

/**
 * When on, every id resolves to its bare keyword, so the OS draws the cursors and they follow
 * the size and theme the user configured there — which an image cursor cannot. Published by
 * `ui/design/cursors/cursor-vars` from the store; a module flag so callers on the pointer path and in
 * components need not thread it.
 */
let systemCursors = false;

/** Publish the preference. Idempotent. */
export function setSystemCursors(on: boolean): void {
  systemCursors = on;
}

/** The live preference, for the one resolver decision that depends on it (the controller's
 *  system-mode pan). */
export function isSystemCursors(): boolean {
  return systemCursors;
}

export function cursorCss(
  id: CursorId,
  opts: { forbidden?: boolean; system?: boolean; frame?: number } = {},
): string {
  const { fallback } = CURSORS[id];
  // Ahead of the cache, so the memo only ever holds url values and a preference flip cannot
  // return a stale one. `opts.system` lets a React caller pass the value it is subscribed to,
  // which is fresher than the module flag during that render.
  if (opts.system ?? systemCursors) return fallback;

  const forbidden = opts.forbidden === true;
  const frame = id === 'busy' ? (opts.frame ?? 0) : 0;
  const key = `${id}:${forbidden}:${frame}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;

  // The two sets are drawn independently, so each carries its own hotspot; an id the classic set
  // never had falls through to the generated art rather than losing its cursor.
  const classic = USE_CLASSIC_CURSORS ? classicCursorArt(id, { forbidden }) : null;
  const url = classic?.url ?? (id === 'busy' ? busyFrame(frame) : cursorArt(id, { forbidden }));
  let value: string;
  if (url === null) {
    value = fallback;
  } else {
    // The hotspot is in CSS pixels of the intrinsic 32, whatever scale the engine rasterises at.
    const [hx, hy] = classic?.hotspot ?? CURSORS[id].hotspot;
    const fn = imageSetFn();
    value = fn !== null
      ? `${fn}(url("${url}") ${svgDensity()}) ${hx} ${hy}, ${fallback}`
      : `url("${url}") ${hx} ${hy}, ${fallback}`;
  }
  cache.set(key, value);
  return value;
}

/**
 * The `image-set` spelling this engine accepts inside `cursor`, or null if it accepts neither.
 *
 * Asked once and remembered: the answer cannot change for the life of the document, and the
 * controller resolves a value on every hover change. Absent `CSS.supports` (a non-browser
 * environment) the answer is null, which is the plain-url value every reader already handles.
 */
let imageSet: string | null | undefined;
function imageSetFn(): string | null {
  if (imageSet !== undefined) return imageSet;
  imageSet = null;
  if (typeof CSS !== 'undefined' && typeof CSS.supports === 'function') {
    for (const fn of ['image-set', '-webkit-image-set']) {
      if (CSS.supports('cursor', `${fn}(url("a.png") 1x, url("b.png") 2x) 0 0, auto`)) {
        imageSet = fn;
        break;
      }
    }
  }
  return imageSet;
}

/**
 * The image-set density this engine should be handed, per the header's facts: 2x on Gecko, where
 * it is the rasterisation hint that keeps the art sharp under CSS zoom, and 1x everywhere else,
 * where it divides the drawn size. Memoised like the spelling, for the same reason.
 */
let density: '1x' | '2x' | undefined;
function svgDensity(): '1x' | '2x' {
  if (density !== undefined) return density;
  density = typeof CSS !== 'undefined' && typeof CSS.supports === 'function'
    && CSS.supports('-moz-appearance', 'none') ? '2x' : '1x';
  return density;
}

/** Test-only: drop the memo so a test can observe rebuilding. */
export function __clearCursorCssCache(): void {
  cache.clear();
  imageSet = undefined;
  density = undefined;
}
