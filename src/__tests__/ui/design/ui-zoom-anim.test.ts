// @vitest-environment jsdom
// ui-zoom-anim: the shared application-layer tween for uiZoom. The store's
// uiZoom is the persisted target (written once per user action); this module
// eases one live value toward it, which every per-frame writer reads, whichever
// path set the target (the Settings slider's release commit, Ctrl+/-, the reset
// chip, arrow keys).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useEditorStore } from '../../../state/store';
import { setReducedMotion, __resetMotionState } from '../../../platform/channels/motion-state';
import { uiZoomLive, useSettledUiZoom, __resetUiZoomAnim } from '../../../ui/design/ui-zoom-anim';
import { useScaleMoving } from '../../../ui/design/scale';
import { setStoreState } from '../../_support/store';

beforeEach(() => {
  vi.useFakeTimers();
  setStoreState({ uiZoom: 1 });
  __resetUiZoomAnim();
  __resetMotionState();
});

afterEach(() => {
  vi.useRealTimers();
  __resetMotionState();
});

/** The live value, as the per-frame writers read it. */
const live = () => uiZoomLive.get();

describe('the live UI zoom', () => {
  it('starts at the store value with nothing in flight', () => {
    expect(live()).toBe(1);
  });

  it('renders read the settled target at once, never a frame of the follow', () => {
    const { result } = renderHook(() => useSettledUiZoom());
    act(() => { useEditorStore.getState().setUiZoom(1.5); });
    expect(result.current).toBe(1.5);
    expect(live()).toBe(1);
  });

  it('eases toward a new target set via setUiZoom (the slider-release / Ctrl+/- path) — an intermediate frame sits strictly between old and new, and it settles exactly at the target', () => {
    act(() => {
      useEditorStore.getState().setUiZoom(1.5); // e.g. a slider release commit
    });
    // One frame in: still animating, strictly between 1.0 and 1.5.
    act(() => { vi.advanceTimersByTime(16); });
    expect(live()).toBeGreaterThan(1);
    expect(live()).toBeLessThan(1.5);

    // Enough frames to converge.
    act(() => { vi.advanceTimersByTime(1000); });
    expect(live()).toBe(1.5);
  });

  it('a retarget mid-flight is interruptible: it redirects from the current live value, never restarts from the original start', () => {
    act(() => { useEditorStore.getState().setUiZoom(1.8); });
    act(() => { vi.advanceTimersByTime(16); }); // now partway toward 1.8
    const midway = live();
    expect(midway).toBeGreaterThan(1);
    expect(midway).toBeLessThan(1.8);

    // Retarget down to 0.6 before convergence: the live value should move
    // down from `midway`, never jump back up toward 1.8 first.
    act(() => { useEditorStore.getState().setUiZoom(0.6); });
    act(() => { vi.advanceTimersByTime(16); });
    expect(live()).toBeLessThan(midway);

    act(() => { vi.advanceTimersByTime(1000); });
    expect(live()).toBe(0.6);
  });

  it('reduced motion snaps instantly — no intermediate frame', () => {
    setReducedMotion(true);
    act(() => { useEditorStore.getState().setUiZoom(1.5); });
    expect(live()).toBe(1.5); // already settled, synchronously
    act(() => { vi.advanceTimersByTime(1000); }); // nothing left to animate
    expect(live()).toBe(1.5);
  });

  it('persists the target once (setUiZoom writes localStorage synchronously); the animation never touches the store', () => {
    localStorage.clear();
    act(() => { useEditorStore.getState().setUiZoom(1.3); });
    expect(localStorage.getItem('petit-planet-ui-zoom')).toBe('1.3');
    const writesBefore = vi.spyOn(Storage.prototype, 'setItem');
    act(() => { vi.advanceTimersByTime(1000); }); // let the tween run to completion
    expect(writesBefore).not.toHaveBeenCalled();
    expect(useEditorStore.getState().uiZoom).toBe(1.3); // target unchanged by the tween
    writesBefore.mockRestore();
  });
});

describe('useScaleMoving (the layout/px-rounding gate)', () => {
  it('is false at rest, true only while the tween is in flight, then false again', () => {
    const { result } = renderHook(() => useScaleMoving());
    expect(result.current).toBe(false);
    act(() => { useEditorStore.getState().setUiZoom(1.6); });
    act(() => { vi.advanceTimersByTime(16); });
    expect(result.current).toBe(true);      // animating
    act(() => { vi.advanceTimersByTime(2000); });
    expect(result.current).toBe(false);     // settled
  });

  it('reduced motion never animates, so it never reports zooming', () => {
    setReducedMotion(true);
    const { result } = renderHook(() => useScaleMoving());
    act(() => { useEditorStore.getState().setUiZoom(2); });
    act(() => { vi.advanceTimersByTime(16); });
    expect(result.current).toBe(false);
  });
});

describe('the follow is time-based', () => {
  /** Drives the loop by hand at `hz` for `ms` of elapsed time and returns the live value. */
  function runAt(hz: number, ms: number): number {
    const frames: FrameRequestCallback[] = [];
    const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => { frames.push(cb); return frames.length; });
    act(() => { useEditorStore.getState().setUiZoom(1.5); });
    const step = 1000 / hz;
    for (let i = 1; i <= Math.round(ms / step) && frames.length > 0; i++) {
      const cb = frames.shift()!;
      act(() => { cb(i * step); });
    }
    const value = live();
    raf.mockRestore();
    setStoreState({ uiZoom: 1 });
    __resetUiZoomAnim();
    return value;
  }

  it('covers the same distance in the same time at 60 Hz and at 120 Hz', () => {
    const at60 = runAt(60, 100);
    const at120 = runAt(120, 100);
    expect(at60).toBeGreaterThan(1);
    expect(at60).toBeLessThan(1.5);
    expect(Math.abs(at60 - at120)).toBeLessThan(0.02);
  });
});
