import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { useEditorStore } from '../../../state/store';
import { readPref, writePref } from '../../../core/runtime/prefs';
import { APP_VERSION } from '../../../version';
import { TOUR_SEEN_KEY } from '../../../ui/chrome/tour/use-tour';
import { WhatsNewGate } from '../../../ui/chrome/modals/whats-new/WhatsNewGate';
import { setStoreModal, setStoreState } from '../../_store';

// The version under test outranks any recorded one, as a real build's does a real visitor's.
vi.mock('../../../version', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../version')>()),
  APP_VERSION: '1.2.0',
}));

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const opened = () => useEditorStore.getState().modals.whatsNew;

beforeEach(() => {
  localStorage.clear();
  setStoreState({ locale: 'en', tourRunning: false, portraitBlocked: false });
  setStoreModal('whatsNew', false);
  setStoreModal('tourDone', false);
  setStoreModal('settings', false);
});

describe('when the What\'s new window opens', () => {
  it('opens for a returning browser on a version it has not seen, and records nothing until dismissed', async () => {
    localStorage.setItem(TOUR_SEEN_KEY, '1');
    writePref('lastSeenVersion', '0.0.1');
    render(<WhatsNewGate splashActive={false} />);
    await settle();
    expect(opened()).toBe(true);
    expect(readPref('lastSeenVersion')).toBe('0.0.1');
  });

  it('records the version silently on a first visit', async () => {
    render(<WhatsNewGate splashActive={false} />);
    await settle();
    expect(opened()).toBe(false);
    expect(readPref('lastSeenVersion')).toBe(APP_VERSION);
  });

  it('stays quiet on the version already seen', async () => {
    localStorage.setItem(TOUR_SEEN_KEY, '1');
    writePref('lastSeenVersion', APP_VERSION);
    render(<WhatsNewGate splashActive={false} />);
    await settle();
    expect(opened()).toBe(false);
  });

  it('waits behind the splash and any open window', async () => {
    localStorage.setItem(TOUR_SEEN_KEY, '1');
    writePref('lastSeenVersion', '0.0.1');
    setStoreModal('settings', true);
    const ui = render(<WhatsNewGate splashActive />);
    await settle();
    expect(opened()).toBe(false);
    ui.rerender(<WhatsNewGate splashActive={false} />);
    await settle();
    expect(opened()).toBe(false);
    act(() => setStoreModal('settings', false));
    await settle();
    expect(opened()).toBe(true);
  });
});
