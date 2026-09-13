import { parseFooter, resolveFooter } from '../../export/footer-template';
import type { ExportOptions } from '../../export/types';

export type TextField = 'title' | 'description' | 'footer' | 'author';
export type TextPart = { field: TextField; text: string; segments?: string[] };
export type Restriction = 'content' | 'political' | 'website';
export type ReviewResult = { allowed: true } | { allowed: false; reason: Restriction; fields: TextField[] };
export type ReviewProgress = { phase: 'checking' };

/** Numeric IP addresses also need review; ordinary dates and dimensions do not. */
export function needsTextReview(text: string): boolean {
  return /\p{L}|(?:\d{1,3}\.){3}\d{1,3}/u.test(normalizeText(text).replace(/\p{Cf}/gu, '').replace(/[。｡]/g, '.'));
}

/** Review the painted footer and its literal boundaries; inserted metadata cannot hide adjacent text. */
export function exportText(options: ExportOptions, footerValues: Record<string, string>): TextPart[] {
  const parts: TextPart[] = [
    { field: 'title', text: options.title },
    { field: 'description', text: options.description },
  ];
  if (options.footer) {
    const { left, right } = resolveFooter(options.footerTemplate, footerValues);
    const literals = parseFooter(options.footerTemplate).flatMap(segment => segment.t === 'text' ? [segment.v] : []);
    const segments = [...new Set([...literals, literals.join('')])].filter(needsTextReview);
    parts.push({ field: 'footer', text: [left, right].filter(Boolean).join('\n'), ...(segments.length ? { segments } : {}) });
  }
  return parts.filter(({ text, segments }) => needsTextReview(text) || segments?.some(needsTextReview));
}

/** Analysis copies only: preserve spelling, spacing and emoji in the exported text. */
export function normalizeText(text: string): string {
  return text.normalize('NFKC').replace(/[\u00ad\u200b\u200e\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g, '').trim();
}

export function textVariants(text: string): string[] {
  const normalized = normalizeText(text);
  // Join separators between Han characters without joining Latin words or stripping sentence punctuation.
  const joined = normalized.replace(/(\p{Script=Han})[\t _.*~\-]{1,3}(?=\p{Script=Han})/gu, '$1');
  return [...new Set([normalized, joined])].filter(Boolean);
}
