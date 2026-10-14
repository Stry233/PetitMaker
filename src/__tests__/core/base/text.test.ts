import { describe, expect, it, vi } from 'vitest';
import { escapeRegExp, graphemes } from '../../../core/base/text';

const sequences = ['é', '👍🏽', '👩‍🌾', '👨‍👩‍👧‍👦', '🇨🇳', '1️⃣', '1⃣', '🏴\u{e0067}\u{e0062}\u{e0065}\u{e006e}\u{e0067}\u{e007f}'];

describe('graphemes', () => {
  it('uses full grapheme boundaries for conjuncts and Hangul syllables', () => {
    expect(graphemes('क्ष')).toEqual(['क्ष']);
    expect(graphemes('가')).toEqual(['가']);
  });

  it('keeps common joined sequences intact without Intl.Segmenter', async () => {
    const native = Object.getOwnPropertyDescriptor(Intl, 'Segmenter')!;
    try {
      Object.defineProperty(Intl, 'Segmenter', { ...native, value: undefined });
      vi.resetModules();
      const fallback = await import('../../../core/base/text');
      for (const glyph of sequences) expect(fallback.graphemes(glyph), glyph).toEqual([glyph]);
      expect(fallback.graphemes('🇨🇳🇯🇵')).toEqual(['🇨🇳', '🇯🇵']);
    } finally {
      Object.defineProperty(Intl, 'Segmenter', native);
      vi.resetModules();
    }
  });
});

describe('escapeRegExp', () => {
  it('matches the text literally', () => {
    const text = 'a.b*c+d?(e)[f]{g}|h^i$j\\k';
    expect(new RegExp(`^${escapeRegExp(text)}$`).test(text)).toBe(true);
    expect(new RegExp(escapeRegExp('a.b')).test('axb')).toBe(false);
  });
});
