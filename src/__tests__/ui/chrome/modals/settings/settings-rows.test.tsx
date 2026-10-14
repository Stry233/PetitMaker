// @vitest-environment jsdom
/**
 * Every control the Settings panel offers, and that each one still writes what it is for.
 *
 * The sibling files go deep on two controls (the size slider, the erase confirm). This one goes
 * Wide: it is the inventory. The panel is picture-first — language pills, map-drawing toggles, a
 * quality trio rendered as the same map three ways — so what a control is lives in its role and
 * accessible name, and the way a repaint loses one is not a crash but a control that quietly
 * stops being wired. The pin is "the control is there AND the handler fires".
 *
 * Export branding is a build choice, not a user setting. The Painted/System cursor pair is the
 * accessibility opt-out and stays.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { I18nProvider } from '../../../../../i18n/context';
import { SettingsModal } from '../../../../../ui/chrome/modals/settings/SettingsModal';
import { en } from '../../../../../i18n/locales/en';
import { setStoreState } from '../../../../_support/store';
import { useEditorStore, type EditorStore } from '../../../../../state/store';

/** The English string a control shows. `en` reads as possibly-absent by index, and a key that is
 *  not there is a test bug rather than a missing assertion. */
function label(key: string): string {
  const text = (en as Record<string, string | undefined>)[key];
  if (!text) throw new Error(`no English string for ${key}`);
  return text;
}

const onClose = vi.fn();

type Prefs = Partial<Pick<EditorStore, 'showGrid' | 'showChunkBounds' | 'motionPref' | 'systemCursors' | 'quality3d'>>;

function renderModal(prefs: Prefs = {}) {
  setStoreState({ showGrid: false, showChunkBounds: false, motionPref: 'system', systemCursors: false, quality3d: 'auto', ...prefs });
  return render(<I18nProvider><SettingsModal open onClose={onClose} /></I18nProvider>);
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
] as const;

beforeEach(() => {
  setStoreState({ locale: 'en' });
  onClose.mockClear();
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
    expect(useEditorStore.getState().locale).toBe('ja');
  });

  it('the size slider publishes its value to assistive tech', () => {
    renderModal();
    const slider = screen.getByRole('slider', { name: label('modal.settings_ui_scale') });
    expect(slider.getAttribute('aria-valuenow')).toBeTruthy();
  });

  it('the grid tile toggles', () => {
    renderModal({ showGrid: false });
    fireEvent.click(screen.getByRole('switch', { name: label('modal.settings_grid') }));
    expect(useEditorStore.getState().showGrid).toBe(true);
  });

  it('the chunk-bounds tile toggles', () => {
    renderModal({ showChunkBounds: true });
    fireEvent.click(screen.getByRole('switch', { name: label('modal.settings_chunks') }));
    expect(useEditorStore.getState().showChunkBounds).toBe(false);
  });

  it('the quality trio reports the chosen rendering', () => {
    renderModal({ quality3d: 'auto' });
    const trio = screen.getByRole('radiogroup', { name: label('modal.settings_quality3d') });
    fireEvent.click(within(trio).getByRole('radio', { name: label('modal.settings_quality3d_lite') }));
    expect(useEditorStore.getState().quality3d).toBe('lite');
  });

  it('the motion trio offers three states and reports the pressed one', () => {
    renderModal({ motionPref: 'system' });
    const trio = screen.getByRole('radiogroup', { name: label('modal.settings_motion') });
    fireEvent.click(within(trio).getByRole('radio', { name: label('modal.settings_motion_reduced') }));
    expect(useEditorStore.getState().motionPref).toBe('reduced');
  });

  it('the cursor pair reports both directions of the choice', () => {
    renderModal({ systemCursors: false });
    const pair = screen.getByRole('radiogroup', { name: label('modal.settings_cursor') });
    fireEvent.click(within(pair).getByRole('radio', { name: label('modal.settings_cursor_system') }));
    expect(useEditorStore.getState().systemCursors).toBe(true);

    cleanup();
    renderModal({ systemCursors: true });
    const pair2 = screen.getByRole('radiogroup', { name: label('modal.settings_cursor') });
    fireEvent.click(within(pair2).getByRole('radio', { name: label('modal.settings_cursor_painted') }));
    expect(useEditorStore.getState().systemCursors).toBe(false);
  });

  it('the identity readout drills into About, and carries the build number it drills into', () => {
    renderModal();
    // The readout is the build number in its locale's sentence.
    fireEvent.click(screen.getByText(new RegExp(`^${label('about.build_number').replace('{build}', '\\S+')}$`)));
    expect(useEditorStore.getState().modals.about).toBe(true);
    useEditorStore.getState().setModal('about', false);
  });

  it('the keyboard picture closes the panel and opens the shortcuts window', () => {
    renderModal();
    expect(useEditorStore.getState().modals.keyboard).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: label('modal.keyboard_title') }));
    expect(onClose).toHaveBeenCalled();
    expect(useEditorStore.getState().modals.keyboard).toBe(true);
    useEditorStore.getState().setModal('keyboard', false);
  });

  it('the tour pill closes the panel before it starts the tour', () => {
    renderModal();
    fireEvent.click(screen.getByRole('button', { name: label('modal.settings_tour') }));
    expect(onClose).toHaveBeenCalled();
  });

  it('the local-data wipe asks first', () => {
    renderModal();
    fireEvent.click(screen.getByText(label('modal.settings_reset_btn')));
    expect(screen.getByText(label('modal.settings_reset_confirm'))).toBeTruthy();
  });
});
