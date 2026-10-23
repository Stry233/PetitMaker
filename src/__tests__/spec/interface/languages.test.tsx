// @vitest-environment jsdom
/** The editor's seven languages: complete tables, and the language a visit opens in. */
import { afterEach, describe, expect, vi } from 'vitest';
import { waitFor } from '@testing-library/react';
import { spec } from '../../_support/spec';
import { LOCALES } from '../../../core/model/locale';
import { LOCALE_INFO } from '../../../i18n/locale-info';
import { translateFor } from '../../../i18n/context';
import { readPref } from '../../../platform/storage/prefs';
import { HELP_TABLES } from '../../_support/locale-tables';

const visit = (language: string): void => { vi.stubGlobal('navigator', { ...navigator, language }); };

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('the languages', () => {
  spec('UI-01', 'are the seven the editor promises, and Help leaves no value blank in any of them', () => {
    expect(LOCALES.map((l) => LOCALE_INFO[l].englishName).sort())
      .toEqual(['English', 'French', 'Indonesian', 'Japanese', 'Russian', 'Simplified Chinese', 'Thai']);
    for (const locale of LOCALES) {
      const blank = Object.entries(HELP_TABLES[locale]).filter(([, text]) => text.trim() === '').map(([key]) => key);
      expect({ locale, blank }).toEqual({ locale, blank: [] });
    }
  });
});

describe('the language a visit opens in', () => {
  spec('UI-02', 'follows the browser language on a first visit when it is one of the seven, and is English otherwise', () => {
    for (const [language, opens] of [['ja-JP', 'ja'], ['zh-Hant-TW', 'zh'], ['fr-CA', 'fr'], ['th', 'th'], ['de-DE', 'en'], ['pt-BR', 'en']] as const) {
      visit(language);
      expect(readPref('locale'), language).toBe(opens);
    }
  });

  spec('UI-02', 'remembers a chosen language and opens the next visit in it from the first frame', async () => {
    visit('en-US');
    const before = await import('../../../state/store');
    before.useEditorStore.getState().setLocale('ja');

    vi.resetModules();
    const { useEditorStore } = await import('../../../state/store');
    expect(useEditorStore.getState().locale).toBe('ja');
    const { mountApp } = await import('../../../ui/app/boot');
    const { I18nProvider, useT } = await import('../../../i18n/context');
    const frames: string[] = [];
    function FirstWords() {
      frames.push(useT()('generate.budget_adapted'));
      return null;
    }
    const root = document.body.appendChild(document.createElement('div'));
    mountApp(root, <I18nProvider><FirstWords /></I18nProvider>);
    await waitFor(() => expect(frames.length).toBeGreaterThan(0));
    expect(frames[0]).toBe(translateFor('ja', 'generate.budget_adapted'));
  });
});
