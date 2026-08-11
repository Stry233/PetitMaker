/**
 * Turns a CursorId into a CSS `cursor` value: the image URL, the hotspot, and a keyword
 * fallback.
 *
 * This is the ONE place an id becomes art, so both canvases, the DOM custom properties and every
 * component that styles itself follow the same set and the same preference without branching of
 * their own.
 *
 * The trailing keyword is required by the CSS grammar, and is what the browser falls back to if
 * the image is unusable. Values are memoised; the controller asks for one on every hover change.
 */
import { cursorArt } from './cursor-art';
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

export function cursorCss(
  id: CursorId,
  opts: { forbidden?: boolean; system?: boolean } = {},
): string {
  const { hotspot, fallback } = CURSORS[id];
  // Ahead of the cache, so the memo only ever holds url values and a preference flip cannot
  // return a stale one. `opts.system` lets a React caller pass the value it is subscribed to,
  // which is fresher than the module flag during that render.
  if (opts.system ?? systemCursors) return fallback;

  const forbidden = opts.forbidden === true;
  const key = `${id}:${forbidden}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;

  // The two sets are drawn independently, so each carries its own hotspot; an id the classic set
  // never had falls through to the pixel art rather than losing its cursor.
  const art = (USE_CLASSIC_CURSORS ? classicCursorArt(id, { forbidden }) : null)
    ?? pixelArt(id, forbidden, hotspot);
  const value = art === null
    ? fallback
    : `url("${art.url}") ${art.hotspot[0]} ${art.hotspot[1]}, ${fallback}`;
  cache.set(key, value);
  return value;
}

function pixelArt(
  id: CursorId,
  forbidden: boolean,
  hotspot: readonly [number, number],
): { url: string; hotspot: readonly [number, number] } | null {
  const url = cursorArt(id, { forbidden });
  return url === null ? null : { url, hotspot };
}

/** Test-only: drop the memo so a test can observe rebuilding. */
export function __clearCursorCssCache(): void {
  cache.clear();
}
