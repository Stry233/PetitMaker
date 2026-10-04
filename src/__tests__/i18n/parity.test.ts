import { describe, it, expect } from 'vitest';
import { translations } from '../../i18n/translations';
import { RESOLVED_TOKENS } from '../../i18n/context';
import type { Locale } from '../../core/model/types';

// English is the documented source of truth (translateFor falls back to it).
const EN: Locale = 'en';
const enKeys = Object.keys(translations[EN]).sort();
const otherLocales = (Object.keys(translations) as Locale[]).filter((l) => l !== EN);

/** Copy that leaves out the `{landmark}` token, by key and locale; every other token must match. */
const OMITS_LANDMARK: Readonly<Record<string, readonly Locale[]>> = {
  'agent3.dream_pond': ['ru', 'fr', 'id'],
};

/** Caller params as a sorted list; translator-filled tokens once each, since a locale may repeat
 *  a name where its grammar wants it. */
const placeholders = (s: string, omitLandmark = false): string[] => {
  const all = s.match(/\{[a-zA-Z0-9_]+\}/g) ?? [];
  const resolved = (t: string) => t.slice(1, -1) in RESOLVED_TOKENS;
  const kept = new Set(all.filter((t) => resolved(t) && !(omitLandmark && t === '{landmark}')));
  return [...all.filter((t) => !resolved(t)), ...kept].sort();
};

describe('i18n locale parity', () => {
  it('every locale defines exactly the en key set (no missing, no extra)', () => {
    for (const loc of otherLocales) {
      const missing = enKeys.filter((k) => !(k in translations[loc]));
      const extra = Object.keys(translations[loc]).filter((k) => !(k in translations[EN]));
      expect({ locale: loc, missing, extra }).toEqual({ locale: loc, missing: [], extra: [] });
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
