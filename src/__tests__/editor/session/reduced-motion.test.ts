// @vitest-environment jsdom
/**
 * The motion preference has to reach gates that cannot read the store themselves: the canvas rAF
 * loops and Framer's reading (the `motion-state` singleton) and CSS (`<html data-reduced-motion>`).
 * The editor's session publishes both with no component mounted, including the cases a CSS media
 * query cannot express on its own: "Reduced" while the OS says no-preference, and "Full" while the
 * OS asks for reduce.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { watchReducedMotion } from '../../../editor/session/install';
import { useEditorStore } from '../../../state/store';
import { isMotionReduced, __resetMotionState } from '../../../platform/channels/motion-state';

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

let stop = (): void => {};
beforeEach(() => {
  __resetMotionState();
  delete document.documentElement.dataset.reducedMotion;
});
afterEach(() => { stop(); stop = () => {}; vi.unstubAllGlobals(); useEditorStore.setState({ motionPref: 'system' }); });

describe('the session publishes the effective motion preference', () => {
  it('[UI-08] "reduced" reduces both gates even when the OS asks for nothing', () => {
    mockOsPrefers(false);
    useEditorStore.setState({ motionPref: 'reduced' });
    stop = watchReducedMotion();
    expect(isMotionReduced()).toBe(true);
    expect(attr()).toBe('1');
  });

  it('[UI-08] "full" keeps motion on even when the OS asks for reduce', () => {
    mockOsPrefers(true);
    useEditorStore.setState({ motionPref: 'full' });
    stop = watchReducedMotion();
    expect(isMotionReduced()).toBe(false);
    // Must be an explicit '0', not just absent: the CSS media query is scoped to opt out on it.
    expect(attr()).toBe('0');
  });

  it('[UI-08] "system" follows the OS, both ways', () => {
    mockOsPrefers(true);
    useEditorStore.setState({ motionPref: 'system' });
    stop = watchReducedMotion();
    expect(isMotionReduced()).toBe(true);
    expect(attr()).toBe('1');
    stop();

    mockOsPrefers(false);
    stop = watchReducedMotion();
    expect(isMotionReduced()).toBe(false);
    expect(attr()).toBe('0');
  });

  it('follows the OS setting and the preference as they change while the app is open', () => {
    let reduce = false;
    const listeners = new Set<() => void>();
    vi.stubGlobal('matchMedia', (q: string) => ({
      get matches() { return reduce && q.includes('prefers-reduced-motion'); },
      media: q,
      addEventListener: (_: string, fn: () => void) => listeners.add(fn),
      removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
    }));
    useEditorStore.setState({ motionPref: 'system' });
    stop = watchReducedMotion();
    expect(isMotionReduced()).toBe(false);

    reduce = true;
    listeners.forEach((fn) => fn());
    expect(isMotionReduced()).toBe(true);
    expect(attr()).toBe('1');

    useEditorStore.getState().setMotionPref('full');
    expect(isMotionReduced()).toBe(false);
    expect(attr()).toBe('0');

    stop();
    expect(listeners.size).toBe(0);
    useEditorStore.getState().setMotionPref('reduced');
    expect(isMotionReduced()).toBe(false);
  });
});
