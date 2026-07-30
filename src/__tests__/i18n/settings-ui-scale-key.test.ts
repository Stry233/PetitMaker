import { describe, it, expect } from 'vitest';
import { translations } from '../../i18n/translations';
import type { Locale } from '../../core/model/types';

// The UI-scale settings row needs its label in every shipped locale. Parity is
// also covered by parity.test.ts, but this pins the specific key + a sensible
// non-empty translation per locale (×7).
const LOCALES: Locale[] = ['en', 'zh', 'ja', 'ru', 'th', 'id', 'fr'];

describe('i18n — modal.settings_ui_scale', () => {
  it.each(LOCALES)('%s defines a non-empty modal.settings_ui_scale', (loc) => {
    const v = translations[loc]['modal.settings_ui_scale'];
    expect(typeof v).toBe('string');
    expect((v ?? '').trim().length).toBeGreaterThan(0);
  });

  it('English label is "UI scale"', () => {
    expect(translations.en['modal.settings_ui_scale']).toBe('UI scale');
  });
});
