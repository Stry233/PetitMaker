/** The Help tables beside the interface tables: one key set and one placeholder set in every locale,
 *  and paired bold markers. They load as an overlay, so the main i18n suites do not see them. */
import { describe, expect, it } from 'vitest';
import { HELP_TABLES } from '../../../_support/locale-tables';
import { RESOLVED_TOKENS } from '../../../../i18n/context';

describe('the Help tables', () => {
  const LOCALES = Object.keys(HELP_TABLES) as (keyof typeof HELP_TABLES)[];
  const enKeys = Object.keys(HELP_TABLES.en);
  // Copy whose translator-filled tokens differ from en by design, by key and locale: zh names the
  // landmark where en says "it".
  const RESOLVED_DIFFERS: Readonly<Record<string, readonly string[]>> = { 'help.faq.a3': ['zh'] };
  // Translator-filled tokens count once each: a locale may repeat a name where its grammar wants it.
  // `{glyph}` is a fixed name each locale writes where its own sentence names it.
  const placeholders = (v: string, skipResolved = false) => {
    const all = (v.match(/\{[a-zA-Z0-9_]+\}/g) ?? []).filter((t) => t !== '{glyph}');
    const resolved = (t: string) => t.slice(1, -1) in RESOLVED_TOKENS;
    return [...all.filter((t) => !resolved(t)), ...(skipResolved ? [] : new Set(all.filter(resolved)))].sort();
  };

  it('holds every locale to the en key set', () => {
    for (const locale of LOCALES) {
      expect(Object.keys(HELP_TABLES[locale]).sort(), locale as string).toEqual([...enKeys].sort());
    }
  });

  it('holds every value to the en placeholder set', () => {
    for (const locale of LOCALES) {
      for (const key of enKeys) {
        const skip = RESOLVED_DIFFERS[key]?.includes(locale) ?? false;
        expect({ locale, key, tokens: placeholders(HELP_TABLES[locale][key]!, skip) })
          .toEqual({ locale, key, tokens: placeholders(HELP_TABLES.en[key]!, skip) });
      }
    }
  });

  it('pairs every bold marker', () => {
    const offenders: string[] = [];
    for (const locale of LOCALES) {
      for (const [key, value] of Object.entries(HELP_TABLES[locale])) {
        if ((value.split('**').length - 1) % 2 !== 0) offenders.push(`${locale as string} ${key} unpaired **`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
