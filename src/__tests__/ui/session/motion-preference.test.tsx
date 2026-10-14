// @vitest-environment jsdom
/**
 * The motion preference has to reach THREE gates that can't read the store themselves: the canvas rAF
 * loops (the `motion-state` singleton), CSS (`<html data-reduced-motion>`), and Framer (<MotionConfig>
 * in App, covered by its own props). These tests pin the two that `useMotionEnabled` publishes,
 * including the cases a CSS media query cannot express on its own: "Reduced" while the OS says
 * no-preference, and "Full" while the OS asks for reduce.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { renderHook, render, screen, act, cleanup, waitFor, within } from '@testing-library/react';
import { MotionConfig } from 'framer-motion';
import { useMotionEnabled } from '../../../ui/session/use-motion-enabled';
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
  it('"reduced" reduces both gates even when the OS asks for nothing', () => {
    mockOsPrefers(false);
    useEditorStore.setState({ motionPref: 'reduced' });
    renderHook(() => useMotionEnabled());
    expect(isMotionReduced()).toBe(true);
    expect(attr()).toBe('1');
  });

  it('"full" keeps motion on even when the OS asks for reduce', () => {
    mockOsPrefers(true);
    useEditorStore.setState({ motionPref: 'full' });
    renderHook(() => useMotionEnabled());
    expect(isMotionReduced()).toBe(false);
    // Must be an explicit '0', not just absent: the CSS media query is scoped to opt out on it.
    expect(attr()).toBe('0');
  });

  it('"system" follows the OS, both ways', () => {
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

  it('collapses component-owned CSS transitions, which Framer cannot see', () => {
    expect(css).toMatch(/transition-duration:\s*0\.01ms\s*!important/);
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
 * explains the choice after Reduced is picked. The registry suite pins that nothing else lifts the
 * gate.
 */
describe('the motion setting samples', () => {
  afterEach(cleanup);

  function mountSettings(appReduces: boolean, osReduces: boolean) {
    mockOsPrefers(osReduces);
    useEditorStore.setState({ locale: 'en', motionPref: appReduces ? 'reduced' : 'full' });
    render(
      <MotionConfig reducedMotion={appReduces ? 'always' : 'never'}>
        <I18nProvider>
          <SettingsModal open onClose={() => {}} />
        </I18nProvider>
      </MotionConfig>,
    );
    const group = screen.getByRole('radiogroup', { name: 'Motion' });
    const sampleOf = (name: string) =>
      within(group).getByRole('radio', { name }).querySelector('[data-motion-sample]') as HTMLElement;
    return { full: sampleOf('Full'), reduced: sampleOf('Reduced'), system: sampleOf('System') };
  }
  /** Mid-turn: a gated spin jumps straight to its end angle, a running one passes through others. */
  const turned = (el: HTMLElement) => {
    const deg = Number(/rotate\(([-\d.]+)deg\)/.exec(el.style.transform)?.[1] ?? 0);
    return deg > 0 && deg < 360;
  };

  it.each([true, false])('spins Full and holds Reduced still when the app reduces motion: %s', async (appReduces) => {
    const samples = mountSettings(appReduces, false);
    await waitFor(() => expect(turned(samples.full)).toBe(true));
    expect(turned(samples.system)).toBe(true);
    expect(turned(samples.reduced)).toBe(false);
  });

  it('holds System still when the device asks for reduced motion', async () => {
    const samples = mountSettings(true, true);
    await waitFor(() => expect(turned(samples.full)).toBe(true));
    expect(turned(samples.system)).toBe(false);
  });

});
