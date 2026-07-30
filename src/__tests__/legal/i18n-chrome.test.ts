import { describe, it, expect } from 'vitest';
import { translations } from '../../i18n/translations';
import type { Locale } from '../../core/model/types';

// i18n chrome keys for legal surfaces — every key below must exist,
// non-empty, in all 7 locales. `about.disclaimer` must use `{app}` (no
// hardcoded brand name literal in place of the token).
const LOCALES: Locale[] = ['en', 'zh', 'ja', 'ru', 'th', 'id', 'fr'];

const KEYS = [
  'legal.section_title',
  'legal.doc_privacy',
  'legal.doc_terms',
  'legal.doc_license',
  'legal.doc_third_party',
  'legal.doc_asset_licenses',
  'legal.doc_about',
  'legal.doc_security',
  'legal.doc_contact',
  'legal.doc_changelog',
  'legal.back',
  'legal.lang_toggle_label',
  'legal.updated',
  'legal.zh_only_note',
  'about.team_title',
  'about.disclaimer',
  'about.copied',
  'about.copy_build',
  'about.filing_icp',
  'about.filing_psb',
];

describe('i18n chrome keys — legal surfaces', () => {
  it('every key is present in all 7 locales', () => {
    for (const key of KEYS) {
      for (const loc of LOCALES) {
        expect(translations[loc][key], `${loc}.${key}`).toBeDefined();
      }
    }
  });

  it('no locale value is empty', () => {
    for (const key of KEYS) {
      for (const loc of LOCALES) {
        const v = translations[loc][key];
        expect(v && v.trim().length > 0, `${loc}.${key} should be non-empty`).toBe(true);
      }
    }
  });

  it('about.disclaimer uses the {app} token in every locale (no hardcoded brand)', () => {
    for (const loc of LOCALES) {
      expect(translations[loc]['about.disclaimer']).toContain('{app}');
    }
  });

  // The embed_note caveat sentence is folded directly into
  // export.importable_sub (one flowing sub-caption string, no new UI element).
  it('export.importable_sub carries the embed caveat in every locale (en: "will not reliably remove")', () => {
    expect(translations.en['export.importable_sub']).toContain('will not reliably remove');
    const CAVEAT_SUBSTRING: Record<Locale, string> = {
      en: 'will not reliably remove',
      zh: '未必能移除',
      ja: '取り除けるとは限りません',
      ru: 'не гарантируют удаление',
      id: 'belum tentu menghilangkan',
      th: 'อาจไม่สามารถลบ',
      fr: 'ne supprime pas forcément',
    };
    for (const loc of LOCALES) {
      expect(translations[loc]['export.importable_sub'], `${loc} caveat`).toContain(CAVEAT_SUBSTRING[loc]);
    }
  });
});
