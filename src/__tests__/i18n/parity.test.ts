import { describe, it, expect } from 'vitest';
import { HELP_TABLES, translations } from '../_support/locale-tables';
import { RESOLVED_TOKENS } from '../../i18n/context';
import type { Locale } from '../../core/model/locale';
import { localeTag } from '../../i18n/locale-info';
import { pluralBase } from '../_support/plural-keys';

// English is the documented source of truth (translateFor falls back to it).
const EN: Locale = 'en';
const otherLocales = (Object.keys(translations) as Locale[]).filter((l) => l !== EN);

/** The categories `locale`'s plural rules can select. */
const categoriesOf = (locale: Locale) => new Set(new Intl.PluralRules(localeTag(locale)).resolvedOptions().pluralCategories);

/** The plural categories a whole count below 1000 selects in `locale`, besides `other`, which the
 *  bare key carries: `one` in en and fr, `one`, `few` and `many` in ru, none in zh, ja, th and id. A
 *  key en counts is counted in every locale, and a locale that writes one variant of a key writes
 *  them all. */
const countCategories = (locale: Locale): Intl.LDMLPluralRule[] => {
  const rules = new Intl.PluralRules(localeTag(locale));
  const selected = new Set(Array.from({ length: 1000 }, (_, n) => rules.select(n)));
  selected.delete('other');
  return [...selected].sort();
};

/** The key set every locale shares: plural variants are each locale's own business. */
const enKeys = Object.keys(translations[EN]).filter((k) => pluralBase(k) === null).sort();

/** Copy that leaves out the `{landmark}` token, by key and locale; every other token must match. */
const OMITS_LANDMARK: Readonly<Record<string, readonly Locale[]>> = {
  'agent.dream_pond': ['ru', 'fr', 'id'],
};

/** Caller params as a sorted list; translator-filled tokens once each, since a locale may repeat
 *  a name where its grammar wants it. `{glyph}` is a fixed name each locale writes where its own
 *  sentence names it. */
const placeholders = (s: string, omitLandmark = false): string[] => {
  const all = (s.match(/\{[a-zA-Z0-9_]+\}/g) ?? []).filter((t) => t !== '{glyph}');
  const resolved = (t: string) => t.slice(1, -1) in RESOLVED_TOKENS;
  const kept = new Set(all.filter((t) => resolved(t) && !(omitLandmark && t === '{landmark}')));
  return [...all.filter((t) => !resolved(t)), ...kept].sort();
};

describe('i18n locale parity', () => {
  it('every locale defines exactly the en key set (no missing, no extra)', () => {
    for (const loc of otherLocales) {
      const missing = enKeys.filter((k) => !(k in translations[loc]));
      const extra = Object.keys(translations[loc]).filter((k) => !(k in translations[EN]) && pluralBase(k) === null);
      expect({ locale: loc, missing, extra }).toEqual({ locale: loc, missing: [], extra: [] });
    }
  });

  it('declares plural variants only for categories the locale can select, each with the base tokens', () => {
    for (const loc of [EN, ...otherLocales]) {
      const selectable = categoriesOf(loc);
      for (const [key, value] of Object.entries(translations[loc])) {
        const base = pluralBase(key);
        if (base === null) continue;
        const category = key.slice(base.length + 1) as Intl.LDMLPluralRule;
        expect({ locale: loc, key, selectable: selectable.has(category) }).toEqual({ locale: loc, key, selectable: true });
        expect({ locale: loc, key, tokens: placeholders(value) }).toEqual({ locale: loc, key, tokens: placeholders(translations[EN][base]!) });
      }
    }
  });

  it('gives a counted string every form its locale selects for a whole count', () => {
    for (const tables of [translations, HELP_TABLES] as readonly Readonly<Record<Locale, Readonly<Record<string, string>>>>[]) {
      const variantBases = (loc: Locale) => Object.keys(tables[loc]).flatMap((key) => {
        const m = /^(.*)_(zero|one|two|few|many)$/.exec(key);
        return m && m[1]! in tables[EN] ? [m[1]!] : [];
      });
      const countedInEn = variantBases(EN);
      for (const loc of [EN, ...otherLocales]) {
        const forms = countCategories(loc);
        const counted = new Set([...countedInEn, ...variantBases(loc)]);
        const missing = [...counted].sort().flatMap((base) =>
          forms.filter((c) => !(`${base}_${c}` in tables[loc])).map((c) => `${base}_${c}`));
        expect({ locale: loc, missing }).toEqual({ locale: loc, missing: [] });
      }
    }
  });

  it('no locale leaves a value blank', () => {
    for (const loc of [EN, ...otherLocales]) {
      const blank = Object.entries(translations[loc]).filter(([, v]) => typeof v !== 'string' || v.trim() === '').map(([k]) => k);
      expect({ locale: loc, blank }).toEqual({ locale: loc, blank: [] });
    }
  });

  it('interpolation placeholders ({x}) match en for every key', () => {
    for (const loc of otherLocales) {
      for (const k of enKeys) {
        const v = translations[loc][k];
        if (v === undefined) continue; // a missing key is already reported by the test above
        const omit = OMITS_LANDMARK[k]?.includes(loc) ?? false;
        expect({ locale: loc, key: k, tokens: placeholders(v, omit) })
          .toEqual({ locale: loc, key: k, tokens: placeholders(translations[EN][k]!, omit) });
      }
    }
  });
});
