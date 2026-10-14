import { describe, expect, it } from 'vitest';
import { isEmojiGrapheme, limitTextGraphemes, normalizeTextPresentation } from '../../../../tools/generation/stencil/stencil-text-segments';
import { graphemes } from '../../../../core/base/text';
import { scriptOf, textMinBox } from '../../../../tools/generation/stencil/stencil';

const sequences = ['e\u0301', '👍🏽', '👩‍🌾', '👨‍👩‍👧‍👦', '🇨🇳', '1️⃣', '1⃣', '🏴\u{e0067}\u{e0062}\u{e0065}\u{e006e}\u{e0067}\u{e007f}'];

describe('text graphemes', () => {
  it.each(sequences)('keeps %s intact when counting and truncating input', glyph => {
    expect(graphemes(glyph)).toEqual([glyph]);
    expect(limitTextGraphemes(glyph.repeat(7), 6)).toBe(glyph.repeat(6));
    expect(textMinBox(glyph).width).toBe(textMinBox(glyph).height);
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
});
