// ui-zoom-anim — the shared application-layer tween for uiZoom. The store's
// uiZoom is the persisted TARGET (written once per user action); this module
// eases a LIVE value toward it so every consumer (menu scale, chrome scale,
// centre offset) animates in lockstep, whichever path set the target (the
// Settings slider's release commit, Ctrl+/-, the reset chip, arrow keys).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useEditorStore } from '../../../state/store';
import { setReducedMotion, __resetMotionState } from '../../../canvas/map2d/motion-state';
import { useAnimatedUiZoom, useUiZooming, __resetUiZoomAnim } from '../../../ui/design/ui-zoom-anim';
import { setStoreState } from '../../_store';

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

describe('useAnimatedUiZoom', () => {
  it('starts at the store value with nothing in flight', () => {
    const { result } = renderHook(() => useAnimatedUiZoom());
    expect(result.current).toBe(1);
  });

  it('eases toward a new target set via setUiZoom (the slider-release / Ctrl+/- path) — an intermediate frame sits strictly between old and new, and it settles exactly at the target', () => {
    const { result } = renderHook(() => useAnimatedUiZoom());
    act(() => {
      useEditorStore.getState().setUiZoom(1.5); // e.g. a slider release commit
    });
    // One frame in: still animating, strictly between 1.0 and 1.5.
    act(() => { vi.advanceTimersByTime(16); });
    expect(result.current).toBeGreaterThan(1);
    expect(result.current).toBeLessThan(1.5);

    // Enough frames to converge.
    act(() => { vi.advanceTimersByTime(1000); });
    expect(result.current).toBe(1.5);
  });

  it('a retarget mid-flight is interruptible: it redirects from the current live value, never restarts from the original start', () => {
    const { result } = renderHook(() => useAnimatedUiZoom());
    act(() => { useEditorStore.getState().setUiZoom(1.8); });
    act(() => { vi.advanceTimersByTime(16); }); // now partway toward 1.8
    const midway = result.current;
    expect(midway).toBeGreaterThan(1);
    expect(midway).toBeLessThan(1.8);

    // Retarget down to 0.6 before convergence — the live value should move
    // DOWN from `midway`, never jump back up toward 1.8 first.
    act(() => { useEditorStore.getState().setUiZoom(0.6); });
    act(() => { vi.advanceTimersByTime(16); });
    expect(result.current).toBeLessThan(midway);

    act(() => { vi.advanceTimersByTime(1000); });
    expect(result.current).toBe(0.6);
  });

  it('reduced motion snaps instantly — no intermediate frame', () => {
    setReducedMotion(true);
    const { result } = renderHook(() => useAnimatedUiZoom());
    act(() => { useEditorStore.getState().setUiZoom(1.5); });
    expect(result.current).toBe(1.5); // already settled, synchronously
    act(() => { vi.advanceTimersByTime(1000); }); // nothing left to animate
    expect(result.current).toBe(1.5);
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

describe('useUiZooming (the layout/px-rounding gate)', () => {
  it('is false at rest, true only while the tween is in flight, then false again', () => {
    const { result } = renderHook(() => useUiZooming());
    expect(result.current).toBe(false);
    act(() => { useEditorStore.getState().setUiZoom(1.6); });
    act(() => { vi.advanceTimersByTime(16); });
    expect(result.current).toBe(true);      // animating
    act(() => { vi.advanceTimersByTime(2000); });
    expect(result.current).toBe(false);     // settled
  });

  it('reduced motion never animates, so it never reports zooming', () => {
    setReducedMotion(true);
    const { result } = renderHook(() => useUiZooming());
    act(() => { useEditorStore.getState().setUiZoom(2); });
    act(() => { vi.advanceTimersByTime(16); });
    expect(result.current).toBe(false);
  });
});
