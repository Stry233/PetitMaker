/**
 * The four assistant strings whose field has been measured. They stand in a one-line slot with an
 * ellipsis or in an input placeholder, which clips silently, and the Russian, Japanese, French and
 * Indonesian copy once lost the words that carry the meaning. Widths are advance sums in the app's
 * faces at the role's size and rooms are the slot's, both in frame px; changing a value means
 * measuring it against the same room.
 *
 *   agent.dock_err_auth      menu 14px/800, room ~111   ru 115.7 ->  74.4   ja 137.8 ->  96.9
 *   agent.dock_capped        menu 14px/800, room ~174   ru 183.8 -> 107.6
 *   agent.dock_asks_off      caption 12px/700, room ~147
 *                             ru 175.1 -> 122.1   ja 177.1 -> 106.3   fr 204.4 -> 104.6   id 167.5 -> 99.5
 *
 * Rooms are the live app's `scrollWidth - clientWidth` at the frame's 1.25, divided back out. Thai
 * is not pinned: the shipped fonts carry no Thai, so its metrics are the platform's.
 */
import { describe, it, expect } from 'vitest';
import { translations } from '../_support/locale-tables';

/** Each slot's key, and the value per locale that was measured to fit it. */
const MEASURED: Record<string, Partial<Record<keyof typeof translations, string>>> = {
  'agent.dock_err_auth': {
    ru: 'Отклонён.',
    ja: 'キー認証エラー',
  },
  'agent.dock_capped': {
    ru: 'Предел шагов.',
  },
  'agent.dock_asks_off': {
    ru: 'без подтверждений',
    ja: '今回は確認しません',
    fr: 'sans confirmation',
    id: 'tanpa konfirmasi',
  },
};

describe('the strings whose slot has been measured', () => {
  it('carries the value that was measured into it', () => {
    for (const [key, byLocale] of Object.entries(MEASURED)) {
      for (const [locale, value] of Object.entries(byLocale)) {
        expect(translations[locale as keyof typeof translations][key], `${locale} ${key}`).toBe(value);
      }
    }
  });

  it('is no longer than the value measured for it in any other locale', () => {
    // A crude second net, and deliberately loose: the slots above were sized for these lengths, and a
    // value arriving twice as long as the longest measured one is over whatever the exact room is.
    for (const key of Object.keys(MEASURED)) {
      const longest = Math.max(...Object.values(MEASURED[key]!).map((v) => [...v!].length));
      for (const locale of Object.keys(translations) as (keyof typeof translations)[]) {
        if (locale === 'th') continue; // no shipped face: the platform's metrics, not ours
        expect([...translations[locale][key]!].length, `${locale} ${key}`).toBeLessThanOrEqual(longest * 2);
      }
    }
  });
});
