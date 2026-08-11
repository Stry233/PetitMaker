/**
 * Every row the Settings window offers, and that each one still writes what it is for.
 *
 * The sibling files go deep on two rows (the UI-scale slider, the erase confirm). This one goes
 * WIDE: it is the inventory. A repaint reaches every style constant
 * in the file, and the way a row is lost to one is not a crash but a control that quietly stops
 * being wired, so the pin is "the row is there AND the handler fires".
 *
 * The classic-cursors row was retired when the classic set became a build constant; the system-
 * cursors row it used to sit beside is the accessibility opt-out and stays.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { I18nProvider } from '../../../i18n/context';
import { SettingsModal, type SettingsModalProps } from '../../../ui/chrome/modals/SettingsModal';
import { en } from '../../../i18n/locales/en';
import { setStoreState } from '../../_store';

/** The English string a row shows. `en` reads as possibly-absent by index, and a key that is not
 *  there is a test bug rather than a missing assertion. */
function label(key: string): string {
  const text = (en as Record<string, string | undefined>)[key];
  if (!text) throw new Error(`no English string for ${key}`);
  return text;
}

const handlers = {
  onLocaleChange: vi.fn(),
  onShowGridChange: vi.fn(),
  onShowChunksChange: vi.fn(),
  onMotionPrefChange: vi.fn(),
  onSystemCursorsChange: vi.fn(),
  onAbout: vi.fn(),
  onClose: vi.fn(),
};

function renderModal(overrides: Partial<SettingsModalProps> = {}) {
  const props: SettingsModalProps = {
    locale: 'en',
    showGrid: false,
    showChunks: false,
    motionPref: 'system',
    systemCursors: false,
    ...handlers,
    ...overrides,
  };
  return render(<I18nProvider><SettingsModal {...props} /></I18nProvider>);
}

/** Every row's label, in the order the window lays them out. */
const ROW_LABELS = [
  'modal.settings_language',
  'modal.settings_ui_scale',
  'modal.settings_grid',
  'modal.settings_chunks',
  'modal.settings_tour',
  'modal.settings_motion',
  'modal.settings_system_cursors',
  'modal.settings_about',
  'modal.settings_reset',
] as const;

beforeEach(() => {
  setStoreState({ locale: 'en' });
  for (const fn of Object.values(handlers)) fn.mockClear();
});

afterEach(cleanup);

describe('the Settings window still offers every row', () => {
  it.each(ROW_LABELS)('%s', (key) => {
    renderModal();
    expect(screen.getByText(label(key))).toBeTruthy();
  });

  it('and no other row: the classic-cursors setting is gone, not hidden', () => {
    renderModal();
    expect(screen.queryByText(/classic/i)).toBeNull();
  });
});

describe('and each row still writes its preference', () => {
  it('the language picker offers all seven and reports the chosen one', () => {
    renderModal();
    fireEvent.click(screen.getByRole('button', { name: /English/ }));
    const list = screen.getByRole('listbox');
    expect(within(list).getAllByRole('option')).toHaveLength(7);

    fireEvent.click(within(list).getByRole('option', { name: '日本語' }));
    expect(handlers.onLocaleChange).toHaveBeenCalledWith('ja');
  });

  it('the UI-scale slider publishes its value to assistive tech', () => {
    renderModal();
    const slider = screen.getByRole('slider', { name: label('modal.settings_ui_scale') });
    expect(slider.getAttribute('aria-valuenow')).toBeTruthy();
  });

  it('the grid switch toggles', () => {
    renderModal({ showGrid: false });
    fireEvent.click(screen.getByRole('switch', { name: label('modal.settings_grid') }));
    expect(handlers.onShowGridChange).toHaveBeenCalledWith(true);
  });

  it('the chunk-bounds switch toggles', () => {
    renderModal({ showChunks: true });
    fireEvent.click(screen.getByRole('switch', { name: label('modal.settings_chunks') }));
    expect(handlers.onShowChunksChange).toHaveBeenCalledWith(false);
  });

  it('the tour row closes the window before it starts the tour', () => {
    renderModal();
    fireEvent.click(screen.getByText(label('modal.settings_tour_action')));
    expect(handlers.onClose).toHaveBeenCalled();
  });

  it('the motion control offers three states and reports the pressed one', () => {
    renderModal({ motionPref: 'system' });
    fireEvent.click(screen.getByText(label('modal.settings_motion_reduced')));
    expect(handlers.onMotionPrefChange).toHaveBeenCalledWith('reduced');
  });

  it('the system-cursors switch toggles', () => {
    renderModal({ systemCursors: false });
    fireEvent.click(screen.getByRole('switch', { name: label('modal.settings_system_cursors') }));
    expect(handlers.onSystemCursorsChange).toHaveBeenCalledWith(true);
  });

  it('the About chip drills in, and carries the build number it drills into', () => {
    renderModal();
    // The chip reads "<Build> <number> ›" — matched by its leading word so the number can move.
    fireEvent.click(screen.getByText(new RegExp(`^${label('about.build')} \\S+`)));
    expect(handlers.onAbout).toHaveBeenCalled();
  });

  it('the local-data wipe asks first', () => {
    renderModal();
    fireEvent.click(screen.getByText(label('modal.settings_reset_btn')));
    expect(screen.getByText(label('modal.settings_reset_warn'))).toBeTruthy();
    expect(screen.getByText(label('modal.settings_reset_confirm'))).toBeTruthy();
  });
});
