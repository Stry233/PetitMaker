import { graphemes } from '../../../core/base/text';

/** Text-presentation selectors retain the font outline; flags and keycaps use emoji rendering. */
export function isEmojiGrapheme(text: string): boolean {
  if (text.includes('\ufe0e')) return false;
  return /[\p{Extended_Pictographic}\p{Regional_Indicator}\u20e3]/u.test(text);
}

export function limitTextGraphemes(text: string, maximum: number): string {
  return graphemes(text).slice(0, maximum).join('');
}

/** Unqualified keycaps need emoji presentation to avoid separate digit and enclosing glyphs. */
export function normalizeTextPresentation(text: string): string {
  return text.normalize('NFC').replace(/([0-9#*])\u20e3/gu, '$1\ufe0f\u20e3');
}
