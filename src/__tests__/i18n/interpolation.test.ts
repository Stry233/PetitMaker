// Placeholder substitution is literal: a param value is text, never a replacement pattern.
import { describe, it, expect } from 'vitest';
import { registerExtraStrings, translateFor } from '../../i18n/context';

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
