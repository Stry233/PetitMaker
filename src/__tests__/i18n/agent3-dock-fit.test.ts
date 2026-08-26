/**
 * The four assistant strings whose FIELD has been measured, and the values that were measured into it.
 *
 * Every other panel string either wraps, expands on a tap or has room to spare. These four stand in a
 * ONE-LINE slot with a declared ellipsis (the dock's word and its session mark) or in a native input's
 * placeholder, which clips SILENTLY — no ellipsis, no `scrollWidth` growth, so neither the suite nor a
 * screenshot pair can see the cut. What was lost in four locales was the very fact the slot exists to
 * carry: "Ключ отклон…" for a refused key, "Достигнут предел ша…" for the turn cap, "…настройк" where
 * the composer says why it is off.
 *
 * SO THE VALUES ARE PINNED, and the numbers behind them are recorded here rather than recomputed: the
 * widths below are advance sums in the app's own faces ('Alibaba PuHuiTi 3' first, Quicksand behind
 * it) at the role's own size, and the room is the slot's, both in frame px. Changing one of these
 * values means measuring the new one against the same room, which is what this test asks by failing.
 *
 *   agent3.dock_err_auth      menu 14px/800, room ~111   ru 115.7 ->  74.4   ja 137.8 ->  96.9
 *   agent3.dock_capped        menu 14px/800, room ~174   ru 183.8 -> 107.6
 *   agent3.dock_asks_off      caption 12px/700, room ~147
 *                             ru 175.1 -> 122.1   ja 177.1 -> 106.3   fr 204.4 -> 104.6   id 167.5 -> 99.5
 *
 * The rooms are the live app's own readings (`scrollWidth - clientWidth` at the frame's 1.25, divided
 * back out) less what each face overflowed by. Thai is not measurable this way and is not pinned: the
 * shipped fonts carry no Thai, so the browser draws it in a system face whose metrics are the
 * platform's.
 */
import { describe, it, expect } from 'vitest';
import { translations } from '../../i18n/translations';

/** Each slot's key, and the value per locale that was measured to fit it. */
const MEASURED: Record<string, Partial<Record<keyof typeof translations, string>>> = {
  'agent3.dock_err_auth': {
    ru: 'Отклонён.',
    ja: 'キー認証エラー',
  },
  'agent3.dock_capped': {
    ru: 'Предел шагов.',
  },
  'agent3.dock_asks_off': {
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
