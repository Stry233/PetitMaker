/*
 * The queries Help's search pages and figure demonstrate, read from the catalog.
 *
 * Only the example item ids live here. Every name, alias, typo and word pair is derived from those
 * items, so a renamed item or a changed alias changes the prose and the figure with no copy edit.
 */
import { localizedName } from '../../../../i18n/context';
import { getCatalogItem } from '../../../../state/catalog';
import type { CatalogItem, Locale } from '../../../../core/model/types';

/** The items the examples are drawn from: a plain name, an item with aliases, and a two-word name. */
export const SEARCH_EXAMPLE_IDS = { name: 'tree-apple', alias: 'tree-peach', words: 'flower-sunflower' } as const;

interface SearchExamples {
  /** The name item in the reader's locale. */
  readonly item: string;
  /** The longest English word of that name, lowercased: what a reader types to find it in English. */
  readonly enQuery: string;
  /** The longest word of each name with its middle character dropped: a query with a missing letter. */
  readonly typo: string;
  readonly enTypo: string;
  /** The alias item in the reader's locale, its first non-Latin alias and its first Latin alias. */
  readonly aliasItem: string;
  readonly aliasQuery: string;
  readonly aliasLatin: string;
  /** The last two words of the word item's name as a spaced query, and those two words. */
  readonly wordsQuery: string;
  readonly wordsA: string;
  readonly wordsB: string;
}

const LATIN = /^[\p{Script=Latin}\s]+$/u;

function item(id: string): CatalogItem {
  const found = getCatalogItem(id);
  if (!found) throw new Error(`search example item ${id} is not in the catalog`);
  return found;
}

type GraphemeSegmenter = { segment(text: string): Iterable<{ segment: string }> };
type GraphemeSegmenterConstructor = new (locale: undefined, options: { granularity: 'grapheme' }) => GraphemeSegmenter;
const graphemes = (() => {
  const Ctor = (Intl as typeof Intl & { Segmenter?: GraphemeSegmenterConstructor }).Segmenter;
  const segmenter = Ctor ? new Ctor(undefined, { granularity: 'grapheme' }) : null;
  // Code points where the browser cannot segment graphemes: a combining mark may then fall alone.
  return (text: string): string[] => (segmenter ? [...segmenter.segment(text)].map((g) => g.segment) : [...text]);
})();

/** The word with the user-perceived character at its middle removed. */
function dropMiddle(word: string): string {
  const chars = graphemes(word);
  chars.splice(Math.floor(chars.length / 2), 1);
  return chars.join('');
}

function longestWord(name: string): string {
  return name.split(/\s+/).reduce((best, word) => (graphemes(word).length > graphemes(best).length ? word : best), '');
}

type WordSegmenter = { segment(text: string): Iterable<{ segment: string; isWordLike?: boolean }> };
type WordSegmenterConstructor = new (locale: string, options: { granularity: 'word' }) => WordSegmenter;
const Segmenter = (Intl as typeof Intl & { Segmenter?: WordSegmenterConstructor }).Segmenter;

/** The name's words: spaces where it has them, the locale's word breaks where it does not. */
function words(name: string, locale: Locale): string[] {
  const spaced = name.split(/\s+/).filter(Boolean);
  if (spaced.length > 1 || !Segmenter) return spaced;
  return [...new Segmenter(locale, { granularity: 'word' }).segment(name)]
    .filter((s) => s.isWordLike !== false && s.segment.trim() !== '')
    .map((s) => s.segment);
}

const cached = new Map<Locale, SearchExamples>();

export function searchExamples(locale: Locale): SearchExamples {
  const hit = cached.get(locale);
  if (hit) return hit;
  const named = item(SEARCH_EXAMPLE_IDS.name);
  const aliased = item(SEARCH_EXAMPLE_IDS.alias);
  const worded = item(SEARCH_EXAMPLE_IDS.words);
  const local = localizedName(named.name, locale);
  const enQuery = longestWord(named.name.en).toLowerCase();
  const aliases = aliased.aliases ?? [];
  // Without word breaks in the reader's locale, the English name is the two-word query: search
  // matches English in every locale.
  const localWords = words(localizedName(worded.name, locale), locale);
  const pair = (localWords.length >= 2 ? localWords : words(worded.name.en, 'en')).slice(-2);
  const examples: SearchExamples = {
    item: local,
    enQuery,
    typo: dropMiddle(longestWord(local)),
    enTypo: dropMiddle(enQuery),
    aliasItem: localizedName(aliased.name, locale),
    aliasQuery: aliases.find((a) => !LATIN.test(a)) ?? aliases[0] ?? '',
    aliasLatin: aliases.find((a) => LATIN.test(a)) ?? aliases[0] ?? '',
    wordsQuery: pair.join(' '),
    wordsA: pair[0] ?? '',
    wordsB: pair[pair.length - 1] ?? '',
  };
  cached.set(locale, examples);
  return examples;
}
