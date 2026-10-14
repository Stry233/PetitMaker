import rawIndex from '../../../assets/moderation/political-index.json';
import { simplifiedChinese } from './chinese';
import { normalizeText } from './policy';
import { fingerprint } from './fingerprint';
import type { Evidence } from './evidence';
import { RE2JS } from 're2js';
import { analysisVariants } from './variants';
import { addLexiconWords, ordinarySpan, spanAligned, type Provisional } from './segmenter';
import { literalKind, spanBounded } from './boundaries';

type Index = {
  version: number; direct: Record<string, Record<string, number>>; roman: Record<string, number>;
  readingBase: number; readings: string[]; han: string; pattern?: string;
  /** The evidence each mask bit reports, in bit order, written by the index compiler. */
  evidence: readonly Evidence[];
};
const index = rawIndex as Index;
const lengths = Object.keys(index.direct).map(Number);
const readingBytes = Uint8Array.from(atob(index.han), c => c.charCodeAt(0));
const readingIds = new DataView(readingBytes.buffer);
const sources = index.evidence;
const pattern = index.pattern ? RE2JS.compile(index.pattern, RE2JS.CASE_INSENSITIVE) : null;

function reading(char: string): string {
  const offset = (char.charCodeAt(0) - index.readingBase) * 2;
  if (offset < 0 || offset + 1 >= readingIds.byteLength) return '';
  return index.readings[readingIds.getUint16(offset, true)] ?? '';
}

function directMatches(text: string): Provisional<number> {
  let found = 0;
  let provisional = false;
  const phrases: { start: number; end: number; mask: number }[] = [];
  for (let start = 0; start < text.length; start++) {
    for (const length of lengths) {
      if (start + length > text.length) continue;
      const candidate = text.slice(start, start + length);
      const mask = index.direct[length]?.[fingerprint(candidate)];
      if (!mask) continue;
      const kind = literalKind(candidate);
      if (kind === 'phrase') phrases.push({ start, end: start + length, mask });
      else if (spanBounded(text, start, start + length, kind)) found |= mask;
    }
  }
  if (phrases.length) {
    // Matched phrases become candidate words so the most probable path can keep them whole.
    addLexiconWords(phrases.map(phrase => text.slice(phrase.start, phrase.end)));
    const boundaries = { current: null };
    for (const phrase of phrases) {
      const aligned = spanAligned(text, phrase.start, phrase.end, boundaries);
      provisional ||= aligned.provisional;
      if (aligned.verdict) found |= phrase.mask;
    }
  }
  return { verdict: found, provisional };
}

function pronunciationMatches(text: string): Provisional<number> {
  let found = 0;
  let provisional = false;
  const chars = [...text];
  const readings = chars.map(reading);
  const offsets = [0];
  for (const char of chars) offsets.push(offsets[offsets.length - 1]! + char.length);
  const boundaries = { current: null };
  for (let start = 0; start < chars.length; start++) {
    let joined = '';
    for (let end = start; end < Math.min(chars.length, start + 12); end++) {
      if (!readings[end]) break;
      joined += readings[end];
      if (end - start < 2) continue;
      // Only source phrases of at least three Han characters enter the pronunciation index.
      const mask = index.roman[fingerprint(joined)] ?? 0;
      if (!mask) continue;
      // A homophone span must sit on token boundaries and not be ordinary text such as a place name or two everyday words.
      const aligned = spanAligned(text, offsets[start]!, offsets[end + 1]!, boundaries);
      provisional ||= aligned.provisional;
      if (!aligned.verdict) continue;
      const ordinary = ordinarySpan(chars.slice(start, end + 1).join(''));
      provisional ||= ordinary.provisional;
      if (!ordinary.verdict) found |= mask;
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
  return { verdict: found, provisional };
}

/** Topic vocabulary is a publishing-policy signal, not a finding that the author is abusive. */
export function politicalEvidence(text: string): Provisional<Evidence[]> {
  const normalized = simplifiedChinese(normalizeText(text)).toLowerCase();
  let mask = 0;
  let rule = false;
  let provisional = false;
  for (const variant of analysisVariants(text, normalized)) {
    const direct = directMatches(variant), spoken = pronunciationMatches(variant);
    mask |= direct.verdict | spoken.verdict;
    provisional ||= direct.provisional || spoken.provisional;
    rule ||= !!pattern?.test(variant);
  }
  const evidence = sources.filter((_, i) => mask & (1 << i));
  return { verdict: rule ? [...evidence, { source: 'konsheng-rule' }] : evidence, provisional };
}
