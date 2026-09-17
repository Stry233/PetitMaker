import { describe, it, expect, afterEach, vi } from 'vitest';
import { fullscreenAvailable, isFullscreen, onFullscreenChange, toggleFullscreen } from '../../../core/runtime/fullscreen';

function define(target: object, key: string, value: unknown): void {
  Object.defineProperty(target, key, { configurable: true, value });
}

const DOC_KEYS = [
  'fullscreenEnabled', 'fullscreenElement', 'exitFullscreen',
  'webkitFullscreenEnabled', 'webkitFullscreenElement', 'webkitExitFullscreen',
];

afterEach(() => {
  for (const key of DOC_KEYS) delete (document as unknown as Record<string, unknown>)[key];
  for (const key of ['requestFullscreen', 'webkitRequestFullscreen']) {
    delete (document.documentElement as unknown as Record<string, unknown>)[key];
  }
});

describe('fullscreen', () => {
  it('is available only where the document allows it', () => {
    define(document, 'fullscreenEnabled', false);
    expect(fullscreenAvailable()).toBe(false);
    define(document, 'fullscreenEnabled', true);
    define(document.documentElement, 'requestFullscreen', vi.fn());
    expect(fullscreenAvailable()).toBe(true);
  });

  it('enters on the document element and leaves through the document', async () => {
    const request = vi.fn().mockResolvedValue(undefined);
    const exit = vi.fn().mockResolvedValue(undefined);
    define(document.documentElement, 'requestFullscreen', request);
    define(document, 'exitFullscreen', exit);
    define(document, 'fullscreenElement', null);
    expect(isFullscreen()).toBe(false);
    await toggleFullscreen();
    expect(request).toHaveBeenCalledWith({ navigationUI: 'hide' });
    define(document, 'fullscreenElement', document.documentElement);
    expect(isFullscreen()).toBe(true);
    await toggleFullscreen();
    expect(exit).toHaveBeenCalledTimes(1);
  });

  it('swallows a refused request', async () => {
    define(document.documentElement, 'requestFullscreen', vi.fn().mockRejectedValue(new Error('denied')));
    define(document, 'fullscreenElement', null);
    await expect(toggleFullscreen()).resolves.toBeUndefined();
  });

  it('takes the webkit-prefixed API where that is the only one offered', async () => {
    // Safari and WKWebView before 16.4 ship only the prefixed calls.
    const request = vi.fn();
    const exit = vi.fn();
    define(document, 'webkitFullscreenEnabled', true);
    define(document.documentElement, 'webkitRequestFullscreen', request);
    define(document, 'webkitExitFullscreen', exit);
    define(document, 'webkitFullscreenElement', null);
    expect(fullscreenAvailable()).toBe(true);
    expect(isFullscreen()).toBe(false);
    await toggleFullscreen();
    expect(request).toHaveBeenCalledTimes(1);
    define(document, 'webkitFullscreenElement', document.documentElement);
    expect(isFullscreen()).toBe(true);
    await toggleFullscreen();
    expect(exit).toHaveBeenCalledTimes(1);
  });

  it('stays unavailable on an engine with neither API, as the iPhone has', () => {
    // iPhone Safari offers element fullscreen for video alone; the immersive row must not appear.
    expect(fullscreenAvailable()).toBe(false);
    define(document, 'webkitFullscreenEnabled', false);
    expect(fullscreenAvailable()).toBe(false);
  });

  it('tells subscribers about a prefixed change event too', () => {
    const tell = vi.fn();
    const off = onFullscreenChange(tell);
    document.dispatchEvent(new Event('webkitfullscreenchange'));
    expect(tell).toHaveBeenCalledTimes(1);
    off();
    document.dispatchEvent(new Event('webkitfullscreenchange'));
    expect(tell).toHaveBeenCalledTimes(1);
  });

  it('tells subscribers when the state changes until they unsubscribe', () => {
    const tell = vi.fn();
    const off = onFullscreenChange(tell);
    document.dispatchEvent(new Event('fullscreenchange'));
    expect(tell).toHaveBeenCalledTimes(1);
    off();
    document.dispatchEvent(new Event('fullscreenchange'));
    expect(tell).toHaveBeenCalledTimes(1);
  });
});
