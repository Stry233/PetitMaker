/**
 * Resolves a cursor id to memoized SVG art, hotspot, and required keyword fallback. Blink and WebKit
 * divide SVG display size by `image-set` density, so they use 1x; Gecko preserves intrinsic vector
 * size and uses 2x for sharp rasterization under CSS zoom. Unsupported engines receive a plain URL.
 * Hotspots always use the intrinsic 32-pixel grid. `busy` selects an animated frame.
 */
import { busyFrame, cursorArt } from './cursor-art';
import { CURSORS, type CursorId } from './cursor-spec';

const cache = new Map<string, string>();

/**
 * `opts.system` is the user's system-cursors preference (`state/slices/prefs.ts:systemCursors`):
 * on, every id resolves to its bare keyword, so the OS draws the cursors at the size and theme the
 * user configured there, which an image cursor cannot follow.
 */
export function cursorCss(
  id: CursorId,
  opts: { forbidden?: boolean; system?: boolean; frame?: number } = {},
): string {
  const { fallback } = CURSORS[id];
  // Ahead of the cache, so the memo only ever holds url values and a preference flip cannot
  // return a stale one.
  if (opts.system === true) return fallback;

  const forbidden = opts.forbidden === true;
  const frame = id === 'busy' ? (opts.frame ?? 0) : 0;
  const key = `${id}:${forbidden}:${frame}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;

  const url = id === 'busy' ? busyFrame(frame) : cursorArt(id, { forbidden });
  let value: string;
  if (url === null) {
    value = fallback;
  } else {
    // The hotspot is in CSS pixels of the intrinsic 32, whatever scale the engine rasterises at.
    const [hx, hy] = CURSORS[id].hotspot;
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
