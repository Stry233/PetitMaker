import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePressRepeat } from '../../../ui/hooks/use-press-repeat';

const LEFT = { button: 0 };
const RIGHT = { button: 2 };

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('usePressRepeat', () => {
  it('fires action once on press, then repeats after delay at the interval', () => {
    const action = vi.fn();
    const { result } = renderHook(() => usePressRepeat({ action, delayMs: 350, intervalMs: 100 }));

    act(() => result.current.onPointerDown(LEFT));
    expect(action).toHaveBeenCalledTimes(1); // immediate fire

    act(() => vi.advanceTimersByTime(349)); // before the delay elapses
    expect(action).toHaveBeenCalledTimes(1);

    act(() => vi.advanceTimersByTime(1)); // delay reached -> interval starts, first tick on next interval
    act(() => vi.advanceTimersByTime(300)); // 3 interval ticks
    expect(action).toHaveBeenCalledTimes(4); // 1 press + 3 repeats
  });

  it('release before the delay stops further fires', () => {
    const action = vi.fn();
    const { result } = renderHook(() => usePressRepeat({ action, delayMs: 350, intervalMs: 100 }));

    act(() => result.current.onPointerDown(LEFT));
    act(() => vi.advanceTimersByTime(200));
    act(() => result.current.onPointerUp());
    act(() => vi.advanceTimersByTime(1000));
    expect(action).toHaveBeenCalledTimes(1); // only the press fire
  });

  it('release after the delay stops further repeats', () => {
    const action = vi.fn();
    const { result } = renderHook(() => usePressRepeat({ action, delayMs: 350, intervalMs: 100 }));

    act(() => result.current.onPointerDown(LEFT));
    act(() => vi.advanceTimersByTime(550)); // delay + 2 ticks
    expect(action).toHaveBeenCalledTimes(3);
    act(() => result.current.onPointerUp());
    act(() => vi.advanceTimersByTime(1000));
    expect(action).toHaveBeenCalledTimes(3); // no more after release
  });

  it('canRepeat() false at press produces zero fires', () => {
    const action = vi.fn();
    const { result } = renderHook(() =>
      usePressRepeat({ action, canRepeat: () => false, delayMs: 350, intervalMs: 100 }),
    );
    act(() => result.current.onPointerDown(LEFT));
    act(() => vi.advanceTimersByTime(1000));
    expect(action).toHaveBeenCalledTimes(0);
  });

  it('canRepeat flipping to false mid-repeat stops subsequent fires', () => {
    const action = vi.fn();
    let allowed = true;
    const { result } = renderHook(() =>
      usePressRepeat({ action, canRepeat: () => allowed, delayMs: 350, intervalMs: 100 }),
    );
    act(() => result.current.onPointerDown(LEFT));
    act(() => vi.advanceTimersByTime(450)); // delay + 1 tick -> 2 fires
    expect(action).toHaveBeenCalledTimes(2);
    allowed = false;
    act(() => vi.advanceTimersByTime(1000));
    expect(action).toHaveBeenCalledTimes(2); // tick saw canRepeat()===false and stopped
  });

  it('onClick after a pointer press is deduped (no double fire)', () => {
    const action = vi.fn();
    const { result } = renderHook(() => usePressRepeat({ action, delayMs: 350, intervalMs: 100 }));
    act(() => result.current.onPointerDown(LEFT)); // 1 fire
    act(() => result.current.onPointerUp());
    act(() => result.current.onClick()); // synthetic click -> deduped
    expect(action).toHaveBeenCalledTimes(1);
  });

  it('onClick with no preceding pointerdown (keyboard) fires once', () => {
    const action = vi.fn();
    const { result } = renderHook(() => usePressRepeat({ action, delayMs: 350, intervalMs: 100 }));
    act(() => result.current.onClick());
    expect(action).toHaveBeenCalledTimes(1);
  });

  it('a press abandoned by leaving the button does not swallow the next keyboard press', () => {
    const action = vi.fn();
    const { result } = renderHook(() => usePressRepeat({ action, delayMs: 350, intervalMs: 100 }));
    act(() => result.current.onPointerDown(LEFT)); // 1 fire
    act(() => result.current.onPointerLeave());    // no click follows a press that left the button
    act(() => result.current.onClick());           // so this one is the keyboard's
    expect(action).toHaveBeenCalledTimes(2);
  });

  it('right-click (button !== 0) does nothing on pointerdown', () => {
    const action = vi.fn();
    const { result } = renderHook(() => usePressRepeat({ action, delayMs: 350, intervalMs: 100 }));
    act(() => result.current.onPointerDown(RIGHT));
    act(() => vi.advanceTimersByTime(1000));
    expect(action).toHaveBeenCalledTimes(0);
  });
});
