// @vitest-environment jsdom
/** The menu's rows open their windows: each row is found by its role and label and pressed. */
import { createRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { I18nProvider } from '../../../../i18n/context';
import { translations } from '../../../_support/locale-tables';
import { MODAL_IDS } from '../../../../state/slices/shell';
import { useEditorStore } from '../../../../state/store';
import { MenuSheet } from '../../../../ui/shell/controls/MenuSheet';

const s = () => useEditorStore.getState();

function mount() {
  const trigger = createRef<HTMLButtonElement>();
  return render(
    <I18nProvider>
      <button ref={trigger} type="button" />
      <MenuSheet open onDismiss={vi.fn()} trigger={trigger as React.RefObject<HTMLElement>} />
    </I18nProvider>,
  );
}

beforeEach(() => {
  useEditorStore.setState({ locale: 'en', planetSession: null, repairSession: null });
  for (const id of MODAL_IDS) s().setModal(id, false);
});
afterEach(() => {
  cleanup();
  for (const id of MODAL_IDS) s().setModal(id, false);
});

describe('the menu', () => {
  const ROWS = [
    ['modal.new_title', 'newProject'],
    ['import.title', 'import'],
    ['modal.settings_title', 'settings'],
    ['modal.help_title', 'help'],
    ['modal.about_title', 'about'],
  ] as const;

  for (const [labelKey, window] of ROWS) {
    it(`opens the ${window} window from its row`, () => {
      mount();
      expect(s().modals[window]).toBe(false);
      fireEvent.click(screen.getByRole('menuitem', { name: translations.en[labelKey] }));
      expect(s().modals[window]).toBe(true);
    });
  }

  const HELD = [
    ['a planet being edited', { planetSession: { entryId: null } as never }],
    ['a hand repair', { repairSession: { phase: 'hand' } as never }],
  ] as const;

  for (const [session, state] of HELD) {
    it(`[UI-74] offers only Settings, Help and About during ${session}`, () => {
      useEditorStore.setState(state);
      mount();
      expect(screen.getAllByRole('menuitem').map((row) => row.textContent)).toEqual(
        (['modal.settings_title', 'modal.help_title', 'modal.about_title'] as const).map((key) => translations.en[key]),
      );
    });
  }
});
