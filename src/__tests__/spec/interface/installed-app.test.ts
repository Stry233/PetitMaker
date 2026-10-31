// @vitest-environment jsdom
/**
 * An installed app turns with the screen and enters immersive mode at its first tap, unless the user
 * turned it off with the Settings button. jsdom has no fullscreen, so the page's fullscreen calls and
 * the display mode stand in for the browser's.
 */
import { afterEach, beforeEach, describe, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { spec } from '../../_support/spec';
import { installInstalledImmersive } from '../../../platform/device/installed-immersive';
import { useFullscreen } from '../../../ui/primitives/use-fullscreen';
import { removePref } from '../../../platform/storage/prefs';

let fullscreen: Element | null = null;
const request = vi.fn(async () => { fullscreen = document.documentElement; document.dispatchEvent(new Event('fullscreenchange')); });
const exit = vi.fn(async () => { fullscreen = null; document.dispatchEvent(new Event('fullscreenchange')); });

function displayMode(installed: boolean): void {
  window.matchMedia = ((query: string) => ({ matches: installed && query === '(display-mode: standalone)', media: query, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
}
const tap = () => act(() => { window.dispatchEvent(new Event('pointerup')); });
function setVisibility(state: 'visible' | 'hidden'): void {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: state });
  document.dispatchEvent(new Event('visibilitychange'));
}

beforeEach(() => {
  fullscreen = null;
  request.mockClear(); exit.mockClear();
  Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, value: true });
  Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => fullscreen });
  Object.defineProperty(document.documentElement, 'requestFullscreen', { configurable: true, value: request });
  Object.defineProperty(document, 'exitFullscreen', { configurable: true, value: exit });
  removePref('installedImmersive');
});
afterEach(() => { setVisibility('visible'); });

describe('the installed app', () => {
  spec('UI-44', 'enters immersive mode at the first tap after it opens, and only once', () => {
    displayMode(true);
    const off = installInstalledImmersive();
    tap();
    tap();
    expect(request).toHaveBeenCalledTimes(1);
    off();
  });

  spec('UI-44', 'a browser tab never enters on its own', () => {
    displayMode(false);
    const off = installInstalledImmersive();
    tap();
    expect(request).not.toHaveBeenCalled();
    off();
  });

  spec('UI-44', 'leaving with the Settings button keeps it off on the next launch until the button enters again', async () => {
    displayMode(true);
    let off = installInstalledImmersive();
    tap();
    const { result } = renderHook(() => useFullscreen());
    await act(async () => { result.current.toggle(); });
    expect(exit).toHaveBeenCalledTimes(1);
    off();
    off = installInstalledImmersive();
    tap();
    expect(request).toHaveBeenCalledTimes(1);
    await act(async () => { result.current.toggle(); });
    expect(request).toHaveBeenCalledTimes(2);
    off();
    await act(async () => { await document.exitFullscreen(); });
    off = installInstalledImmersive();
    tap();
    expect(request).toHaveBeenCalledTimes(3);
    off();
  });

  spec('UI-44', 'leaving with the system gesture holds until the app is brought back', async () => {
    displayMode(true);
    const off = installInstalledImmersive();
    tap();
    await act(async () => { await document.exitFullscreen(); });
    tap();
    expect(request).toHaveBeenCalledTimes(1);
    setVisibility('hidden');
    setVisibility('visible');
    tap();
    expect(request).toHaveBeenCalledTimes(2);
    off();
  });
});
