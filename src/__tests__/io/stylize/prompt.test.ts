/**
 * The style packs are the four illustration directions drawn from the reference
 * pictures; `appendFragment` is the writing-desk chip joiner used by the custom direction.
 */
import { describe, it, expect } from 'vitest';
import { STYLE_PACKS } from '../../../io/stylize/presets';
import { appendFragment, CUSTOM_PROMPT_MAX } from '../../../io/stylize/prompt';

describe('appendFragment', () => {
  it('starts from empty with just the chip', () => {
    expect(appendFragment('', 'warm light')).toBe('warm light');
  });

  it('joins onto existing text with a comma', () => {
    expect(appendFragment('soft paper', 'warm light')).toBe('soft paper, warm light');
  });

  it('does not double a trailing comma', () => {
    expect(appendFragment('soft paper,', 'warm light')).toBe('soft paper, warm light');
  });

  it('is a no-op when the chip would push the result past the cap', () => {
    const current = 'a'.repeat(CUSTOM_PROMPT_MAX - 5);
    const result = appendFragment(current, 'a chip long enough to overflow the cap');
    expect(result).toBe(current);
  });
});

describe('STYLE_PACKS', () => {
  it('leads with the four reference-picture packs in display order', () => {
    expect(STYLE_PACKS.slice(0, 4).map((p) => p.id)).toEqual(['watercolor', 'coastal', 'sakura', 'autumn']);
    expect(STYLE_PACKS.length).toBeGreaterThanOrEqual(10);
    expect(new Set(STYLE_PACKS.map((p) => p.id)).size).toBe(STYLE_PACKS.length);
  });

  it('every pack has a nonempty fragment, paper, 4-6 palette entries and at least two elementStyles', () => {
    for (const pack of STYLE_PACKS) {
      expect(pack.fragment.length).toBeGreaterThan(0);
      expect(pack.paper).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(pack.palette.length).toBeGreaterThanOrEqual(4);
      expect(pack.palette.length).toBeLessThanOrEqual(6);
      expect(Object.keys(pack.elementStyles).length).toBeGreaterThanOrEqual(2);
    }
  });

  it('every pack carries literal i18n keys matching its own id', () => {
    for (const pack of STYLE_PACKS) {
      expect(pack.nameKey).toBe(`stylize.dir_${pack.id}`);
    }
  });
});
