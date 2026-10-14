// Placeholder substitution is literal: a param value is text, never a replacement pattern.
import { describe, it, expect } from 'vitest';
import { formatNumber, quantityParams, translateFor } from '../../i18n/context';
import { helpTranslations, registerLocaleTable } from '../../i18n/translations';
import { translations } from '../_support/locale-tables';
import type { Locale } from '../../core/model/locale';
import { CHUNK_LOAD_LIMIT } from '../../core/game/profile';
import type { TextKey } from '../../i18n/keys';

// Registered as an addition to the English Help part, which the interface table always outranks.
registerLocaleTable('en', {
  ...helpTranslations.en,
  'test.interp_once': 'Section {section} failed',
  'test.interp_twice': '{who} met {who}',
  'test.interp_label': 'Press {ui:modal.settings_reset_btn}',
}, 'help');

/** The keys this file registers beside the shipped tables. */
const ONCE = 'test.interp_once' as TextKey;
const TWICE = 'test.interp_twice' as TextKey;

describe('translateFor interpolation', () => {
  it('inserts a value carrying replacement patterns verbatim', () => {
    const value = "$` $' $& $$ $1";
    expect(translateFor('en', ONCE, { section: value })).toBe(`Section ${value} failed`);
  });

  it('keeps a value with replacement patterns intact in real copy', () => {
    expect(translateFor('en', 'import.warn_section', { section: '$`' })).toContain('$`');
  });

  it('replaces every occurrence of a placeholder used twice', () => {
    expect(translateFor('en', TWICE, { who: 'Ada' })).toBe('Ada met Ada');
  });

  it('keeps a placeholder inside a param value literal, so typed text is never substituted again', () => {
    expect(translateFor('en', 'stylize.entry_version', { name: 'My {n} map', n: 3 })).toBe('Applied: My {n} map, take 3');
    expect(translateFor('en', TWICE, { who: '{who} and {app} and {ui:delete.confirm_btn}' }))
      .toBe('{who} and {app} and {ui:delete.confirm_btn} met {who} and {app} and {ui:delete.confirm_btn}');
  });

  it('names a control by its label without the ellipsis it wears for a further step', () => {
    expect(translations.en['modal.settings_reset_btn']).toMatch(/…$/);
    expect(translateFor('en', 'test.interp_label' as TextKey)).toBe(`Press ${translations.en['modal.settings_reset_btn']!.slice(0, -1)}`);
  });

  it('leaves a placeholder with no matching param in place', () => {
    expect(translateFor('en', ONCE, {})).toBe('Section {section} failed');
  });
});

describe('number params', () => {
  it('group five-digit integers in each locale, leave shorter integers alone and write fractions with the locale decimal mark', () => {
    expect(formatNumber('en', 10000)).toBe('10,000');
    expect(formatNumber('id', 10000)).toBe('10.000');
    expect(formatNumber('ru', 10000)).toMatch(/^10\s000$/);
    expect(formatNumber('fr', 10000)).toMatch(/^10\s000$/);
    expect(formatNumber('en', 2026)).toBe('2026');
    expect(formatNumber('fr', 0.5)).toBe('0,5');
    expect(formatNumber('en', 2.6)).toBe('2.6');
  });

  it('stay as written when they are identifiers, such as a recipe seed', () => {
    expect(translateFor('en', ONCE, { section: 24680 })).toBe('Section 24680 failed');
  });

  it('name the chunk load limit from its constant in every locale', () => {
    for (const locale of Object.keys(translations) as Locale[]) {
      const text = translateFor(locale, 'error.chunk_full', quantityParams(locale, { max: CHUNK_LOAD_LIMIT }));
      expect(text, locale).toContain(formatNumber(locale, CHUNK_LOAD_LIMIT));
      expect(translations[locale]['error.chunk_full'], locale).toContain('{max}');
    }
  });
});

describe('plural forms', () => {
  const ru = (n: number | string) => translateFor('ru', 'units.cells', { n });

  it('pick the variant the locale selects for {n}, the bare key being the other form', () => {
    expect(translateFor('en', 'units.cells', { n: 1 })).toBe('1 cell');
    expect(translateFor('en', 'units.cells', { n: 0 })).toBe('0 cells');
    expect(translateFor('fr', 'units.cells', { n: 0 })).toBe('0 case');
    expect(ru(1)).toBe(translations.ru['units.cells_one']!.replace('{n}', '1'));
    expect(ru(3)).toBe(translations.ru['units.cells_few']!.replace('{n}', '3'));
    expect(ru(21)).toBe(translations.ru['units.cells_one']!.replace('{n}', '21'));
    expect(ru(11)).toBe(translations.ru['units.cells_many']!.replace('{n}', '11'));
    expect(translateFor('zh', 'units.cells', { n: 1 })).toBe(translations.zh['units.cells']!.replace('{n}', '1'));
  });

  it('read the count from a grouped quantity', () => {
    expect(translateFor('ru', 'units.cells', quantityParams('ru', { n: 10001 })))
      .toBe(translations.ru['units.cells_one']!.replace('{n}', formatNumber('ru', 10001)));
    expect(translateFor('en', 'units.cells', quantityParams('en', { n: 10000 }))).toBe('10,000 cells');
  });

  it('read the exact-one wording for a count of 1 only, ahead of the plural category', () => {
    const thought = (locale: Locale, n: number) => translateFor(locale, 'agent.thoughts_total', { t: '5s', n });
    expect(thought('en', 1)).toBe(translations.en['agent.thoughts_total_single']!.replace('{t}', '5s'));
    expect(thought('ru', 1)).toBe(translations.ru['agent.thoughts_total_single']!.replace('{t}', '5s'));
    expect(thought('ru', 21)).toBe(translations.ru['agent.thoughts_total_one']!.replace('{t}', '5s').replace('{n}', '21'));
    expect(thought('en', 2)).toBe('thought for 5s across 2 turns');
  });

  it('leave a non-numeric {n} on the bare key', () => {
    expect(translateFor('en', 'units.cells', { n: 'some' })).toBe('some cells');
  });
});
