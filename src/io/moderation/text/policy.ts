import { DEFAULT_FOOTER, parseFooter, resolveFooter } from '../../export/footer-template';
import type { ExportOptions } from '../../export/types';

export type TextField = 'title' | 'description' | 'footer' | 'author';
export type TextPart = { field: TextField; text: string; segments?: string[] };
export type Restriction = 'content' | 'political' | 'website';
export type ReviewResult = { allowed: true } | { allowed: false; reason: Restriction; fields: TextField[] };
export type ReviewProgress = { phase: 'checking' };

/** Eligibility is not a verdict: numeric captions must reach the same checks as words. */
export function needsTextReview(text: string): boolean {
  return normalizeText(text).length > 0;
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
    // The default consists only of generated date/dimension metadata, including in textless export.
    if (options.footerTemplate !== DEFAULT_FOOTER) parts.push({ field: 'footer', text: [left, right].filter(Boolean).join('\n'), ...(segments.length ? { segments } : {}) });
  }
  return parts.filter(({ text, segments }) => needsTextReview(text) || segments?.some(needsTextReview));
}

/** Analysis copies only: preserve spelling, spacing and emoji in the exported text. */
export function normalizeText(text: string): string {
  return text.normalize('NFKC')
    .replace(/[\p{Cf}\u034f]/gu, char => /[\u200c\u200d]/.test(char) ? char : '')
    .replace(/([\p{L}\p{N}])[\u200c\u200d\ufe00-\ufe0f\u{e0100}-\u{e01ef}]+(?=[\p{L}\p{N}])/gu, '$1').trim();
}

export function textVariants(text: string): string[] {
  const normalized = normalizeText(text);
  // Join separators between Han characters without joining Latin words or stripping sentence punctuation.
  const joined = normalized.replace(/(\p{Script=Han})[\t _.*~\-]{1,3}(?=\p{Script=Han})/gu, '$1');
  return [...new Set([normalized, joined])].filter(Boolean);
}
