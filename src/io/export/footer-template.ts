// Pure footer-template model for the export footer line. A template is a small string of literal
// text and {tokens}; the special {fill} token splits it into a LEFT-aligned and a RIGHT-aligned
// part (so the footer can read e.g. "Map name ............ 2026-06-28 · 1600×1080"). Tokens resolve
// to live map facts at paint time. No DOM here — the editor and the painter both build on this.

export interface FooterToken { id: string; labelKey: string }

/** The fill token id — everything after it is right-aligned. */
export const FOOTER_FILL = 'fill';

/** Insertable info tokens (the scroll menu lists these with their current value). */
export const FOOTER_TOKENS: FooterToken[] = [
  { id: 'date', labelKey: 'export.tok_date' },
  { id: 'time', labelKey: 'export.tok_time' },
  { id: 'weekday', labelKey: 'export.tok_weekday' },
  { id: 'name', labelKey: 'export.tok_name' },
  { id: 'dims', labelKey: 'export.tok_dims' },
  { id: 'cells', labelKey: 'export.tok_cells' },
  { id: 'layers', labelKey: 'export.tok_layers' },
  { id: 'objects', labelKey: 'export.tok_objects' },
  { id: 'peak', labelKey: 'export.tok_peak' },
  { id: 'title', labelKey: 'export.tok_title' },
  { id: 'brand', labelKey: 'export.tok_brand' },
  { id: 'seed', labelKey: 'export.tok_seed' },
  { id: 'ai', labelKey: 'export.tok_ai' },
  { id: 'proc', labelKey: 'export.tok_proc' },
];

/** Default footer: date on the left, dimensions on the right (no separator between fill and dims). */
export const DEFAULT_FOOTER = '{date}{fill}{dims}';

/** Format a date as YYYY-MM-DD for the footer's {date} token (shared by painter + editor sample). */
export function formatFooterDate(d: Date = new Date()): string {
  return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');
}

export type FooterSeg = { t: 'text'; v: string } | { t: 'token'; id: string };

/** Parse a template into ordered segments (literal text + tokens, incl. {fill}). */
export function parseFooter(tpl: string): FooterSeg[] {
  const segs: FooterSeg[] = [];
  const re = /\{(\w+)\}/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(tpl))) {
    if (m.index > last) segs.push({ t: 'text', v: tpl.slice(last, m.index) });
    segs.push({ t: 'token', id: m[1]! });
    last = re.lastIndex;
  }
  if (last < tpl.length) segs.push({ t: 'text', v: tpl.slice(last) });
  return segs;
}

/** Serialize segments back to a template string (literal braces are not allowed in text). */
export function serializeFooter(segs: FooterSeg[]): string {
  return segs.map((s) => (s.t === 'text' ? s.v.replace(/[{}]/g, '') : `{${s.id}}`)).join('');
}

/** Resolve a template to its left/right-aligned strings, substituting token values. Unknown tokens
 *  and tokens with an empty value drop out (so a missing title doesn't leave a gap). */
export function resolveFooter(tpl: string, values: Record<string, string>): { left: string; right: string } {
  let left = '';
  let right = '';
  let side: 'left' | 'right' = 'left';
  for (const s of parseFooter(tpl)) {
    if (s.t === 'token' && s.id === FOOTER_FILL) { side = 'right'; continue; }
    // Own-property only: a template token may name an Object.prototype member.
    const piece = s.t === 'text' ? s.v : (Object.prototype.hasOwnProperty.call(values, s.id) ? values[s.id] ?? '' : '');
    if (side === 'left') left += piece; else right += piece;
  }
  return { left: left.trim(), right: right.trim() };
}
