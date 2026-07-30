/**
 * The PortraitGuard component: it must actually render the "please rotate" card for a coarse-
 * pointer portrait device, never for a desktop, clear the moment matchMedia reports a rotation,
 * and offer the understated "continue anyway" escape hatch. Device signals are stubbed the same
 * way `portrait-guard.test.ts` stubs them for the hook; this file only adds the render/i18n/motion
 * layer on top.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, act } from '@testing-library/react';
import { MotionConfig, MotionGlobalConfig } from 'framer-motion';
import { PortraitGuard } from '../../ui/chrome/PortraitGuard';
import { I18nProvider } from '../../i18n/context';
import { en } from '../../i18n/locales/en';
import { setStoreState } from '../_store';

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

function renderGuard() {
  return render(<I18nProvider><PortraitGuard /></I18nProvider>);
}

beforeEach(() => { setStoreState({ locale: 'en' }); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); MotionGlobalConfig.skipAnimations = false; });

describe('PortraitGuard renders only for a coarse-pointer device held in portrait', () => {
  it('shows nothing on a desktop (fine pointer, hover-capable), whatever the window shape', () => {
    stubMatchMedia({ '(pointer: coarse)': false, '(hover: none)': false, '(orientation: portrait)': true });
    vi.stubGlobal('screen', { orientation: { type: 'portrait-primary' } });
    renderGuard();
    expect(screen.queryByTestId('portrait-guard')).toBeNull();
  });

  it('covers the screen with the rotate card for a phone/tablet held in portrait', () => {
    MotionGlobalConfig.skipAnimations = true; // deterministic instant frame, same idiom as dev-build-notice.test.tsx
    stubMatchMedia({ '(pointer: coarse)': true, '(hover: none)': true, '(orientation: portrait)': true });
    vi.stubGlobal('screen', { orientation: { type: 'portrait-primary' } });
    renderGuard();
    const card = screen.getByTestId('portrait-guard');
    expect(card.textContent).toContain(en['portrait.title']);
    expect(card.textContent).toContain(en['portrait.body']);
    expect(card.getAttribute('role')).toBe('dialog');
    expect(card.getAttribute('aria-modal')).toBe('true');
  });

  it('settles to a clean, fully-opaque final frame under reduced motion, not a half-applied one', async () => {
    stubMatchMedia({ '(pointer: coarse)': true, '(hover: none)': true, '(orientation: portrait)': true });
    vi.stubGlobal('screen', { orientation: { type: 'portrait-primary' } });
    // reducedMotion="always" (what App.tsx sets for motionPref==='reduced') collapses the enter to
    // its end state rather than skipping the update loop, so — unlike the MotionGlobalConfig idiom
    // above — the settled frame lands a tick after mount, which is what `waitFor` below awaits.
    render(<MotionConfig reducedMotion="always"><I18nProvider><PortraitGuard /></I18nProvider></MotionConfig>);
    const card = screen.getByTestId('portrait-guard');
    const backdrop = card.parentElement as HTMLElement;
    await waitFor(() => expect(backdrop.style.opacity).toBe('1'));
    // Framer drops the transform-driving scale/y motion values under reducedMotion="always"
    // entirely (an explicit no-op transform), rather than settling them at an equivalent
    // scale(1)/translateY(0) — either reads as "no residual transform", but the initial values
    // (0.92 scale, 10px translateY) must not be the ones left on the element.
    expect(card.style.transform === '' || card.style.transform === 'none').toBe(true);
  });

  it('clears immediately on rotation, no reload', async () => {
    const media = stubMatchMedia({ '(pointer: coarse)': true, '(hover: none)': true, '(orientation: portrait)': true });
    const orientation = { type: 'portrait-primary' };
    vi.stubGlobal('screen', { orientation });
    renderGuard();
    expect(screen.getByTestId('portrait-guard')).toBeTruthy();

    act(() => {
      orientation.type = 'landscape-primary';
      media.set('(orientation: portrait)', false);
    });
    await waitFor(() => expect(screen.queryByTestId('portrait-guard')).toBeNull());
  });

  it('offers a quiet way through, which hides the card without the device rotating', async () => {
    stubMatchMedia({ '(pointer: coarse)': true, '(hover: none)': true, '(orientation: portrait)': true });
    vi.stubGlobal('screen', { orientation: { type: 'portrait-primary' } });
    renderGuard();
    const continueBtn = screen.getByRole('button');
    expect(continueBtn.textContent).toBe(en['portrait.continue']);
    fireEvent.click(continueBtn);
    await waitFor(() => expect(screen.queryByTestId('portrait-guard')).toBeNull());
  });
});
