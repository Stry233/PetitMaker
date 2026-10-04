// Placeholder substitution is literal: a param value is text, never a replacement pattern.
import { describe, it, expect } from 'vitest';
import { formatNumber, quantityParams, registerExtraStrings, translateFor } from '../../i18n/context';
import { translations } from '../../i18n/translations';
import type { Locale } from '../../core/model/types';
import { CHUNK_LOAD_LIMIT } from '../../core/model/game-profile';

registerExtraStrings({
  en: {
    'test.interp_once': 'Section {section} failed',
    'test.interp_twice': '{who} met {who}',
  },
});

describe('translateFor interpolation', () => {
  it('inserts a value carrying replacement patterns verbatim', () => {
    const value = "$` $' $& $$ $1";
    expect(translateFor('en', 'test.interp_once', { section: value })).toBe(`Section ${value} failed`);
  });

  it('keeps a value with replacement patterns intact in real copy', () => {
    expect(translateFor('en', 'import.warn_section', { section: '$`' })).toContain('$`');
  });

  it('replaces every occurrence of a placeholder used twice', () => {
    expect(translateFor('en', 'test.interp_twice', { who: 'Ada' })).toBe('Ada met Ada');
  });

  it('leaves a placeholder with no matching param in place', () => {
    expect(translateFor('en', 'test.interp_once', {})).toBe('Section {section} failed');
  });
});

describe('number params', () => {
  it('group five-digit integers in each locale and leave shorter numbers alone', () => {
    expect(formatNumber('en', 10000)).toBe('10,000');
    expect(formatNumber('id', 10000)).toBe('10.000');
    expect(formatNumber('ru', 10000)).toMatch(/^10\s000$/);
    expect(formatNumber('fr', 10000)).toMatch(/^10\s000$/);
    expect(formatNumber('en', 2026)).toBe('2026');
    expect(formatNumber('fr', 0.5)).toBe('0.5');
  });

  it('stay as written when they are identifiers, such as a recipe seed', () => {
    expect(translateFor('en', 'test.interp_once', { section: 24680 })).toBe('Section 24680 failed');
  });

  it('name the chunk load limit from its constant in every locale', () => {
    for (const locale of Object.keys(translations) as Locale[]) {
      const text = translateFor(locale, 'error.chunk_full', quantityParams(locale, { max: CHUNK_LOAD_LIMIT }));
      expect(text, locale).toContain(formatNumber(locale, CHUNK_LOAD_LIMIT));
      expect(translations[locale]['error.chunk_full'], locale).toContain('{max}');
    }
  });
});
