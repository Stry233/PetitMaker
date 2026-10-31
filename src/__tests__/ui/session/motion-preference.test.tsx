// @vitest-environment jsdom
/**
 * The motion preference has to reach three gates that can't read the store themselves: the canvas rAF
 * loops (the `motion-state` singleton), CSS (`<html data-reduced-motion>`), and Framer (<MotionConfig>
 * in App, covered by its own props). These tests pin the two that `useMotionEnabled` publishes,
 * including the cases a CSS media query cannot express on its own: "Reduced" while the OS says
 * no-preference, and "Full" while the OS asks for reduce.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { renderHook, render, screen, act, cleanup, within } from '@testing-library/react';
import { MotionConfig } from 'framer-motion';
import { resolveReducedMotion, useMotionEnabled } from '../../../ui/session/use-motion-enabled';
import { en } from '../../../i18n/locales/en';
import { useEditorStore } from '../../../state/store';
import { isMotionReduced, __resetMotionState } from '../../../platform/channels/motion-state';
import { I18nProvider } from '../../../i18n/context';
import { SettingsModal } from '../../../ui/chrome/modals/settings/SettingsModal';
import { Spinner } from '../../../ui/primitives/Spinner';

/** Pretend the OS asks (or doesn't ask) for reduced motion. */
function mockOsPrefers(reduce: boolean): void {
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: reduce && q.includes('prefers-reduced-motion'),
    media: q,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}
const attr = (): string | undefined => document.documentElement.dataset.reducedMotion;

beforeEach(() => {
  __resetMotionState();
  delete document.documentElement.dataset.reducedMotion;
});
afterEach(() => vi.unstubAllGlobals());

describe('useMotionEnabled publishes the effective preference', () => {
  it('[UI-08] "reduced" reduces both gates even when the OS asks for nothing', () => {
    mockOsPrefers(false);
    useEditorStore.setState({ motionPref: 'reduced' });
    renderHook(() => useMotionEnabled());
    expect(isMotionReduced()).toBe(true);
    expect(attr()).toBe('1');
  });

  it('[UI-08] "full" keeps motion on even when the OS asks for reduce', () => {
    mockOsPrefers(true);
    useEditorStore.setState({ motionPref: 'full' });
    renderHook(() => useMotionEnabled());
    expect(isMotionReduced()).toBe(false);
    // Must be an explicit '0', not just absent: the CSS media query is scoped to opt out on it.
    expect(attr()).toBe('0');
  });

  it('[UI-08] "system" follows the OS, both ways', () => {
    mockOsPrefers(true);
    useEditorStore.setState({ motionPref: 'system' });
    const a = renderHook(() => useMotionEnabled());
    expect(isMotionReduced()).toBe(true);
    expect(attr()).toBe('1');
    a.unmount();

    mockOsPrefers(false);
    useEditorStore.setState({ motionPref: 'system' });
    renderHook(() => useMotionEnabled());
    expect(isMotionReduced()).toBe(false);
    expect(attr()).toBe('0');
  });

  it('updates the effective value when the OS setting changes while the app is open', () => {
    let reduce = false;
    const listeners = new Set<() => void>();
    vi.stubGlobal('matchMedia', (q: string) => ({
      get matches() { return reduce && q.includes('prefers-reduced-motion'); },
      media: q,
      addEventListener: (_: string, fn: () => void) => listeners.add(fn),
      removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
    }));
    useEditorStore.setState({ motionPref: 'system' });
    const hook = renderHook(() => useMotionEnabled());
    expect(hook.result.current).toBe(false);

    act(() => { reduce = true; listeners.forEach((fn) => fn()); });
    expect(hook.result.current).toBe(true);
    expect(isMotionReduced()).toBe(true);
    expect(attr()).toBe('1');

    act(() => useEditorStore.setState({ motionPref: 'full' }));
    expect(hook.result.current).toBe(false);
    expect(attr()).toBe('0');
    hook.unmount();
    expect(listeners.size).toBe(0);
  });
});

describe('the CSS gate agrees with the attribute the hook writes', () => {
  const css = readFileSync('src/ui/design/animations.css', 'utf8');

  it('keys its reduced rules off data-reduced-motion, not only the media query', () => {
    expect(css).toContain("[data-reduced-motion='1']");
    // "Full" must be able to opt out of the pre-hydration media query.
    expect(css).toContain(":root:not([data-reduced-motion='0'])");
  });

  it('collapses component-owned CSS transitions, which Framer cannot see, to no time at all', () => {
    expect(css).toMatch(/transition-duration:\s*0s\s*!important/);
    expect(css).toMatch(/transition-delay:\s*0s\s*!important/);
    expect(css).toMatch(/animation-iteration-count:\s*1\s*!important/);
  });

  it('exempts the busy indicator so a spinner never freezes', () => {
    expect(css).toContain(':not(.pw-busy)');
    const { container } = render(<Spinner />);
    expect(container.firstElementChild?.classList.contains('pw-busy')).toBe(true);
  });
});

/**
 * Each motion option's sample shows its own level under every preference, so the row still
 * explains the choice after Reduced is picked: Full's cell bounces, Reduced's lands still, and Auto's
 * plays what the device resolves to. The registry suite pins that nothing else lifts the gate.
 */
describe('the motion setting samples', () => {
  afterEach(cleanup);

  /** `osReduces` null keeps the OS reading already stubbed. */
  function mountSettings(pref: 'reduced' | 'full' | 'system', osReduces: boolean | null) {
    if (osReduces !== null) mockOsPrefers(osReduces);
    useEditorStore.setState({ locale: 'en', motionPref: pref });
    render(
      <MotionConfig reducedMotion={resolveReducedMotion(pref, osReduces === true) ? 'always' : 'never'}>
        <I18nProvider>
          <SettingsModal open onClose={() => {}} />
        </I18nProvider>
      </MotionConfig>,
    );
    const group = screen.getByRole('radiogroup', { name: en['modal.settings_motion'] });
    const levelOf = (name: string) =>
      (within(group).getByRole('radio', { name }).querySelector('[data-motion-sample]') as HTMLElement).dataset.sampleLevel;
    return {
      group,
      levels: () => ({ full: levelOf(en['modal.settings_motion_full']), reduced: levelOf(en['modal.settings_motion_reduced']), auto: levelOf(en['modal.settings_motion_system']) }),
    };
  }

  it.each(['reduced', 'full'] as const)('[UI-08] bounces Full and lands Reduced still whatever the app plays: %s', (pref) => {
    const { levels } = mountSettings(pref, false);
    expect(levels()).toEqual({ full: 'full', reduced: 'reduced', auto: 'full' });
  });

  it('[UI-08] plays Auto as the device resolves it', () => {
    const { levels } = mountSettings('full', true);
    expect(levels()).toEqual({ full: 'full', reduced: 'reduced', auto: 'reduced' });
  });

  it('[UI-08] names the device-following choice Auto', () => {
    const { group } = mountSettings('system', false);
    expect(within(group).getByRole('radio', { name: 'Auto' }).getAttribute('aria-checked')).toBe('true');
  });

  it('[UI-08] keeps every tile on one beat, also when Auto restarts on a changed device setting', () => {
    let now = 1000;
    const started: Array<{ startTime: CSSNumberish | null }> = [];
    Object.defineProperty(document, 'timeline', { configurable: true, get: () => ({ currentTime: now }) });
    Element.prototype.animate = function animate() {
      const a = { startTime: null as CSSNumberish | null, cancel: () => {} };
      started.push(a);
      return a as unknown as Animation;
    };
    let reduce = false;
    const listeners = new Set<() => void>();
    vi.stubGlobal('matchMedia', (q: string) => ({
      get matches() { return reduce && q.includes('prefers-reduced-motion'); },
      media: q,
      addEventListener: (_: string, fn: () => void) => listeners.add(fn),
      removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
    }));
    try {
      const { levels } = mountSettings('full', null);
      expect(started).toHaveLength(6);
      expect(new Set(started.map((a) => a.startTime))).toEqual(new Set([1000]));

      // The OS asks for reduced motion mid-loop: Auto restarts on its new level, on the same beat.
      now = 1730;
      // A copy: the re-render resubscribes, and a Set visits entries added during its own iteration.
      act(() => { reduce = true; [...listeners].forEach((fn) => fn()); });
      expect(levels().auto).toBe('reduced');
      expect(started.length).toBeGreaterThan(6);
      expect(new Set(started.map((a) => a.startTime))).toEqual(new Set([1000]));
    } finally {
      delete (Element.prototype as { animate?: unknown }).animate;
      delete (document as { timeline?: unknown }).timeline;
    }
  });
});
