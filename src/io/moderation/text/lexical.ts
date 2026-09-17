import { englishDataset, englishRecommendedTransformers, RegExpMatcher } from 'obscenity';
import { profaneWords } from '@2toad/profanity';
import chineseVocabulary from 'naughty-words/zh.json';
import { simplifiedChinese as simplified } from './chinese';
import { normalizeText } from './policy';
import type { Evidence } from './evidence';

const matcher = new RegExpMatcher({ ...englishDataset.build(), ...englishRecommendedTransformers });

const escape = (word: string) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Boundaries are written without lookbehind (Safari before 16.4 has none): the character before a
// match is consumed instead of asserted, which changes nothing for a yes-or-no test.
const LEAD = '(?:^|[^\\p{L}\\p{N}\\p{M}])';

/** The 2Toad word lists for the languages the app ships, matched exactly as the library's whole-word
 *  Unicode mode matches them: a word may not touch a letter, digit or mark, and may end at an underscore. */
const MULTILINGUAL = new RegExp(
  `${LEAD}(?:${['en', 'fr', 'ru', 'ja', 'zh'].flatMap(language => profaneWords.get(language) ?? []).map(escape).join('|')})(?:_|(?![\\p{L}\\p{N}\\p{M}_]))`,
  'iu',
);

export function multilingualExists(text: string): boolean {
  return MULTILINGUAL.test(text.toLowerCase());
}

/** A complete run of one Chinese word, bounded so ordinary compounds containing it do not match. */
export function chineseWordPattern(word: string): RegExp {
  return new RegExp(`${LEAD}(?:${escape(word)})+(?![\\p{L}\\p{N}\\p{M}])`, 'u');
}

const chinese = [...new Set(chineseVocabulary.map(word => simplified(word)))].map(chineseWordPattern);

export function lexicalEvidence(text: string): Evidence[] {
  const normalized = normalizeText(text);
  if (!/\p{L}/u.test(normalized)) return [];
  const evidence: Evidence[] = [];
  const add = (source: 'obscenity' | 'two-toad' | 'naughty-words') => evidence.push({ source });
  if (lexicalCandidates(normalized).length) add('obscenity');
  if (multilingualExists(normalized)) add('two-toad');
  if (/\p{Script=Han}/u.test(normalized)) {
    const converted = simplified(normalized);
    if (chinese.some(word => word.test(converted))) add('naughty-words');
  }
  return evidence;
}

/** Keep normalization confined to analysis copies of package matches. */
export function lexicalCandidates(text: string): string[] {
  const normalized = normalizeText(text);
  const joined = joinSeparatedLetters(normalized);
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

/** Only isolated letter runs are joined. Joining ordinary words creates unrelated offensive substrings. */
export function joinSeparatedLetters(text: string): string {
  return text.replace(/(^|[^\p{L}])((?:\p{L}[\t ._*~-]+){2,}\p{L})(?!\p{L})/gu, (_, lead: string, run: string) => lead + run.replace(/[\t ._*~-]+/g, ''));
}
