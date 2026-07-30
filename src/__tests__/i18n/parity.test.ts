import { describe, it, expect } from 'vitest';
import { translations } from '../../i18n/translations';
import type { Locale } from '../../core/model/types';

// English is the documented source of truth (translateFor falls back to it).
const EN: Locale = 'en';
const enKeys = Object.keys(translations[EN]).sort();
const otherLocales = (Object.keys(translations) as Locale[]).filter((l) => l !== EN);

const placeholders = (s: string): string[] => (s.match(/\{[a-zA-Z0-9_]+\}/g) ?? []).sort();

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
        expect({ locale: loc, key: k, tokens: placeholders(v) })
          .toEqual({ locale: loc, key: k, tokens: placeholders(translations[EN][k]!) });
      }
    }
  });
});
