/**
 * The portrait blocker's device detection: a phone/tablet held in portrait must be blocked, but a
 * desktop must NEVER be, no matter how tall or narrow its window is. Pins the pure predicate
 * directly, plus the live hook's reset-on-rotate and orientation-lock escape hatch.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  shouldBlockPortrait,
  orientationTypeIsPortrait,
  readDeviceOrientation,
  detectPortraitBlocked,
} from '../../core/runtime/portrait-signals';
import { usePortraitGuard } from '../../ui/chrome/portrait-guard';

describe('shouldBlockPortrait (pure)', () => {
  it('never fires without a touch-primary pointer, however the signals combine', () => {
    // A desktop, including a tall monitor or a narrow window: portrait can be true, but the
    // pointer signals are what a mouse/trackpad always report, so this must stay false.
    expect(shouldBlockPortrait({ coarsePointer: false, noHover: false, portrait: true })).toBe(false);
    expect(shouldBlockPortrait({ coarsePointer: false, noHover: true, portrait: true })).toBe(false);
    expect(shouldBlockPortrait({ coarsePointer: true, noHover: false, portrait: true })).toBe(false);
  });

  it('fires only for a touch-primary device actually held in portrait', () => {
    expect(shouldBlockPortrait({ coarsePointer: true, noHover: true, portrait: true })).toBe(true);
  });

  it('does not fire for the same device in landscape', () => {
    expect(shouldBlockPortrait({ coarsePointer: true, noHover: true, portrait: false })).toBe(false);
  });
});

describe('orientationTypeIsPortrait', () => {
  it('reads the standard four screen.orientation.type values', () => {
    expect(orientationTypeIsPortrait('portrait-primary')).toBe(true);
    expect(orientationTypeIsPortrait('portrait-secondary')).toBe(true);
    expect(orientationTypeIsPortrait('landscape-primary')).toBe(false);
    expect(orientationTypeIsPortrait('landscape-secondary')).toBe(false);
  });
});

describe('readDeviceOrientation', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('prefers screen.orientation.type over the viewport shape', () => {
    // A landscape phone with a software keyboard eating vertical space: viewport dimensions could
    // in principle look squarer, but the hardware orientation must win.
    vi.stubGlobal('screen', { orientation: { type: 'landscape-primary' } });
    vi.stubGlobal('innerWidth', 400);
    vi.stubGlobal('innerHeight', 750); // taller than wide, as a keyboard-shrunk landscape view could read
    expect(readDeviceOrientation()).toBe(false);
  });

  it('falls back to the orientation media query when screen.orientation is unavailable', () => {
    vi.stubGlobal('screen', {});
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('portrait'), media: q }));
    expect(readDeviceOrientation()).toBe(true);
  });
});

describe('detectPortraitBlocked (the store seed)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('answers without a subscription, so the store holds the real value on App\'s first render', () => {
    // Passive effects flush children-first: PortraitGuard's mirror-write and useFirstLaunchTour's
    // once-only check land in the same flush, so a `false` default would let the tour start under
    // the rotate overlay and never re-check.
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q !== '(orientation: portrait)', media: q }));
    vi.stubGlobal('screen', { orientation: { type: 'portrait-primary' } });
    expect(detectPortraitBlocked()).toBe(true);

    vi.stubGlobal('screen', { orientation: { type: 'landscape-primary' } });
    expect(detectPortraitBlocked()).toBe(false);
  });

  it('is what the store starts at, so nothing has to wait an effect to learn it', async () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: true, media: q }));
    vi.stubGlobal('screen', { orientation: { type: 'portrait-primary' } });
    vi.resetModules(); // the seed runs at module evaluation, so the store has to be built here
    const { useEditorStore } = await import('../../state/store');
    expect(useEditorStore.getState().portraitBlocked).toBe(true);
  });
});

/** A settable matchMedia stub that can fire 'change' on demand, keyed by exact query string. */
function stubMatchMedia(initial: Record<string, boolean>) {
  const listeners = new Map<string, Set<() => void>>();
  const state = { ...initial };
  vi.stubGlobal('matchMedia', (q: string) => ({
    get matches() { return state[q] ?? false; },
    media: q,
    addEventListener: (_type: string, cb: () => void) => {
      if (!listeners.has(q)) listeners.set(q, new Set());
      listeners.get(q)!.add(cb);
    },
    removeEventListener: (_type: string, cb: () => void) => { listeners.get(q)?.delete(cb); },
  }));
  return {
    set(q: string, v: boolean) {
      state[q] = v;
      for (const cb of listeners.get(q) ?? []) cb();
    },
  };
}

describe('usePortraitGuard (live hook)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('never blocks a desktop', () => {
    stubMatchMedia({ '(pointer: coarse)': false, '(hover: none)': false, '(orientation: portrait)': true });
    vi.stubGlobal('screen', { orientation: { type: 'portrait-primary' } });
    const { result } = renderHook(() => usePortraitGuard());
    expect(result.current.blocked).toBe(false);
  });

  it('blocks a coarse-pointer device held in portrait', () => {
    stubMatchMedia({ '(pointer: coarse)': true, '(hover: none)': true, '(orientation: portrait)': true });
    vi.stubGlobal('screen', { orientation: { type: 'portrait-primary' } });
    const { result } = renderHook(() => usePortraitGuard());
    expect(result.current.blocked).toBe(true);
  });

  it('clears immediately on rotation, no reload', () => {
    const media = stubMatchMedia({ '(pointer: coarse)': true, '(hover: none)': true, '(orientation: portrait)': true });
    const orientation = { type: 'portrait-primary' };
    vi.stubGlobal('screen', { orientation });
    const { result } = renderHook(() => usePortraitGuard());
    expect(result.current.blocked).toBe(true);

    act(() => {
      orientation.type = 'landscape-primary';
      media.set('(orientation: portrait)', false);
    });
    expect(result.current.blocked).toBe(false);
  });

  it('the escape hatch hides the overlay, and stays hidden while portrait persists (orientation lock)', () => {
    stubMatchMedia({ '(pointer: coarse)': true, '(hover: none)': true, '(orientation: portrait)': true });
    vi.stubGlobal('screen', { orientation: { type: 'portrait-primary' } });
    const { result } = renderHook(() => usePortraitGuard());
    expect(result.current.blocked).toBe(true);

    act(() => result.current.dismiss());
    expect(result.current.blocked).toBe(false);
    // Nothing about the device changed (it cannot rotate) — the dismissal must hold.
    act(() => { /* a resize/heartbeat re-render should not resurrect the overlay */ });
    expect(result.current.blocked).toBe(false);
  });

  it('re-arms the escape hatch once the device is actually seen in landscape', () => {
    const media = stubMatchMedia({ '(pointer: coarse)': true, '(hover: none)': true, '(orientation: portrait)': true });
    const orientation = { type: 'portrait-primary' };
    vi.stubGlobal('screen', { orientation });
    const { result } = renderHook(() => usePortraitGuard());
    act(() => result.current.dismiss());
    expect(result.current.blocked).toBe(false);

    // The device actually rotates to landscape, then back to portrait: a device that CAN rotate
    // should be asked again, rather than the one dismissal becoming a standing opt-out.
    act(() => {
      orientation.type = 'landscape-primary';
      media.set('(orientation: portrait)', false);
    });
    act(() => {
      orientation.type = 'portrait-primary';
      media.set('(orientation: portrait)', true);
    });
    expect(result.current.blocked).toBe(true);
  });
});
