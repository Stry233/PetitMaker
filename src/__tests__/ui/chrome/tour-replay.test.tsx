// V1-PINNED BEHAVIOUR: drives SettingsModal's "Show again" button directly; expected to be
// removed along with that modal.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { SettingsModal } from '../../../ui/chrome/modals/SettingsModal';
import { I18nProvider } from '../../../i18n/context';
import { useEditorStore } from '../../../state/store';
import { setStoreState } from '../../_store';
import { TOUR_SEEN_KEY } from '../../../ui/chrome/tour/use-tour';

const wrapper = ({ children }: { children: React.ReactNode }) => <I18nProvider>{children}</I18nProvider>;

const props = {
  open: true, locale: 'en' as const, showGrid: true, showChunks: true,
  motionPref: 'system' as const, systemCursors: false,
  onLocaleChange: vi.fn(), onShowGridChange: vi.fn(), onShowChunksChange: vi.fn(),
  onMotionPrefChange: vi.fn(), onSystemCursorsChange: vi.fn(),
  onAbout: vi.fn(), onClose: vi.fn(),
};

describe('Settings: replay the tour', () => {
  beforeEach(() => {
    setStoreState({ locale: 'en' });
    localStorage.setItem(TOUR_SEEN_KEY, '1');
    useEditorStore.getState().setTourRunning(false);
  });
  afterEach(cleanup);

  it('offers the tour again', () => {
    render(<SettingsModal {...props} />, { wrapper });
    expect(screen.getByRole('button', { name: 'Show again' })).toBeTruthy();
  });

  it('starts the tour and closes Settings', () => {
    render(<SettingsModal {...props} />, { wrapper });
    fireEvent.click(screen.getByRole('button', { name: 'Show again' }));
    expect(useEditorStore.getState().tourRunning).toBe(true);
    expect(props.onClose).toHaveBeenCalled();
  });
});
