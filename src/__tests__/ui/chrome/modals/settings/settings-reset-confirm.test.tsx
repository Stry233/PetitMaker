// @vitest-environment jsdom
// SettingsModal — the "Erase & restart" two-step confirm.
//
// The confirm is a small dialog over the dimmed panel (a second ModalShell), so the pill that
// opened it never vanishes and the settings card never changes height — the layout-stability
// rule. These pins cover the state machine (collapsed → dialog → cancel/confirm) and the
// stability facts jsdom can see: the pill stays in the document while the dialog stands.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SettingsModal } from '../../../../../ui/chrome/modals/settings/SettingsModal';
import { I18nProvider } from '../../../../../i18n/context';

vi.mock('../../../../../io/storage/local-reset', () => ({ resetAllLocalData: vi.fn(() => new Promise(() => {})) }));
import { resetAllLocalData } from '../../../../../io/storage/local-reset';
import { setStoreState } from '../../../../_support/store';

function renderModal() {
  return render(
    <I18nProvider>
      <SettingsModal open onClose={() => {}} />
    </I18nProvider>,
  );
}

beforeEach(() => {
  setStoreState({ locale: 'en', uiZoom: 1 });
  localStorage.clear();
  vi.clearAllMocks();
});

describe('SettingsModal — erase-confirm dialog', () => {
  it('starts closed: the pill is visible and no warning is', () => {
    renderModal();
    expect(screen.getByText('Erase & restart…')).toBeTruthy();
    expect(screen.queryByText(/Removes everything this app stored/)).toBeNull();
  });

  it('opens a dialog with the warning and both answers, and the pill STAYS where it was', () => {
    renderModal();
    fireEvent.click(screen.getByText('Erase & restart…'));
    expect(screen.getByRole('dialog', { name: 'Erase local data?' })).toBeTruthy();
    expect(screen.getByText(/Removes everything this app stored/)).toBeTruthy();
    expect(screen.getByText('Cancel')).toBeTruthy();
    expect(screen.getByText('Erase everything')).toBeTruthy();
    // Layout stability: the opener never vanishes from the meta row.
    expect(screen.getByText('Erase & restart…')).toBeTruthy();
  });

  // The dialog's shell keeps its card mounted while the exit animation plays (AnimatePresence),
  // so "closed" is awaited rather than asserted synchronously.
  it('Cancel closes the dialog and leaves the panel as it was', async () => {
    renderModal();
    fireEvent.click(screen.getByText('Erase & restart…'));
    fireEvent.click(screen.getByText('Cancel'));
    await waitFor(() => expect(screen.queryByText(/Removes everything this app stored/)).toBeNull());
    expect(screen.getByText('Erase & restart…')).toBeTruthy();
  });

  it('Confirm calls resetAllLocalData and swaps the buttons for a spinner', () => {
    renderModal();
    fireEvent.click(screen.getByText('Erase & restart…'));
    fireEvent.click(screen.getByText('Erase everything'));
    expect(resetAllLocalData).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Cancel')).toBeNull();
    expect(screen.queryByText('Erase everything')).toBeNull();
  });

  it('reopening Settings after a close starts with the dialog closed (open toggled false→true)', async () => {
    const { rerender } = renderModal();
    fireEvent.click(screen.getByText('Erase & restart…'));
    expect(screen.getByText(/Removes everything this app stored/)).toBeTruthy();

    rerender(<I18nProvider><SettingsModal open={false} onClose={() => {}} /></I18nProvider>);
    rerender(<I18nProvider><SettingsModal open onClose={() => {}} /></I18nProvider>);
    await waitFor(() => expect(screen.queryByText(/Removes everything this app stored/)).toBeNull());
    expect(screen.getByText('Erase & restart…')).toBeTruthy();
  });
});
