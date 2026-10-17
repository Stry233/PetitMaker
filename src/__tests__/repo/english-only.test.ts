/**
 * Code, identifiers, comments and data are English; translated copy lives in `src/i18n/locales/`.
 * Outside it, no production line writes Cyrillic, Thai, CJK or Hangul text; a character a pattern
 * matches is written as its `\u` escape. The files that hold data in another script by what they are
 * (game data names, legal facts as filed, the locales' own names, the assistant's language cues, the
 * moderation lexicons, the changelog's own vocabulary) are declared in `DATA_SCRIPTS` as files with
 * their reason, and fail here once they hold none. Latin-script copy (French, Indonesian) is held by
 * review.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { SRC, sourceFiles, srcRelative } from '../_support/source-graph';

/** Files whose data is in another script by what it is, each with why. */
const DATA_SCRIPTS: Readonly<Record<string, string>> = {
  'src/agent/core/language-cue.ts': "the cue the assistant hears to answer in the user's language is written in that language",
  'src/config/neighbors.ts': "game data: each neighbour's name per locale, read by localizedName()",
  'src/i18n/terms/brand.ts': "the product's name in each locale is a brand fact, not copy",
  'src/i18n/locale-info.ts': "each locale's name in its own script and its list separators",
  'src/legal/config.ts': 'legal facts in the language the law and the filings state them in',
  'src/platform/build/deploy-targets.ts': "the CN target's page title and ICP filing number, as filed",
  'src/pipelines/moderation/text/variants.ts': 'a moderation lexicon: the Cyrillic and Greek letters that read as Latin ones',
  'src/ui/chrome/modals/whats-new/notes.ts': "the Chinese changelog's Unreleased heading, which the notes parser skips",
};
/** Cyrillic, Thai, kana, CJK ideographs, Hangul and full-width forms. */
const NON_LATIN = /[Ѐ-ӿ฀-๿぀-ヿ㐀-鿿가-힯＀-￯]/;

const nonLatinLines = (text: string): number => text.split('\n').filter((line) => NON_LATIN.test(line)).length;

const found = new Map<string, number>();
for (const file of sourceFiles(SRC)) {
  const path = `src/${srcRelative(file)}`;
  if (path.startsWith('src/i18n/locales/')) continue;
  const n = nonLatinLines(readFileSync(file, 'utf8'));
  if (n > 0) found.set(path, n);
}

describe('English-only source', () => {
  it('writes no translated text outside the locale tables and the declared data', () => {
    const lines = [...found].filter(([path]) => !(path in DATA_SCRIPTS)).map(([path, n]) => `${path}: ${n}`);
    expect(lines, 'move the copy to src/i18n/locales/ and look it up through t(), or escape a pattern character').toEqual([]);
  });

  it('declares only files that still hold data in another script', () => {
    expect(Object.keys(DATA_SCRIPTS).filter((path) => !found.has(path))).toEqual([]);
  });

  it('reads a translated line and leaves English and accented Latin alone', () => {
    expect(nonLatinLines("const a = 'Hello';\nconst b = 'café';\nconst c = '中文';\nconst d = 'Привет';\n")).toBe(2);
  });
});
