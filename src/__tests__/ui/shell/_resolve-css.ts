/**
 * Resolves the frame's css room expressions (`panelTop`, `panelMaxHeight`, `deskSeatInset`) to
 * numbers, since jsdom holds the strings but lays nothing out. The grammar is closed: `calc`, `min`,
 * `max`, `clamp`, `var()`, `100vh` and px constants. Shared by the column-room and character-seat
 * suites so both read one resolver.
 */
import { fittedUiScale } from '../../../ui/design/scale';
import { ZOOM } from '../../../ui/shell/units';

/** Where the parenthesis opened at `open` closes. */
function closeOf(css: string, open: number): number {
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === '(') depth++;
    else if (css[i] === ')' && --depth === 0) return i;
  }
  throw new Error(`unbalanced parentheses in ${css}`);
}

/** The first comma at the top level of `s`, or -1: a `var()`'s fallback starts after it, and the
 *  fallback may itself be a function full of commas. */
function topComma(s: string): number {
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '(') depth++;
    else if (s[i] === ')') depth--;
    else if (s[i] === ',' && depth === 0) return i;
  }
  return -1;
}

/** Every `var(--name[, fallback])` replaced by the held value, else by its fallback, as a browser does. */
function substituteVars(css: string, vars: Record<string, string>): string {
  for (;;) {
    const at = css.indexOf('var(');
    if (at < 0) return css;
    const end = closeOf(css, at + 3);
    const inner = css.slice(at + 4, end);
    const comma = topComma(inner);
    const name = (comma < 0 ? inner : inner.slice(0, comma)).trim();
    const fallback = comma < 0 ? undefined : inner.slice(comma + 1).trim();
    const held = vars[name] ?? fallback;
    if (held === undefined) throw new Error(`no value and no fallback for ${name}`);
    css = `${css.slice(0, at)}(${held})${css.slice(end + 1)}`;
  }
}

export function resolveCss(
  css: string, vh: number, zoom: number, vars: Record<string, string> = {},
): number {
  const js = substituteVars(css, { '--shell-zoom': String(zoom), ...vars })
    .replace(/100vh/g, String(vh))
    .replace(/calc\(/g, '(')
    .replace(/(\d*\.?\d+)px/g, '$1')
    .replace(/\b(min|max|clamp)\(/g, (_m, fn: string) => (fn === 'clamp' ? 'CLAMP(' : `Math.${fn}(`));
  const clamp = (lo: number, v: number, hi: number) => Math.min(Math.max(v, lo), hi);
  return (new Function('CLAMP', `return ${js};`) as (c: typeof clamp) => number)(clamp);
}

/** The frame's zoom at a window: the authored page zoom times the window fit and the user's Ctrl +/-
 *  preference. A viewport unit inside the frame divides it back out. */
export function frameZoom(vw: number, vh: number, uiZoom: number): number {
  return ZOOM * fittedUiScale(vw, vh, uiZoom);
}
