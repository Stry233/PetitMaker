import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { SettingsModal, type SettingsModalProps } from '../../../ui/chrome/modals/SettingsModal';
import { I18nProvider } from '../../../i18n/context';
import { setStoreState } from '../../_store';

function define(target: object, key: string, value: unknown): void {
  Object.defineProperty(target, key, { configurable: true, value });
}

function noop() {}

function renderModal() {
  const props: SettingsModalProps = {
    open: true, locale: 'en', showGrid: false, showChunks: false, motionPref: 'system', systemCursors: false,
    quality3d: 'auto', onQuality3dChange: noop, onLocaleChange: noop, onShowGridChange: noop, onShowChunksChange: noop,
    onMotionPrefChange: noop, onSystemCursorsChange: noop, onAbout: noop, onClose: noop,
  };
  return render(<I18nProvider><SettingsModal {...props} /></I18nProvider>);
}

beforeEach(() => { setStoreState({ locale: 'en' }); });
afterEach(() => {
  cleanup();
  for (const key of ['fullscreenEnabled', 'fullscreenElement', 'exitFullscreen']) delete (document as unknown as Record<string, unknown>)[key];
  delete (document.documentElement as unknown as Record<string, unknown>).requestFullscreen;
});

describe('Settings immersive mode', () => {
  it('offers no button where the browser has no fullscreen', () => {
    renderModal();
    expect(screen.queryByRole('button', { name: 'Immersive mode' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Replay the tour' })).toBeTruthy();
  });

  it('enters fullscreen from the button, which then names the way back out', () => {
    const request = vi.fn().mockResolvedValue(undefined);
    define(document, 'fullscreenEnabled', true);
    define(document.documentElement, 'requestFullscreen', request);
    define(document, 'fullscreenElement', null);
    renderModal();
    const pills = screen.getAllByRole('button').map((b) => b.textContent);
    expect(pills.indexOf('Immersive mode')).toBeLessThan(pills.indexOf('Replay the tour'));
    fireEvent.click(screen.getByRole('button', { name: 'Immersive mode' }));
    expect(request).toHaveBeenCalledTimes(1);
    define(document, 'fullscreenElement', document.documentElement);
    act(() => { document.dispatchEvent(new Event('fullscreenchange')); });
    expect(screen.getByRole('button', { name: 'Exit immersive mode' })).toBeTruthy();
  });
});
