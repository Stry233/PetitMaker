// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useLatch } from '../../../ui/primitives/use-latch';
import { useTransient } from '../../../ui/primitives/use-transient';
import { useRootCssVars } from '../../../ui/primitives/use-root-css-vars';
import { presence } from '../../../ui/design/motion';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('useLatch', () => {
  it('stays true once it has been true', () => {
    const { result, rerender } = renderHook(({ on }) => useLatch(on), { initialProps: { on: false } });
    expect(result.current).toBe(false);
    rerender({ on: true });
    rerender({ on: false });
    expect(result.current).toBe(true);
  });
});

describe('useTransient', () => {
  it('stands for its hold, restarts on a further show and clears on unmount', () => {
    vi.useFakeTimers();
    const { result, unmount } = renderHook(() => useTransient<string>(100));
    expect(result.current.value).toBeNull();
    act(() => { result.current.show('a'); });
    act(() => { vi.advanceTimersByTime(60); });
    act(() => { result.current.show('b'); });
    act(() => { vi.advanceTimersByTime(99); });
    expect(result.current.value).toBe('b');
    act(() => { vi.advanceTimersByTime(1); });
    expect(result.current.value).toBeNull();
    act(() => { result.current.show('c'); });
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('drops at once on clear', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useTransient<string>(100));
    act(() => { result.current.show('a'); });
    act(() => { result.current.clear(); });
    expect(result.current.value).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('follows what it lingers after, never dropping it before its hold, and steps with no hold', () => {
    vi.useFakeTimers();
    const seen: (string | null)[] = [];
    const { result, rerender } = renderHook(({ on, hold }) => {
      const { value } = useTransient<string>(hold, { linger: on });
      seen.push(value);
      return value;
    }, { initialProps: { on: null as string | null, hold: 100 } });
    expect(result.current).toBeNull();
    rerender({ on: 'a', hold: 100 });
    expect(result.current).toBe('a');
    seen.length = 0;
    rerender({ on: null, hold: 100 });
    // Every render from the turn on shows what stood.
    expect(seen.every((v) => v === 'a')).toBe(true);
    act(() => { vi.advanceTimersByTime(99); });
    expect(result.current).toBe('a');
    // Back on mid-hold, it follows again and its hold no longer runs.
    rerender({ on: 'b', hold: 100 });
    act(() => { vi.advanceTimersByTime(200); });
    expect(result.current).toBe('b');
    rerender({ on: null, hold: 100 });
    act(() => { vi.advanceTimersByTime(100); });
    expect(result.current).toBeNull();
    rerender({ on: 'c', hold: 0 });
    rerender({ on: null, hold: 0 });
    expect(result.current).toBeNull();
  });
});

describe('useRootCssVars', () => {
  it('publishes on the root, follows a change and removes on unmount', () => {
    const root = document.documentElement.style;
    const { rerender, unmount } = renderHook(({ v }) => useRootCssVars({ '--probe-a': v }), { initialProps: { v: '1px' } });
    expect(root.getPropertyValue('--probe-a')).toBe('1px');
    rerender({ v: '2px' });
    expect(root.getPropertyValue('--probe-a')).toBe('2px');
    unmount();
    expect(root.getPropertyValue('--probe-a')).toBe('');
  });
});

describe('presence', () => {
  it('lands at once under reduced motion', () => {
    expect(presence('surface.arrive', { opacity: 0 }, { reduced: true }).transition).toEqual({ duration: 0 });
  });
});
