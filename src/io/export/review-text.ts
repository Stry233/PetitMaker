import { DEFAULT_FOOTER, parseFooter, resolveFooter } from './footer-template';
import type { ExportOptions } from './types';
import { needsTextReview, type TextPart } from '../../pipelines/moderation/facts';

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
