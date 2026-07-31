import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useEditorStore } from '../../state/store';
import { TOUR_SEEN_KEY, hasSeenTour, markTourSeen, startTour, useTour } from '../../ui/chrome/tour/use-tour';
import { TOUR_STEPS } from '../../ui/chrome/tour/steps';

describe('tour state', () => {
  beforeEach(() => {
    localStorage.removeItem(TOUR_SEEN_KEY);
    useEditorStore.getState().setTourRunning(false);
  });

  it('treats a clean browser as a first launch', () => {
    expect(hasSeenTour()).toBe(false);
  });

  it('remembers that the tour was seen', () => {
    markTourSeen();
    expect(hasSeenTour()).toBe(true);
  });

  it('starting the tour runs it and marks it seen straight away', () => {
    startTour();
    expect(useEditorStore.getState().tourRunning).toBe(true);
    // A reload mid-tour must not replay it from step one; Settings is the way back.
    expect(hasSeenTour()).toBe(true);
  });

  it('a replay starts even after the tour was seen', () => {
    markTourSeen();
    startTour();
    expect(useEditorStore.getState().tourRunning).toBe(true);
  });

  it('survives a browser with no localStorage', () => {
    const real = globalThis.localStorage;
    Object.defineProperty(globalThis, 'localStorage', { value: undefined, configurable: true });
    expect(() => hasSeenTour()).not.toThrow();
    expect(hasSeenTour()).toBe(true); // no storage, no nagging
    expect(() => markTourSeen()).not.toThrow();
    Object.defineProperty(globalThis, 'localStorage', { value: real, configurable: true });
  });

  it('handles localStorage.getItem and setItem throwing', () => {
    const getItemSpy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('quota exceeded');
    });
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded');
    });
    try {
      expect(() => hasSeenTour()).not.toThrow();
      expect(hasSeenTour()).toBe(true);
      expect(() => markTourSeen()).not.toThrow();
    } finally {
      getItemSpy.mockRestore();
      setItemSpy.mockRestore();
    }
  });
});

describe('useTour hook', () => {
  beforeEach(() => {
    localStorage.removeItem(TOUR_SEEN_KEY);
    useEditorStore.getState().setTourRunning(false);
    useEditorStore.getState().setModal('tourDone', false);
  });

  it('reaching the end opens the send-off', () => {
    const { result } = renderHook(() => useTour());
    act(() => { startTour(); });
    for (let i = 0; i < TOUR_STEPS.length; i++) act(() => { result.current.next(); });
    expect(useEditorStore.getState().tourRunning).toBe(false);
    expect(useEditorStore.getState().modals.tourDone).toBe(true);
  });

  it('skipping ends the tour WITHOUT the send-off', () => {
    // Someone who skipped asked to be left alone; congratulating them is the tour talking back.
    const { result } = renderHook(() => useTour());
    act(() => { startTour(); });
    act(() => { result.current.skip(); });
    expect(useEditorStore.getState().tourRunning).toBe(false);
    expect(useEditorStore.getState().modals.tourDone).toBe(false);
  });

  it('a fresh run starts at index 0 with the first step and isLast false', () => {
    const { result } = renderHook(() => useTour());
    act(() => { startTour(); });
    expect(result.current.running).toBe(true);
    expect(result.current.index).toBe(0);
    expect(result.current.step?.id).toBe('welcome');
    expect(result.current.isLast).toBe(false);
  });

  it('next() advances one step at a time through every step, and isLast is true only on the last', () => {
    const { result } = renderHook(() => useTour());
    act(() => { startTour(); });
    for (let i = 0; i < TOUR_STEPS.length - 1; i++) {
      expect(result.current.index).toBe(i);
      expect(result.current.isLast).toBe(false);
      act(() => { result.current.next(); });
    }
    expect(result.current.index).toBe(TOUR_STEPS.length - 1);
    expect(result.current.isLast).toBe(true);
  });

  it('next() on the last step finishes: tourRunning goes false and the seen flag is written', () => {
    const { result } = renderHook(() => useTour());
    act(() => { startTour(); });
    for (let i = 0; i < TOUR_STEPS.length - 1; i++) {
      act(() => { result.current.next(); });
    }
    expect(result.current.isLast).toBe(true);
    expect(useEditorStore.getState().tourRunning).toBe(true);

    act(() => { result.current.next(); });
    expect(useEditorStore.getState().tourRunning).toBe(false);
    expect(hasSeenTour()).toBe(true);
  });

  it('calling next() twice on the last step leaves the tour finished and does not throw', () => {
    const { result } = renderHook(() => useTour());
    act(() => { startTour(); });
    for (let i = 0; i < TOUR_STEPS.length - 1; i++) {
      act(() => { result.current.next(); });
    }
    act(() => { result.current.next(); });
    expect(useEditorStore.getState().tourRunning).toBe(false);

    expect(() => {
      act(() => { result.current.next(); });
    }).not.toThrow();
    expect(useEditorStore.getState().tourRunning).toBe(false);
  });

  it('skip() from any step finishes the same way', () => {
    const { result } = renderHook(() => useTour());
    act(() => { startTour(); });
    act(() => { result.current.next(); });
    expect(result.current.index).toBe(1);

    act(() => { result.current.skip(); });
    expect(useEditorStore.getState().tourRunning).toBe(false);
    expect(hasSeenTour()).toBe(true);
  });

  it('step is null and nothing is exposed when the tour is not running', () => {
    const { result } = renderHook(() => useTour());
    expect(result.current.running).toBe(false);
    expect(result.current.step).toBe(null);
  });

  it('no floating surface opens over a running tour, and both open again once it ends', () => {
    // Both sit at z.contextMenu, far above z.tour, and the app under the dim stays operable, so a
    // right-click or a press of a selection's delete corner would paint over the walkthrough.
    // Closing is never blocked: whatever was open when the tour started still has to go away.
    const store = useEditorStore.getState();
    const ref = { kind: 'terrain', x: 1, y: 1 } as const;
    try {
      store.setContextMenu({ x: 10, y: 10, target: ref });
      store.setDeletePopover(ref);
      startTour();
      useEditorStore.getState().setContextMenu(null);
      useEditorStore.getState().setDeletePopover(null);
      useEditorStore.getState().setContextMenu({ x: 10, y: 10, target: ref });
      useEditorStore.getState().setDeletePopover(ref);
      expect(useEditorStore.getState().contextMenu).toBeNull();
      expect(useEditorStore.getState().deletePopover).toBeNull();

      useEditorStore.getState().setTourRunning(false);
      useEditorStore.getState().setContextMenu({ x: 10, y: 10, target: ref });
      useEditorStore.getState().setDeletePopover(ref);
      expect(useEditorStore.getState().contextMenu).not.toBeNull();
      expect(useEditorStore.getState().deletePopover).not.toBeNull();
    } finally {
      useEditorStore.getState().setTourRunning(false);
      useEditorStore.getState().setContextMenu(null);
      useEditorStore.getState().setDeletePopover(null);
    }
  });

  it('starting a run again resets the index to 0 (start, advance twice, stop, start again, expect index 0)', () => {
    const { result } = renderHook(() => useTour());
    act(() => { startTour(); });
    expect(result.current.index).toBe(0);

    act(() => { result.current.next(); });
    act(() => { result.current.next(); });
    expect(result.current.index).toBe(2);

    act(() => { result.current.skip(); });
    expect(useEditorStore.getState().tourRunning).toBe(false);

    act(() => { startTour(); });
    expect(result.current.index).toBe(0);
  });
});
