// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePressRepeat } from '../../../../ui/shell/controls/use-press-repeat';

const LEFT = { button: 0 };
const RIGHT = { button: 2 };

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('usePressRepeat', () => {
  it('fires action once on press, then repeats after delay at the interval', () => {
    const action = vi.fn();
    const { result } = renderHook(() => usePressRepeat({ action, intervalMs: 100 }));

    act(() => result.current.onPointerDown(LEFT));
    expect(action).toHaveBeenCalledTimes(1);

    act(() => { vi.advanceTimersByTime(349); });
    expect(action).toHaveBeenCalledTimes(1);

    act(() => { vi.advanceTimersByTime(1); }); // the delay is reached; the first repeat is one interval later
    act(() => { vi.advanceTimersByTime(300); });
    expect(action).toHaveBeenCalledTimes(4); // the press and three repeats
  });

  it('release before the delay stops further fires', () => {
    const action = vi.fn();
    const { result } = renderHook(() => usePressRepeat({ action, intervalMs: 100 }));

    act(() => result.current.onPointerDown(LEFT));
    act(() => { vi.advanceTimersByTime(200); });
    act(() => result.current.onPointerUp());
    act(() => { vi.advanceTimersByTime(1000); });
    expect(action).toHaveBeenCalledTimes(1);
  });

  it('release after the delay stops further repeats', () => {
    const action = vi.fn();
    const { result } = renderHook(() => usePressRepeat({ action, intervalMs: 100 }));

    act(() => result.current.onPointerDown(LEFT));
    act(() => { vi.advanceTimersByTime(550); }); // the delay and two repeats
    expect(action).toHaveBeenCalledTimes(3);
    act(() => result.current.onPointerUp());
    act(() => { vi.advanceTimersByTime(1000); });
    expect(action).toHaveBeenCalledTimes(3);
  });

  it('onClick after a pointer press is deduped (no double fire)', () => {
    const action = vi.fn();
    const { result } = renderHook(() => usePressRepeat({ action, intervalMs: 100 }));
    act(() => result.current.onPointerDown(LEFT));
    act(() => result.current.onPointerUp());
    act(() => result.current.onClick()); // the click that follows a pointer press is not a second press
    expect(action).toHaveBeenCalledTimes(1);
  });

  it('onClick with no preceding pointerdown (keyboard) fires once', () => {
    const action = vi.fn();
    const { result } = renderHook(() => usePressRepeat({ action, intervalMs: 100 }));
    act(() => result.current.onClick());
    expect(action).toHaveBeenCalledTimes(1);
  });

  it('a press abandoned by leaving the button does not swallow the next keyboard press', () => {
    const action = vi.fn();
    const { result } = renderHook(() => usePressRepeat({ action, intervalMs: 100 }));
    act(() => result.current.onPointerDown(LEFT));
    act(() => result.current.onPointerLeave());    // no click follows a press that left the button
    act(() => result.current.onClick());           // so this one is the keyboard's
    expect(action).toHaveBeenCalledTimes(2);
  });

  it('right-click (button !== 0) does nothing on pointerdown', () => {
    const action = vi.fn();
    const { result } = renderHook(() => usePressRepeat({ action, intervalMs: 100 }));
    act(() => result.current.onPointerDown(RIGHT));
    act(() => { vi.advanceTimersByTime(1000); });
    expect(action).toHaveBeenCalledTimes(0);
  });
});
