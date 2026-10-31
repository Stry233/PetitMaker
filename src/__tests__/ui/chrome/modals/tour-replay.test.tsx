// @vitest-environment jsdom
// The tour is replayed from the Settings panel's tour pill, which this drives directly.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { SettingsModal } from '../../../../ui/chrome/modals/settings/SettingsModal';
import { I18nProvider } from '../../../../i18n/context';
import { useEditorStore } from '../../../../state/store';
import { setStoreState } from '../../../_support/store';
import { TOUR_OFFERED, TOUR_SEEN_KEY } from '../../../_support/tour';

const wrapper = ({ children }: { children: React.ReactNode }) => <I18nProvider>{children}</I18nProvider>;

const props = { open: true, onClose: vi.fn() };

describe('Settings: replay the tour', () => {
  beforeEach(() => {
    setStoreState({ locale: 'en' });
    localStorage.setItem(TOUR_SEEN_KEY, TOUR_OFFERED);
    useEditorStore.getState().setTourRunning(false);
  });
  afterEach(cleanup);

  it('offers the tour again', () => {
    render(<SettingsModal {...props} />, { wrapper });
    expect(screen.getByRole('button', { name: 'Show the welcome tips' })).toBeTruthy();
  });

  it('starts the tour and closes Settings', () => {
    render(<SettingsModal {...props} />, { wrapper });
    fireEvent.click(screen.getByRole('button', { name: 'Show the welcome tips' }));
    expect(useEditorStore.getState().tourRunning).toBe(true);
    expect(props.onClose).toHaveBeenCalled();
  });
});
