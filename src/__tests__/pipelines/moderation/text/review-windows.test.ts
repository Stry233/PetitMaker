import { describe, expect, it, vi } from 'vitest';
import { profaneWords } from '@2toad/profanity';
import chineseVocabulary from 'naughty-words/zh.json';
import politicalIndex from '../../../../assets/moderation/political-index.json';
import lexicalIndex from '../../../../assets/moderation/lexical-index.json';
import { REVIEW_MAX_CHARS } from '../../../../pipelines/moderation/text/reviewer';
import { reviewLongText, reviewWindowRanges } from '../../../../pipelines/moderation/text/review-windows';

const reviewed = vi.hoisted(() => ({ texts: [] as string[], signals: [] as AbortSignal[] }));
vi.mock('../../../../pipelines/moderation/text/reviewer', async (importOriginal) => ({
  ...await importOriginal<object>(),
  reviewText: async (parts: { text: string }[], signal: AbortSignal) => {
    reviewed.texts.push(parts[0]!.text);
    reviewed.signals.push(signal);
    return parts[0]!.text.includes('MARKERPHRASE') ? { allowed: false, reason: 'content', fields: ['description'] } : { allowed: true };
  },
}));

/** The longest entry any shipped restriction list matches as one span. */
function longestEntry(): number {
  const lengths = [
    ...Object.keys(politicalIndex.direct).map(Number),
    ...Object.keys(politicalIndex.roman).map((key) => key.length),
    ...Object.keys(lexicalIndex.terms).map(Number),
    ...chineseVocabulary.map((word) => word.length),
    ...['en', 'fr', 'ru', 'ja', 'zh'].flatMap((language) => profaneWords.get(language) ?? []).map((word) => word.length),
  ];
  return Math.max(...lengths);
}

const TEXTS: Record<string, string> = {
  prose: 'Lay a quiet pond with flowers around it near the plaza. '.repeat(400),
  han: '在广场旁边修一个安静的池塘周围种满花'.repeat(1200),
  emoji: '🌸🌊'.repeat(5000),
  mixed: ('north terrace 北边梯田 🌲 ' + 'x'.repeat(90)).repeat(150),
};

describe('windowed text review', () => {
  it('reviews text within the limit as one window', () => {
    expect(reviewWindowRanges('a pond')).toEqual([[0, 6]]);
    expect(reviewWindowRanges('a'.repeat(REVIEW_MAX_CHARS))).toEqual([[0, REVIEW_MAX_CHARS]]);
  });

  it.each(Object.keys(TEXTS))('covers %s text in bounded windows that share more than the longest restriction entry', (name) => {
    const text = TEXTS[name]!;
    const ranges = reviewWindowRanges(text);
    expect(ranges.length).toBeGreaterThan(1);
    expect(ranges[0]![0]).toBe(0);
    expect(ranges[ranges.length - 1]![1]).toBe(text.length);
    const longest = longestEntry();
    for (const [i, [start, end]] of ranges.entries()) {
      expect(end - start).toBeLessThanOrEqual(REVIEW_MAX_CHARS);
      // No window opens or closes between the halves of a surrogate pair.
      for (const cut of [start, end]) expect(/[\udc00-\udfff]/.test(text[cut] ?? '')).toBe(false);
      const next = ranges[i + 1];
      if (next) expect(end - next[0]).toBeGreaterThanOrEqual(longest);
    }
  });

  it('finds a phrase cut by a window edge and checks every window under the caller signal', async () => {
    const tail = 'more ponds '.repeat(400);
    const head = 'a quiet pond '.repeat(400);
    const firstEnd = reviewWindowRanges(head + tail)[0]![1];
    // The phrase spans the raw first cut, so the first window stops short of its end.
    const text = `${head.slice(0, firstEnd - 6)}MARKERPHRASE ${tail}`;
    const [[, end]] = reviewWindowRanges(text) as [[number, number]];
    expect(end).toBeLessThan(text.indexOf('MARKERPHRASE') + 'MARKERPHRASE'.length);
    reviewed.texts.length = 0;
    reviewed.signals.length = 0;
    const signal = new AbortController().signal;
    expect((await reviewLongText('description', text, signal)).allowed).toBe(false);
    expect(reviewed.texts.length).toBe(2);
    expect(reviewed.signals.every((s) => s === signal)).toBe(true);
    expect(reviewed.texts.every((t) => t.length <= REVIEW_MAX_CHARS)).toBe(true);
    expect(await reviewLongText('description', TEXTS.prose!, signal)).toEqual({ allowed: true });
  });
});
