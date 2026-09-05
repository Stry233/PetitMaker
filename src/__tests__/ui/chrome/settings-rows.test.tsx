/**
 * Every control the Settings panel offers, and that each one still writes what it is for.
 *
 * The sibling files go deep on two controls (the size slider, the erase confirm). This one goes
 * WIDE: it is the inventory. The panel is picture-first — language pills, map-drawing toggles, a
 * quality trio rendered as the same map three ways — so what a control IS lives in its role and
 * accessible name, and the way a repaint loses one is not a crash but a control that quietly
 * stops being wired. The pin is "the control is there AND the handler fires".
 *
 * Classic cursor art and export branding are build choices, not user settings. The
 * Painted/System cursor pair is the accessibility opt-out and stays.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { I18nProvider } from '../../../i18n/context';
import { SettingsModal, type SettingsModalProps } from '../../../ui/chrome/modals/SettingsModal';
import { en } from '../../../i18n/locales/en';
import { setStoreState } from '../../_store';
import { useEditorStore } from '../../../state/store';

/** The English string a control shows. `en` reads as possibly-absent by index, and a key that is
 *  not there is a test bug rather than a missing assertion. */
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
    quality3d: 'auto' as const,
    onQuality3dChange: vi.fn(),
    ...handlers,
    ...overrides,
  };
  return render(<I18nProvider><SettingsModal {...props} /></I18nProvider>);
}

/** Every control's role and accessible name, in the order the panel lays them out. */
const CONTROLS = [
  ['radiogroup', 'modal.settings_language'],
  ['slider', 'modal.settings_ui_scale'],
  ['switch', 'modal.settings_grid'],
  ['switch', 'modal.settings_chunks'],
  ['radiogroup', 'modal.settings_quality3d'],
  ['radiogroup', 'modal.settings_motion'],
  ['radiogroup', 'modal.settings_cursor'],
  ['button', 'modal.keyboard_title'],
  ['button', 'modal.settings_tour'],
  ['button', 'modal.settings_ok'],
] as const;

beforeEach(() => {
  setStoreState({ locale: 'en' });
  for (const fn of Object.values(handlers)) fn.mockClear();
});

afterEach(cleanup);

describe('the Settings panel still offers every control', () => {
  it.each(CONTROLS)('%s named %s', (role, key) => {
    renderModal();
    expect(screen.getByRole(role, { name: label(key) })).toBeTruthy();
  });

  it('and no other cursor control: the classic-cursors setting is gone, not hidden', () => {
    renderModal();
    expect(screen.queryByText(/classic/i)).toBeNull();
  });

  it('does not expose the deploy-time export branding choice', () => {
    renderModal();
    expect(screen.queryByText('Logo only')).toBeNull();
    expect(screen.queryByText('Logo, site and QR code')).toBeNull();
  });
});

describe('and each control still writes its preference', () => {
  it('the language pills show all seven endonyms at once and report the chosen one', () => {
    renderModal();
    const band = screen.getByRole('radiogroup', { name: label('modal.settings_language') });
    expect(within(band).getAllByRole('radio')).toHaveLength(7);

    fireEvent.click(within(band).getByRole('radio', { name: '日本語' }));
    expect(handlers.onLocaleChange).toHaveBeenCalledWith('ja');
  });

  it('the size slider publishes its value to assistive tech', () => {
    renderModal();
    const slider = screen.getByRole('slider', { name: label('modal.settings_ui_scale') });
    expect(slider.getAttribute('aria-valuenow')).toBeTruthy();
  });

  it('the grid tile toggles', () => {
    renderModal({ showGrid: false });
    fireEvent.click(screen.getByRole('switch', { name: label('modal.settings_grid') }));
    expect(handlers.onShowGridChange).toHaveBeenCalledWith(true);
  });

  it('the chunk-bounds tile toggles', () => {
    renderModal({ showChunks: true });
    fireEvent.click(screen.getByRole('switch', { name: label('modal.settings_chunks') }));
    expect(handlers.onShowChunksChange).toHaveBeenCalledWith(false);
  });

  it('the quality trio reports the chosen rendering', () => {
    const onQuality3dChange = vi.fn();
    renderModal({ quality3d: 'auto', onQuality3dChange });
    const trio = screen.getByRole('radiogroup', { name: label('modal.settings_quality3d') });
    fireEvent.click(within(trio).getByRole('radio', { name: label('modal.settings_quality3d_lite') }));
    expect(onQuality3dChange).toHaveBeenCalledWith('lite');
  });

  it('the motion trio offers three states and reports the pressed one', () => {
    renderModal({ motionPref: 'system' });
    const trio = screen.getByRole('radiogroup', { name: label('modal.settings_motion') });
    fireEvent.click(within(trio).getByRole('radio', { name: label('modal.settings_motion_reduced') }));
    expect(handlers.onMotionPrefChange).toHaveBeenCalledWith('reduced');
  });

  it('the cursor pair reports both directions of the choice', () => {
    renderModal({ systemCursors: false });
    const pair = screen.getByRole('radiogroup', { name: label('modal.settings_cursor') });
    fireEvent.click(within(pair).getByRole('radio', { name: label('modal.settings_cursor_system') }));
    expect(handlers.onSystemCursorsChange).toHaveBeenCalledWith(true);

    cleanup();
    handlers.onSystemCursorsChange.mockClear();
    renderModal({ systemCursors: true });
    const pair2 = screen.getByRole('radiogroup', { name: label('modal.settings_cursor') });
    fireEvent.click(within(pair2).getByRole('radio', { name: label('modal.settings_cursor_painted') }));
    expect(handlers.onSystemCursorsChange).toHaveBeenCalledWith(false);
  });

  it('the identity readout drills into About, and carries the build number it drills into', () => {
    renderModal();
    // The readout reads "<Build> <number>" — matched by its leading word so the number can move.
    fireEvent.click(screen.getByText(new RegExp(`^${label('about.build')} \\S+`)));
    expect(handlers.onAbout).toHaveBeenCalled();
  });

  it('the keyboard picture closes the panel and opens the shortcuts window', () => {
    renderModal();
    expect(useEditorStore.getState().modals.keyboard).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: label('modal.keyboard_title') }));
    expect(handlers.onClose).toHaveBeenCalled();
    expect(useEditorStore.getState().modals.keyboard).toBe(true);
    useEditorStore.getState().setModal('keyboard', false);
  });

  it('the tour pill closes the panel before it starts the tour', () => {
    renderModal();
    fireEvent.click(screen.getByRole('button', { name: label('modal.settings_tour') }));
    expect(handlers.onClose).toHaveBeenCalled();
  });

  it('the local-data wipe asks first', () => {
    renderModal();
    fireEvent.click(screen.getByText(label('modal.settings_reset_btn')));
    expect(screen.getByText(label('modal.settings_reset_confirm'))).toBeTruthy();
  });
});
