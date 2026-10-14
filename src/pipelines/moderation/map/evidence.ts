import { lexicalEvidence } from '../text/lexical';
import { politicalEvidence } from '../text/political';
import { simplifiedChinese } from '../text/chinese';
import { cuss } from 'cuss';
import type { Provisional } from '../text/segmenter';

export type ImageScores = { className: string; probability: number }[];

/** A strict screening threshold, not a calibrated probability that the map violates policy. */
export function explicitImage(scores: ImageScores): string | null {
  if (scores.length !== 5 || scores.some(s => !Number.isFinite(s.probability) || s.probability < 0 || s.probability > 1)) return null;
  const explicit = scores.find(s => (s.className === 'Porn' || s.className === 'Hentai') && s.probability >= 0.995);
  return explicit?.className ?? null;
}

export function normalizedReading(text: string): string {
  return simplifiedChinese(text.normalize('NFKC')).toLowerCase().replace(/\s+/g, ' ').replace(/(\p{Script=Han})\s+(?=\p{Script=Han})/gu, '$1').trim();
}

/** OCR errors need stricter corroboration than text entered directly into a field. */
export function restrictedReading(text: string, confidence: number): Provisional<boolean> {
  const settled = (verdict: boolean) => ({ verdict, provisional: false });
  if (confidence < 92 || text.length > 180 || !text.trim()) return settled(false);
  const clean = normalizedReading(text);
  const lexical = lexicalEvidence(clean);
  const words = clean.match(/[\p{L}\p{N}']+/gu) ?? [];
  // Package ambiguity ratings keep ordinary names from becoming OCR findings.
  const unambiguous = words.some((_, start) => [1, 2, 3, 4].some(length => cuss[words.slice(start, start + length).join(' ')] === 2));
  if ((lexical.length >= 2 && unambiguous) || lexical.some(e => e.source === 'naughty-words')) return settled(true);
  const { verdict: dictionary, provisional } = politicalEvidence(clean);
  // A categorized collection match is a finding on its own; the smaller political sources still need agreement.
  const found = dictionary.some(e => e.source.startsWith('konsheng-') && e.source !== 'konsheng-numeric') || new Set(dictionary.map(e => e.source)).size >= 2;
  return { verdict: found, provisional };
}

export function confirmedReading(first: string, second: string, confidence: number): Provisional<boolean> {
  if (normalizedReading(first) !== normalizedReading(second)) return { verdict: false, provisional: false };
  return restrictedReading(second, confidence);
}
