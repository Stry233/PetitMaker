import rawIndex from '../../../assets/moderation/political-index.json';
import { simplifiedChinese } from './chinese';
import { normalizeText } from './policy';
import { fingerprint } from './fingerprint';
import type { Evidence } from './evidence';

type Index = { version: number; direct: Record<string, Record<string, number>>; roman: Record<string, number>; readingBase: number; readings: string[]; han: string };
const index = rawIndex as Index;
const lengths = Object.keys(index.direct).map(Number);
const readingBytes = Uint8Array.from(atob(index.han), c => c.charCodeAt(0));
const readingIds = new DataView(readingBytes.buffer);
const sources = ['zhin-political', 'fwwdn-political', 'houbb-political'] as const;

function reading(char: string): string {
  const offset = (char.charCodeAt(0) - index.readingBase) * 2;
  if (offset < 0 || offset + 1 >= readingIds.byteLength) return '';
  return index.readings[readingIds.getUint16(offset, true)] ?? '';
}

function directMatches(text: string): number {
  let found = 0;
  for (let start = 0; start < text.length; start++) {
    for (const length of lengths) {
      if (start + length > text.length) continue;
      const candidate = text.slice(start, start + length);
      const mask = index.direct[length]?.[fingerprint(candidate)];
      if (!mask) continue;
      // Latin abbreviations must not match inside ordinary words or identifiers.
      if (/^[a-z0-9]+$/i.test(candidate) && (/\p{L}|\p{N}/u.test(text[start - 1] ?? '') || /\p{L}|\p{N}/u.test(text[start + length] ?? ''))) continue;
      found |= mask;
    }
  }
  return found;
}

function pronunciationMatches(text: string): number {
  let found = 0;
  const chars = [...text];
  const readings = chars.map(reading);
  for (let start = 0; start < chars.length; start++) {
    let joined = '';
    for (let end = start; end < Math.min(chars.length, start + 12); end++) {
      if (!readings[end]) break;
      joined += readings[end];
      // Only source phrases of at least three Han characters enter the pronunciation index.
      if (end - start >= 2) found |= index.roman[fingerprint(joined)] ?? 0;
    }
  }
  // Remove pinyin tone marks while retaining the distinct vowel ü.
  const romanText = text.normalize('NFD').replace(/[\u0300\u0301\u0304\u030c]/g, '').normalize('NFC');
  const words = [...romanText.matchAll(/[a-zü]+/gu)];
  for (let start = 0; start < words.length; start++) {
    const first = words[start]!;
    if (/[\p{L}\p{N}]/u.test(romanText[first.index! - 1] ?? '')) continue;
    let joined = '';
    for (let end = start; end < Math.min(words.length, start + 12); end++) {
      const word = words[end]!;
      if (end > start) {
        const previous = words[end - 1]!;
        if (!/^[^\p{L}\p{N}]+$/u.test(romanText.slice(previous.index! + previous[0].length, word.index))) break;
      }
      joined += word[0];
      if (/[\p{L}\p{N}]/u.test(romanText[word.index! + word[0].length] ?? '')) continue;
      found |= index.roman[fingerprint(joined)] ?? 0;
    }
  }
  return found;
}

/** Topic vocabulary is a publishing-policy signal, not a finding that the author is abusive. */
export function politicalEvidence(text: string): Evidence[] {
  const normalized = simplifiedChinese(normalizeText(text)).toLowerCase();
  // These separators are analysis-only; ordinary emoji and spacing remain in the exported image.
  const joined = normalized.replace(/(\p{Script=Han})[\p{P}\p{Z}\p{S}\p{Cf}\s]+(?=\p{Script=Han})/gu, '$1');
  let mask = 0;
  for (const variant of new Set([normalized, joined])) mask |= directMatches(variant) | pronunciationMatches(variant);
  return sources.flatMap((source, i) => mask & (1 << i) ? [{ source, category: 'political' as const }] : []);
}
