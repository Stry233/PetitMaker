export type LiteralKind = 'anywhere' | 'word' | 'token' | 'phrase';

/** Scripts written without word spacing cannot supply word boundaries. */
export const UNSPACED = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}]/u;
/** Letters, digits and combining marks continue a word; Thai vowels and Indic signs are marks. */
const WORD = /[\p{L}\p{N}\p{M}]/u;
const DIGIT = /\p{N}/u;
const SEPARATOR = /[\p{P}\p{S}]/u;

/** Letter entries match complete words, digits and single characters complete tokens (24小时 and P图 are one token), Han phrases await the caller's segmentation check, and punctuated or other unspaced-script entries match anywhere. */
export function literalKind(word: string): LiteralKind {
  if (!/^[\p{L}\p{N}]+$/u.test(word)) return 'anywhere';
  if (/^\p{N}+$/u.test(word) || [...word].length === 1) return 'token';
  if (/^\p{Script=Han}+$/u.test(word)) return 'phrase';
  return UNSPACED.test(word) ? 'anywhere' : 'word';
}

function codePointBefore(text: string, index: number): string {
  if (index <= 0) return '';
  const code = text.charCodeAt(index - 1);
  const start = code >= 0xdc00 && code <= 0xdfff && index >= 2 ? index - 2 : index - 1;
  return String.fromCodePoint(text.codePointAt(start)!);
}

function codePointAfter(text: string, index: number): string {
  return index < text.length ? String.fromCodePoint(text.codePointAt(index)!) : '';
}

/** Dates, dimensions and codes such as 16×24 or 2026-09-24 are one number; a digit entry does not stand alone inside them. */
function continues(edge: string, neighbour: string, beyond: string, kind: LiteralKind): boolean {
  if (WORD.test(neighbour)) return kind === 'token' || !UNSPACED.test(neighbour);
  return DIGIT.test(edge) && SEPARATOR.test(neighbour) && DIGIT.test(beyond);
}

/** Whether a word or token entry occupying text[start, end) stands as a complete word or token there. */
export function spanBounded(text: string, start: number, end: number, kind: LiteralKind): boolean {
  if (kind === 'anywhere' || kind === 'phrase') return true;
  const before = codePointBefore(text, start);
  const after = codePointAfter(text, end);
  if (continues(text[start]!, before, codePointBefore(text, start - before.length), kind)) return false;
  return !continues(text[end - 1]!, after, codePointAfter(text, end + after.length), kind);
}
