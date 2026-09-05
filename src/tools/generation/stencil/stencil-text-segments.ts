interface GraphemeSegmenter { segment(text: string): Iterable<{ segment: string }> }
type SegmenterConstructor = new (locale: undefined, options: { granularity: 'grapheme' }) => GraphemeSegmenter;
const Segmenter = (Intl as typeof Intl & { Segmenter?: SegmenterConstructor }).Segmenter;
const segmenter = Segmenter ? new Segmenter(undefined, { granularity: 'grapheme' }) : null;

/** User-perceived characters keep combining marks, emoji modifiers and joined sequences intact. */
export function textGraphemes(text: string): string[] {
  if (segmenter) return Array.from(segmenter.segment(text), part => part.segment);
  const parts: string[] = [];
  let regional = 0;
  for (const ch of text) {
    const previous = parts[parts.length - 1];
    const isRegional = /\p{Regional_Indicator}/u.test(ch);
    const extension = /[\p{Mark}\p{Emoji_Modifier}\p{Grapheme_Extend}\u200c\u200d\u{e0020}-\u{e007f}]/u.test(ch);
    if (previous && (extension || previous.endsWith('\u200d') || (isRegional && regional % 2 === 1) || (previous === '\r' && ch === '\n'))) parts[parts.length - 1] += ch;
    else parts.push(ch);
    regional = isRegional ? regional + 1 : 0;
  }
  return parts;
}

/** Text-presentation selectors retain the font outline; flags and keycaps use emoji rendering. */
export function isEmojiGrapheme(text: string): boolean {
  if (text.includes('\ufe0e')) return false;
  return /[\p{Extended_Pictographic}\p{Regional_Indicator}\u20e3]/u.test(text);
}

export function limitTextGraphemes(text: string, maximum: number): string {
  return textGraphemes(text).slice(0, maximum).join('');
}

/** Unqualified keycaps need emoji presentation to avoid separate digit and enclosing glyphs. */
export function normalizeTextPresentation(text: string): string {
  return text.normalize('NFC').replace(/([0-9#*])\u20e3/gu, '$1\ufe0f\u20e3');
}
