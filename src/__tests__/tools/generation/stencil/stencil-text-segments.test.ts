import { describe, expect, it, vi } from 'vitest';
import { isEmojiGrapheme, limitTextGraphemes, normalizeTextPresentation, textGraphemes } from '../../../../tools/generation/stencil/stencil-text-segments';
import { scriptOf, textMinBox } from '../../../../tools/generation/stencil/stencil';

const sequences = ['e\u0301', '👍🏽', '👩‍🌾', '👨‍👩‍👧‍👦', '🇨🇳', '1️⃣', '1⃣', '🏴\u{e0067}\u{e0062}\u{e0065}\u{e006e}\u{e0067}\u{e007f}'];

describe('text graphemes', () => {
  it.each(sequences)('keeps %s intact when counting and truncating input', glyph => {
    expect(textGraphemes(glyph)).toEqual([glyph]);
    expect(limitTextGraphemes(glyph.repeat(7), 6)).toBe(glyph.repeat(6));
    expect(textMinBox(glyph).width).toBe(textMinBox(glyph).height);
  });

  it('uses full grapheme boundaries for conjuncts and Hangul syllables', () => {
    expect(textGraphemes('क्ष')).toEqual(['क्ष']);
    expect(textGraphemes('\u1100\u1161')).toEqual(['\u1100\u1161']);
  });

  it('recognizes emoji sequences while preserving text presentation and supplementary Han', () => {
    for (const glyph of sequences.slice(1)) expect(isEmojiGrapheme(glyph), glyph).toBe(true);
    expect(isEmojiGrapheme('♥︎')).toBe(false);
    expect(isEmojiGrapheme('1')).toBe(false);
    expect(scriptOf('𠀀')).toBe('dense');
    expect(scriptOf('谷🌳')).toBe('picture');
  });

  it('normalizes accents and unqualified keycaps without replacing text presentation', () => {
    expect(normalizeTextPresentation('e\u0301 1⃣ #⃣')).toBe('é 1️⃣ #️⃣');
    expect(normalizeTextPresentation('♥︎')).toBe('♥︎');
  });

  it('keeps common joined sequences intact without Intl.Segmenter', async () => {
    const native = Object.getOwnPropertyDescriptor(Intl, 'Segmenter')!;
    try {
      Object.defineProperty(Intl, 'Segmenter', { ...native, value: undefined });
      vi.resetModules();
      const fallback = await import('../../../../tools/generation/stencil/stencil-text-segments');
      for (const glyph of sequences) expect(fallback.textGraphemes(glyph), glyph).toEqual([glyph]);
      expect(fallback.textGraphemes('🇨🇳🇯🇵')).toEqual(['🇨🇳', '🇯🇵']);
    } finally {
      Object.defineProperty(Intl, 'Segmenter', native);
      vi.resetModules();
    }
  });
});
