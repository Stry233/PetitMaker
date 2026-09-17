/**
 * The text check without regex lookbehind. Every pattern that once used it is pinned against the
 * lookbehind form it replaces, so an engine that lacks the feature reads exactly what a modern one
 * reads; the profanity lists are pinned word by word against the library's own matcher.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { Profanity, profaneWords } from '@2toad/profanity';
import { joinSpelledLetters } from '../../../io/moderation/text/variants';
import { chineseWordPattern, joinSeparatedLetters, multilingualExists } from '../../../io/moderation/text/lexical';
import { normalizedReading } from '../../../io/moderation/map/evidence';
import { reviewText, ReviewTooLong } from '../../../io/moderation/text/reviewer';

const SPELLED = [
  'm.a.p', 'm a p', 'p|l|a|n', 'hello world', 'a.b.c.d', 'x y z. a b c', 'r-o-a-d yes', 'ab c d', '3 d', 'é t é',
  '日 本 語', 'ok m a p ok', 'm a py', 'xm a p', 'a b', 'a b c', '...a b c...', 'a  b  c', 'a . b . c', 'a\tb\tc',
  'w o r d, w o r d', 'A B C', 'a1 b c', 'end a b c', 'a b c.', 'ǅ ǆ ǈ', 'ᄀ ᄁ ᄂ', 'a_b_c', 'a*b*c', 'a~b~c',
];

describe('spelled-out letters rejoin without lookbehind', () => {
  const oracle = (text: string) => text.replace(/(?<!\p{L})(?:\p{L}[\p{P}\p{S}\s]{1,2}){2,}\p{L}(?!\p{L})/gu, (run) => run.replace(/[\p{P}\p{S}\s]+/gu, ''));
  it.each(SPELLED)('reads %j as the lookbehind form did', (text) => {
    expect(joinSpelledLetters(text)).toBe(oracle(text));
  });
});

describe('separated letters rejoin for the English matcher without lookbehind', () => {
  const oracle = (text: string) => text.replace(/(?<!\p{L})(?:\p{L}[\t ._*~-]+){2,}\p{L}(?!\p{L})/gu, (run) => run.replace(/[\t ._*~-]+/g, ''));
  it.each(SPELLED)('reads %j as the lookbehind form did', (text) => {
    expect(joinSeparatedLetters(text)).toBe(oracle(text));
  });
});

describe('Chinese word patterns bound the run without lookbehind', () => {
  const escape = (word: string) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const oracle = (word: string) => new RegExp(`(?<![\\p{L}\\p{N}\\p{M}])(?:${escape(word)})+(?![\\p{L}\\p{N}\\p{M}])`, 'u');
  const words = ['花', '花园', 'a.b', '好好'];
  const texts = ['花', '花园', '大花', '花花', '花园里', 'x花园', '花园x', '1花园', '花园1', '花园 里', ' 花园 ', 'a.b', 'aab', 'a.ba.b', 'a.bx', '好好', '好好好', '你好好', '好好的'];
  it.each(words)('matches %j in the same texts', (word) => {
    for (const text of texts) expect(chineseWordPattern(word).test(text), text).toBe(oracle(word).test(text));
  });
});

describe('Han spacing folds without lookbehind', () => {
  const oracle = (text: string) => text.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').replace(/(?<=\p{Script=Han})\s+(?=\p{Script=Han})/gu, '').trim();
  it.each(['你 好', '你  好 世界', 'hello 你 好 world', '你 a 好', ' 你 好 ', 'A 你\t好 B', '好'])('reads %j as the lookbehind form did', (text) => {
    // Traditional-to-simplified conversion is the same in both readings and is not the subject.
    expect(normalizedReading(text)).toBe(oracle(text));
  });
});

describe('the multilingual lists match as the library matches them', () => {
  const library = new Profanity({ languages: ['en', 'fr', 'ru', 'ja', 'zh'], wholeWord: true, unicodeWordBoundaries: true });
  const frames = ['%', 'x%', '%x', '_%_', '1 %, 2', 'a%b', '% ', '%_', '_%', 'é%', '%ё', 'the % here', '%%'];
  it('agrees on every word in every list, in every frame', () => {
    let checked = 0;
    for (const language of ['en', 'fr', 'ru', 'ja', 'zh']) {
      for (const word of profaneWords.get(language) ?? []) {
        for (const frame of frames) {
          const text = frame.replace(/%/g, word);
          expect(multilingualExists(text), text).toBe(library.exists(text));
          checked += 1;
        }
      }
    }
    expect(checked).toBeGreaterThan(1000);
  });
  it('is case-insensitive like the library', () => {
    const word = profaneWords.get('en')![0]!;
    expect(multilingualExists(word.toUpperCase())).toBe(library.exists(word.toUpperCase()));
    expect(multilingualExists('garden path')).toBe(false);
  });
});

class LoadFailingWorker {
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  terminate = vi.fn();
  postMessage = vi.fn();
  constructor() { setTimeout(() => this.onerror?.(), 0); }
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('the check runs on this thread when no worker can', () => {
  it('reviews without any Worker at all', async () => {
    vi.stubGlobal('Worker', undefined);
    await expect(reviewText([{ field: 'title', text: 'Garden' }], new AbortController().signal, vi.fn())).resolves.toEqual({ allowed: true });
    // A refused sample comes from the shipped list itself, never spelled out here.
    const listed = profaneWords.get('en')![0]!;
    const refused = await reviewText([{ field: 'title', text: listed }], new AbortController().signal, vi.fn());
    expect(refused.allowed).toBe(false);
    await expect(reviewText([{ field: 'footer', text: 'a'.repeat(4097) }], new AbortController().signal, vi.fn())).rejects.toBeInstanceOf(ReviewTooLong);
  });

  it('reviews when the worker fails to load', async () => {
    vi.stubGlobal('Worker', LoadFailingWorker);
    await expect(reviewText([{ field: 'title', text: 'Garden' }], new AbortController().signal, vi.fn())).resolves.toEqual({ allowed: true });
  });
});
