import { englishDataset, englishRecommendedTransformers, RegExpMatcher } from 'obscenity';
import { Profanity } from '@2toad/profanity';
import chineseVocabulary from 'naughty-words/zh.json';
import { simplifiedChinese as simplified } from './chinese';
import { normalizeText } from './policy';
import type { Evidence } from './evidence';

const matcher = new RegExpMatcher({ ...englishDataset.build(), ...englishRecommendedTransformers });
const multilingual = new Profanity({ languages: ['en', 'fr', 'ru', 'ja', 'zh'], wholeWord: true, unicodeWordBoundaries: true });
const chinese = [...new Set(chineseVocabulary.map(word => simplified(word)))].map(word =>
  new RegExp(`(?<![\\p{L}\\p{N}\\p{M}])(?:${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})+(?![\\p{L}\\p{N}\\p{M}])`, 'u'));

export function lexicalEvidence(text: string): Evidence[] {
  const normalized = normalizeText(text);
  if (!/\p{L}/u.test(normalized)) return [];
  const evidence: Evidence[] = [];
  const add = (source: 'obscenity' | 'two-toad' | 'naughty-words') => evidence.push({ source });
  if (lexicalCandidates(normalized).length) add('obscenity');
  if (multilingual.exists(normalized)) add('two-toad');
  if (/\p{Script=Han}/u.test(normalized)) {
    const converted = simplified(normalized);
    // Bound the complete repeated run; substring matching misreads ordinary Chinese compounds.
    if (chinese.some(word => word.test(converted))) add('naughty-words');
  }
  return evidence;
}

/** Keep normalization confined to analysis copies of package matches. */
export function lexicalCandidates(text: string): string[] {
  const normalized = normalizeText(text);
  // Only isolated letter runs are joined. Joining ordinary words creates unrelated offensive substrings.
  const joined = normalized.replace(/(?<!\p{L})(?:\p{L}[\t ._*~-]+){2,}\p{L}(?!\p{L})/gu, (run) => run.replace(/[\t ._*~-]+/g, ''));
  const candidates = new Set<string>();
  for (const variant of new Set([normalized, joined])) {
    const matches = matcher.getAllMatches(variant, true);
    if (!matches.length) continue;
    candidates.add(variant);
    let repaired = ''; let end = 0;
    for (const match of matches) {
      if (match.startIndex < end) continue;
      const word = englishDataset.getPayloadWithPhraseMetadata(match).phraseMetadata?.originalWord;
      if (!word) continue;
      const original = variant.slice(match.startIndex, match.endIndex + 1);
      repaired += variant.slice(end, match.startIndex) + (original.toLowerCase() === word.toLowerCase() ? original : word);
      end = match.endIndex + 1;
    }
    candidates.add(repaired + variant.slice(end));
  }
  return [...candidates];
}
