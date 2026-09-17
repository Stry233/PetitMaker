import { describe, it, expect, afterEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useFullscreen } from '../../../ui/hooks/useFullscreen';

function define(target: object, key: string, value: unknown): void {
  Object.defineProperty(target, key, { configurable: true, value });
}

afterEach(() => {
  for (const key of [
    'fullscreenEnabled', 'fullscreenElement', 'exitFullscreen',
    'webkitFullscreenEnabled', 'webkitFullscreenElement', 'webkitExitFullscreen',
  ]) delete (document as unknown as Record<string, unknown>)[key];
  for (const key of ['requestFullscreen', 'webkitRequestFullscreen']) {
    delete (document.documentElement as unknown as Record<string, unknown>)[key];
  }
});

describe('useFullscreen', () => {
  it('reports an unavailable API as neither available nor active', () => {
    const { result } = renderHook(() => useFullscreen());
    expect(result.current.available).toBe(false);
    expect(result.current.active).toBe(false);
  });

  it('follows the document as fullscreen is entered and left', () => {
    define(document, 'fullscreenEnabled', true);
    define(document.documentElement, 'requestFullscreen', vi.fn().mockResolvedValue(undefined));
    define(document, 'fullscreenElement', null);
    const { result } = renderHook(() => useFullscreen());
    expect(result.current.available).toBe(true);
    expect(result.current.active).toBe(false);
    define(document, 'fullscreenElement', document.documentElement);
    act(() => { document.dispatchEvent(new Event('fullscreenchange')); });
    expect(result.current.active).toBe(true);
  });

  it('offers immersive mode on a webkit-prefixed engine and follows its own change event', () => {
    const request = vi.fn();
    define(document, 'webkitFullscreenEnabled', true);
    define(document.documentElement, 'webkitRequestFullscreen', request);
    define(document, 'webkitFullscreenElement', null);
    const { result } = renderHook(() => useFullscreen());
    expect(result.current.available).toBe(true);
    act(() => { result.current.toggle(); });
    expect(request).toHaveBeenCalledTimes(1);
    define(document, 'webkitFullscreenElement', document.documentElement);
    act(() => { document.dispatchEvent(new Event('webkitfullscreenchange')); });
    expect(result.current.active).toBe(true);
  });

  it('toggles through the document element', () => {
    const request = vi.fn().mockResolvedValue(undefined);
    define(document, 'fullscreenEnabled', true);
    define(document.documentElement, 'requestFullscreen', request);
    define(document, 'fullscreenElement', null);
    const { result } = renderHook(() => useFullscreen());
    act(() => { result.current.toggle(); });
    expect(request).toHaveBeenCalledTimes(1);
  });
});
