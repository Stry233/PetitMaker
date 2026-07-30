// Direct unit test for LegalDocView's "maintained in English" chrome — a
// regression pin, not a duplicate of the existing About-modal integration
// coverage (about-modal.test.tsx / a11y.test.tsx exercise the same component
// through the lazy modal shell; this file targets LegalDocView in isolation
// so a future refactor of the modal/morph chrome can't silently drop the
// note without a direct test failing).
//
// Current behaviour: the note is gated on `!hasZh && uiLocale !== 'en'` —
// i.e. an EN-only doc (`source.zh === null`) AND the UI locale is any
// non-English locale (not just 'zh'). It renders in the scrolling BODY area
// above the markdown — not in the header where the language toggle lives.
// Each non-English locale shows its own translation of the `legal.zh_only_note` key.
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
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

afterEach(() => {
  setStoreState({ locale: 'en' });
});

describe('LegalDocView — en-only doc "maintained in English" note', () => {
  it('shows the note for an en-only doc (license) when the UI locale is zh, with no language toggle', () => {
    setStoreState({ locale: 'zh' });
    renderDoc('license', 'en');
    const note = screen.getByTestId('en-only-note');
    expect(note.textContent).toBe('本文档仅提供英文版本。');
    expect(screen.queryByRole('group')).toBeNull(); // the toggle's role="group" wrapper
  });

  it('hides the note for the same en-only doc (license) when the UI locale is en', () => {
    setStoreState({ locale: 'en' });
    renderDoc('license', 'en');
    expect(screen.queryByTestId('en-only-note')).toBeNull();
  });

  it('shows the note for an en-only doc (license) when the UI locale is fr', () => {
    setStoreState({ locale: 'fr' });
    renderDoc('license', 'en');
    const note = screen.getByTestId('en-only-note');
    expect(note).toBeTruthy();
    expect(screen.queryByRole('group')).toBeNull(); // no language toggle for en-only docs
  });

  it('shows the language toggle instead of the note for a zh-capable doc (privacy) when the UI locale is zh', () => {
    setStoreState({ locale: 'zh' });
    renderDoc('privacy', 'zh');
    expect(screen.queryByTestId('en-only-note')).toBeNull();
    expect(screen.getByRole('group')).toBeTruthy();
  });
});
