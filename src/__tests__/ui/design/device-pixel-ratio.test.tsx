/**
 * The display's pixel multiplier is re-read on the one media change that moves it. Safari before 16
 * has no `resolution` media feature, so the exact query there never matches and the prefixed pair
 * has to carry the subscription; the hook is otherwise unchanged.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useDevicePixelRatio } from '../../../ui/design/scale';

interface Stub { query: string; fire(): void; listeners: number }

/** A `matchMedia` that answers `matches` per query and records every list it hands out. */
function stubMatchMedia(matches: (query: string) => boolean): Stub[] {
  const made: Stub[] = [];
  vi.stubGlobal('matchMedia', (query: string) => {
    const handlers = new Set<() => void>();
    const stub: Stub = {
      query,
      fire: () => { for (const h of [...handlers]) h(); },
      get listeners() { return handlers.size; },
    };
    made.push(stub);
    return {
      matches: matches(query),
      media: query,
      addEventListener: (_t: string, h: () => void) => void handlers.add(h),
      removeEventListener: (_t: string, h: () => void) => void handlers.delete(h),
    };
  });
  return made;
}

function setDpr(value: number): void {
  Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value });
}

afterEach(() => {
  vi.unstubAllGlobals();
  Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 1 });
});

describe('useDevicePixelRatio', () => {
  it('watches the exact resolution query where the engine understands it', () => {
    setDpr(2);
    const made = stubMatchMedia((q) => q.includes('resolution'));
    const { result } = renderHook(() => useDevicePixelRatio());
    expect(result.current).toBe(2);
    expect(made.map((m) => m.query)).toEqual(['(resolution: 2dppx)']);

    setDpr(1);
    act(() => made[0]!.fire());
    expect(result.current).toBe(1);
  });

  it('falls back to the prefixed pair where the resolution query does not match', () => {
    setDpr(2);
    const made = stubMatchMedia((q) => !q.includes('resolution'));
    const { result } = renderHook(() => useDevicePixelRatio());
    expect(result.current).toBe(2);
    const watched = made[made.length - 1]!;
    expect(watched.query).toBe('(-webkit-min-device-pixel-ratio: 2) and (-webkit-max-device-pixel-ratio: 2)');
    expect(watched.listeners, 'the fallback carries the subscription').toBe(1);

    setDpr(3);
    act(() => watched.fire());
    expect(result.current).toBe(3);
  });

  it('drops its listener when the reader goes away', () => {
    setDpr(2);
    const made = stubMatchMedia(() => true);
    const { unmount } = renderHook(() => useDevicePixelRatio());
    unmount();
    expect(made.every((m) => m.listeners === 0)).toBe(true);
  });
});
