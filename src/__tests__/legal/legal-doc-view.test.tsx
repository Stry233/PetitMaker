/** English-only documents show a localized note; bilingual documents show the language control. */
import { describe, it, expect, afterEach } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { I18nProvider } from '../../i18n/context';
import LegalDocView from '../../legal/LegalDocView';
import { setStoreState } from '../_store';

function renderDoc(id: 'license' | 'privacy', lang: 'en' | 'zh') {
  return render(
    <I18nProvider>
      <LegalDocView id={id} lang={lang} onLang={() => {}} onBack={() => {}} />
    </I18nProvider>,
  );
}

function setLocale(locale: 'en' | 'zh' | 'fr') {
  act(() => { setStoreState({ locale }); });
}

afterEach(() => {
  cleanup();
  setStoreState({ locale: 'en' });
});

describe('LegalDocView English-only note', () => {
  it('shows the note for an en-only doc (license) when the UI locale is zh, with no language toggle', () => {
    setLocale('zh');
    renderDoc('license', 'en');
    const note = screen.getByTestId('en-only-note');
    expect(note.textContent).toBe('本文档仅提供英文版本。');
    expect(screen.queryByRole('group')).toBeNull();
  });

  it('hides the note for the same en-only doc (license) when the UI locale is en', () => {
    setLocale('en');
    renderDoc('license', 'en');
    expect(screen.queryByTestId('en-only-note')).toBeNull();
  });

  it('shows the note for an en-only doc (license) when the UI locale is fr', () => {
    setLocale('fr');
    renderDoc('license', 'en');
    const note = screen.getByTestId('en-only-note');
    expect(note).toBeTruthy();
    expect(screen.queryByRole('group')).toBeNull();
  });

  it('shows the language toggle instead of the note for a zh-capable doc (privacy) when the UI locale is zh', () => {
    setLocale('zh');
    renderDoc('privacy', 'zh');
    expect(screen.queryByTestId('en-only-note')).toBeNull();
    expect(screen.getByRole('group')).toBeTruthy();
  });
});
