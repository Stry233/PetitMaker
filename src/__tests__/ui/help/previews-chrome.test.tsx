/**
 * The Help Center's chrome figures mount the real modals, so this pins the one thing a figure can
 * quietly break: the mount itself. Each preview renders its dialog (found by the real title the
 * modal carries) with no thrown error. `PreviewFrame` marks its whole subtree `aria-hidden` (it is a
 * picture, not a live surface), so every query here needs `hidden: true` or it would see nothing.
 */
import type { ReactElement } from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { I18nProvider } from '../../../i18n/context';
import { en } from '../../../i18n/locales/en';
import { setStoreState } from '../../_store';
import { SettingsPreview, KeyboardPreview, PlanetPreview } from '../../../ui/chrome/modals/help/figures/previews/chrome';

function label(key: string): string {
  const text = (en as Record<string, string | undefined>)[key];
  if (!text) throw new Error(`no English string for ${key}`);
  return text;
}

function renderPreview(Preview: () => ReactElement) {
  return render(
    <I18nProvider>
      <Preview />
    </I18nProvider>,
  );
}

afterEach(() => {
  cleanup();
});

describe('chrome previews', () => {
  it('mounts SettingsPreview with the real settings dialog', () => {
    setStoreState({ locale: 'en' });
    renderPreview(SettingsPreview);
    expect(screen.getByRole('dialog', { hidden: true, name: label('modal.settings_title') })).toBeTruthy();
  });

  it('mounts KeyboardPreview with the real keyboard board', () => {
    setStoreState({ locale: 'en' });
    renderPreview(KeyboardPreview);
    expect(screen.getByRole('dialog', { hidden: true, name: label('modal.keyboard_title') })).toBeTruthy();
  });

  it('mounts PlanetPreview with the real change-planet dialog', () => {
    setStoreState({ locale: 'en' });
    renderPreview(PlanetPreview);
    expect(screen.getByRole('dialog', { hidden: true, name: label('modal.new_title') })).toBeTruthy();
  });
});
