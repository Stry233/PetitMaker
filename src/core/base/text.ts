/** `s` with every regular-expression metacharacter escaped, so it matches itself literally. */
export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

interface GraphemeSegmenter { segment(text: string): Iterable<{ segment: string }> }
type SegmenterConstructor = new (locale: undefined, options: { granularity: 'grapheme' }) => GraphemeSegmenter;
const Segmenter = (Intl as typeof Intl & { Segmenter?: SegmenterConstructor }).Segmenter;
const segmenter = Segmenter ? new Segmenter(undefined, { granularity: 'grapheme' }) : null;

/** User-perceived characters keep combining marks, emoji modifiers and joined sequences intact. */
export function graphemes(text: string): string[] {
  if (segmenter) return Array.from(segmenter.segment(text), part => part.segment);
  const parts: string[] = [];
  let regional = 0;
  for (const ch of text) {
    const previous = parts[parts.length - 1];
    const isRegional = /\p{Regional_Indicator}/u.test(ch);
    const extension = /[\p{Mark}\p{Emoji_Modifier}\p{Grapheme_Extend}‌‍\u{e0020}-\u{e007f}]/u.test(ch);
    if (previous && (extension || previous.endsWith('‍') || (isRegional && regional % 2 === 1) || (previous === '\r' && ch === '\n'))) parts[parts.length - 1] += ch;
    else parts.push(ch);
    regional = isRegional ? regional + 1 : 0;
  }
  return parts;
}
