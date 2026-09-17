import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { I18nProvider, translate } from '../../../i18n/context';
import { useEditorStore } from '../../../state/store';
import { readPref, writePref } from '../../../core/runtime/prefs';
import { APP_VERSION } from '../../../version';
import { WhatsNewModal } from '../../../ui/chrome/modals/whats-new/WhatsNewModal';
import { setStoreModal, setStoreState } from '../../_store';

// The version under test outranks any recorded one, as a real build's does a real visitor's.
vi.mock('../../../version', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../version')>()),
  APP_VERSION: '1.2.0',
}));

beforeEach(() => {
  localStorage.clear();
  setStoreState({ locale: 'en', aboutTarget: null });
  writePref('lastSeenVersion', '0.0.1');
  setStoreModal('whatsNew', true);
});

const mount = () => render(<I18nProvider><WhatsNewModal /></I18nProvider>);

describe('the What\'s new window', () => {
  it('titles itself with the version and lists the notes', () => {
    mount();
    expect(screen.getByRole('dialog').getAttribute('aria-label')).toBe(translate('whatsnew.title', { version: APP_VERSION }));
    expect(screen.getAllByRole('listitem').length).toBeGreaterThan(0);
  });

  it('records the version when dismissed', () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: translate('whatsnew.got_it') }));
    expect(useEditorStore.getState().modals.whatsNew).toBe(false);
    expect(readPref('lastSeenVersion')).toBe(APP_VERSION);
  });

  it('hands over to About opened on the changelog', () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: translate('whatsnew.full_changelog') }));
    const st = useEditorStore.getState();
    expect(st.modals.whatsNew).toBe(false);
    expect(st.modals.about).toBe(true);
    expect(st.aboutTarget).toBe('changelog');
    expect(readPref('lastSeenVersion')).toBe(APP_VERSION);
  });
});
