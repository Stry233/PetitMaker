/**
 * Turns a CursorId into a CSS `cursor` value: an encoded SVG data URI, the hotspot, and a
 * keyword fallback.
 *
 * The trailing keyword is required by the CSS grammar, and is what the browser falls back to if
 * the image is unusable. Values are memoised; the controller asks for one on every hover change.
 */
import { cursorSvg } from './cursor-art';
import { CURSORS, type CursorId } from '../../core/runtime/cursor-spec';

const cache = new Map<string, string>();

/**
 * When on, every id resolves to its bare keyword, so the OS draws the cursors and they follow
 * the size and theme the user configured there — which an image cursor cannot. Published by
 * `ui/cursors/cursor-vars` from the store; a module flag so callers on the pointer path and in
 * components need not thread it.
 */
let systemCursors = false;

/** Publish the preference. Idempotent. */
export function setSystemCursors(on: boolean): void {
  systemCursors = on;
}

/** Percent-encode an SVG for a data URI. `#` is the one that silently truncates. */
function encodeSvg(svg: string): string {
  return svg
    // Whitespace collapses to a SPACE, never to nothing: newlines and indentation are what
    // separate SVG attributes, so deleting one would fuse two of them into gibberish.
    .replace(/\s+/g, ' ')
    .replace(/%/g, '%25')
    .replace(/#/g, '%23')
    .replace(/</g, '%3C')
    .replace(/>/g, '%3E')
    .replace(/"/g, "'");
}

export function cursorCss(id: CursorId, opts: { forbidden?: boolean; system?: boolean } = {}): string {
  const { hotspot, fallback } = CURSORS[id];
  // Ahead of the cache, so the memo only ever holds url values and a preference flip cannot
  // return a stale one. `opts.system` lets a React caller pass the value it is subscribed to,
  // which is fresher than the module flag during that render.
  if (opts.system ?? systemCursors) return fallback;

  const forbidden = opts.forbidden === true;
  const key = `${id}:${forbidden}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;

  const svg = cursorSvg(id, { forbidden });
  const value = svg === null
    ? fallback
    : `url("data:image/svg+xml,${encodeSvg(svg)}") ${hotspot[0]} ${hotspot[1]}, ${fallback}`;
  cache.set(key, value);
  return value;
}

/** Test-only: drop the memo so a test can observe rebuilding. */
export function __clearCursorCssCache(): void {
  cache.clear();
}
