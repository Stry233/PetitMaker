/**
 * The figures for the two surfaces the map raises mount those surfaces' own faces, so this pins
 * what a redrawing would lose: the ROWS the menu offers for each target, and the words the
 * confirmation asks. `PreviewFrame` marks its subtree `aria-hidden`, so every query needs
 * `hidden: true`.
 */
import type { ReactElement } from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { I18nProvider } from '../../../i18n/context';
import { en } from '../../../i18n/locales/en';
import { setStoreState } from '../../_store';
import { getCatalogItem } from '../../../state/catalog';
import { ContextMenuPreview, DeleteConfirmPreview } from '../../../ui/chrome/modals/help/figures/previews/floating';

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

describe('the floating-surface previews', () => {
  it('shows the object menu whole and the terrain menu beside it', () => {
    setStoreState({ locale: 'en' });
    renderPreview(ContextMenuPreview);
    // Both menus stand: four facings from the object's, and one Delete row each.
    for (const angle of [0, 90, 180, 270]) {
      expect(screen.getByText(label(`context.rotate_${angle}`), { selector: 'button' })).toBeTruthy();
    }
    expect(screen.getAllByText(label('context.delete'), { selector: 'button' })).toHaveLength(2);
  });

  it('asks the confirmation in the app\'s own words, naming the piece', () => {
    setStoreState({ locale: 'en' });
    renderPreview(DeleteConfirmPreview);
    const name = getCatalogItem('building-forest-cabin')!.name.en!;
    expect(screen.getByText(label('delete.confirm').replace('{name}', name))).toBeTruthy();
    expect(screen.getByText(label('delete.cancel'), { selector: 'button' })).toBeTruthy();
    expect(screen.getByText(label('delete.confirm_btn'), { selector: 'button' })).toBeTruthy();
  });
});
